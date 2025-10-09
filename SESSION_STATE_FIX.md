# Session State Persistence Fix

## Problem Statement

Our recent PID tracking implementation broke session state persistence by using background execution (`&`) for ALL commands. Background execution creates a subshell where state changes (cd, export, functions) are lost.

### Current Behavior (BROKEN):

```typescript
// Test case that's failing:
await session.exec('TEST_VAR="persistent"');  // Sets in subshell
await session.exec('echo $TEST_VAR');         // Reads from main shell → empty!
```

```bash
# Generated script (BOTH exec and execStream):
{ ${command}; } > "$sp" 2> "$ep" & CMD_PID=$!  # ← & creates subshell!
wait "$CMD_PID"
```

**Root cause:** The `&` operator ALWAYS creates a subshell. State changes inside the subshell don't persist to the parent shell.

### User Requirements:

1. **State persistence for exec():**
   ```typescript
   exec('cd /workspace/project');  // Should persist
   exec('pwd');                    // Should show /workspace/project
   ```

2. **Concurrent operations in same session:**
   ```typescript
   startProcess('npm run dev', { sessionId: 'default' });  // Background server
   exec('curl localhost:3000', { sessionId: 'default' });  // Should work while server runs!
   ```

## Solution Architecture

### Key Insight: exec() vs execStream() Have Different Needs

**exec() - Synchronous, State-Preserving:**
- Used for: configuration commands, file operations, git commands
- Characteristics: Short-lived, sequential, state changes should persist
- Pattern: **Foreground execution** (no `&`)

**execStream() / startProcess() - Async, Background:**
- Used for: long-running servers, build processes, streaming operations
- Characteristics: Long-lived, concurrent, state changes shouldn't affect session
- Pattern: **Background execution** (with `&`)

### Matches Real Terminal Behavior:

```bash
$ cd /workspace              # Foreground - state persists ✅
$ export API_KEY=secret      # Foreground - state persists ✅
$ npm run dev &              # Background - runs in subshell ✅
[1] 12345
$ curl localhost:3000        # Foreground - can run while server runs! ✅
```

Background jobs in bash naturally run in subshells - this is standard behavior!

## Implementation Plan

### Phase 1: Update buildFIFOScript() for Conditional Execution

**File:** `src/session.ts`

**Changes:**
1. Add `isBackground: boolean` parameter to `buildFIFOScript()`
2. For background jobs (isBackground=true):
   - Use `&` to background the command
   - Write PID to file
   - **DON'T wait in main script** - let shell continue
   - Use background monitor to write exit code when done
3. For foreground jobs (isBackground=false):
   - **NO `&`** - run in main shell
   - Capture exit code directly with `$?`
   - **NO PID tracking** (command is synchronous, can't be killed mid-execution)
   - State changes persist naturally

**Foreground script pattern (exec):**
```bash
{
  # FIFO setup...

  # Execute command in FOREGROUND (no &)
  { ${command}; } > "$sp" 2> "$ep"
  EXIT_CODE=$?

  # Close pipes to signal labelers
  # (This is important - prevents labelers from hanging)
  exec 3>&-  # Close stdout pipe
  exec 4>&-  # Close stderr pipe

  # Wait for labelers to finish
  wait "$r1" "$r2"

  # Write exit code
  echo "$EXIT_CODE" > exitfile

  # Cleanup
}
```

**Background script pattern (execStream/startProcess):**
```bash
{
  # FIFO setup...

  # Execute command in BACKGROUND (with &)
  { ${command}; } > "$sp" 2> "$ep" & CMD_PID=$!

  # Write PID immediately
  echo "$CMD_PID" > pidfile

  # Background monitor that waits for completion
  (
    wait "$CMD_PID"
    local EXIT_CODE=$?

    # Close pipes
    exec 3>&-
    exec 4>&-

    # Wait for labelers (may have already finished)
    wait "$r1" "$r2" 2>/dev/null

    # Write exit code
    echo "$EXIT_CODE" > exitfile

    # Cleanup PID file
    rm -f pidfile
  ) &

  # Main script continues immediately (shell is FREE!)
}
```

### Phase 2: Update exec() to Use Foreground Pattern

**File:** `src/session.ts` - `exec()` method

**Changes:**
- Call `buildFIFOScript(command, cmdId, logFile, exitCodeFile, cwd, isBackground=false)`
- No PID file cleanup needed
- State persists between exec() calls

### Phase 3: Update execStream() to Use Background Pattern

**File:** `src/session.ts` - `execStream()` method

**Changes:**
- Call `buildFIFOScript(command, cmdId, logFile, exitCodeFile, cwd, isBackground=true)`
- Keep PID file logic for killing
- Shell continues immediately (concurrent execution enabled!)

### Phase 4: Update killCommand() for Background-Only

**File:** `src/session.ts` - `killCommand()` method

**Changes:**
- Keep existing logic (reads PID from file, kills process)
- Only works for background commands from execStream()
- Foreground commands from exec() can't be killed mid-execution (acceptable trade-off)
- Document this limitation

### Phase 5: Remove PID Tracking from exec() Code Path

**File:** `src/session.ts`

**Changes:**
- exec() doesn't track PIDs anymore (foreground commands complete before returning)
- Only execStream() tracks PIDs
- Simplifies the code

## Expected Behavior After Fix

### State Persistence ✅

```typescript
// Test 1: Environment variables
await session.exec('export TEST_VAR="persistent"');
await session.exec('echo $TEST_VAR');
// → stdout: "persistent" ✅

// Test 2: Working directory
await session.exec('mkdir -p subdir && cd subdir');
await session.exec('pwd');
// → stdout contains "subdir" ✅

// Test 3: Shell functions
await session.exec('my_func() { echo "works"; }');
await session.exec('my_func');
// → stdout: "works" ✅
```

### Concurrent Operations ✅

```typescript
// Start long-running server
await startProcess('npm run dev', { sessionId: 'default' });
// → Returns immediately, shell continues ✅

// Make request while server runs
await exec('curl http://localhost:3000', { sessionId: 'default' });
// → Executes immediately, server still running ✅

// Session state still works
await exec('export API_KEY=secret', { sessionId: 'default' });
await exec('echo $API_KEY', { sessionId: 'default' });
// → stdout: "secret" ✅
```

### Background Job Isolation ✅

```typescript
// Background jobs don't affect session state (standard bash behavior)
await startProcess('cd /tmp && npm run dev', { sessionId: 'default' });
await exec('pwd', { sessionId: 'default' });
// → Still shows /workspace, NOT /tmp ✅
// (cd happened in background job's subshell)
```

## Files to Modify

1. **`src/session.ts`**
   - `buildFIFOScript()` - Add `isBackground` parameter, implement two patterns
   - `exec()` - Pass `isBackground=false`
   - `execStream()` - Pass `isBackground=true`
   - `killCommand()` - Add documentation about foreground limitation
   - Update comments to reflect new architecture

2. **Tests** (should pass without changes after fix):
   - `tests/session.test.ts` - All 4 failing tests should pass
   - No other test changes needed

## Trade-offs and Limitations

### ✅ Benefits:

1. **State persistence** - exec() commands can modify session state
2. **Concurrency** - Background processes don't block the shell
3. **Standard behavior** - Matches how real bash terminals work
4. **Clean architecture** - Different patterns for different use cases

### ⚠️ Acceptable Limitations:

1. **Can't kill foreground commands** - exec() calls can't be interrupted mid-execution
   - **Why acceptable:** exec() is for short-lived commands (file ops, git, etc.)
   - **Mitigation:** Use timeout (already implemented)

2. **Background jobs isolated** - State changes in background jobs don't persist
   - **Why acceptable:** This is standard bash behavior
   - **Why correct:** You wouldn't want `cd` in a background server to affect your session

3. **Sequential exec(), concurrent execStream()** - Multiple exec() calls wait for each other
   - **Why acceptable:** Configuration/file commands should be sequential anyway
   - **Why correct:** Prevents race conditions (e.g., two execs modifying same file)

## Verification Steps

### After Implementation:

1. **Run Session tests:**
   ```bash
   npm run test -w @repo/sandbox-container -- tests/session.test.ts
   ```
   - All 4 failing tests should pass
   - All existing tests should still pass

2. **Test concurrent operations:**
   ```bash
   npm run test:e2e -- streaming-operations-workflow.test.ts
   ```
   - Verify background processes work
   - Verify foreground commands work concurrently

3. **Manual verification:**
   - Start a session
   - Set environment variable with exec()
   - Start background process with startProcess()
   - Verify env var still accessible with exec()

## Timeline Estimate

- Phase 1: Update buildFIFOScript() - 30 minutes
- Phase 2-3: Update exec()/execStream() - 15 minutes
- Phase 4-5: Update killCommand(), cleanup - 15 minutes
- Testing and iteration - 30 minutes

**Total: ~1.5 hours** (being methodical as you requested)

## Questions Before We Start:

1. **Foreground command killing:** Should we support interrupting exec() commands at all, or is timeout sufficient?

2. **Background monitor complexity:** The background pattern is more complex (separate monitor process). Are you comfortable with this?

3. **State change documentation:** Should we document that background jobs (startProcess) are isolated and won't affect session state?

Let me know if this plan looks good, and I'll proceed phase by phase!
