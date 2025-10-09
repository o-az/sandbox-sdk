# Daytona vs Current Implementation: Session State Persistence Analysis

**Date:** 2025-10-09
**Issue:** Working directory changes and shell functions don't persist across `exec()` calls

## Executive Summary

**Root Cause Identified:** The current implementation uses **subshell syntax `( )`** while Daytona uses **command grouping syntax `{ }`**. This is the critical difference causing state persistence failures.

- **Subshell `( command )`**: Creates a new subprocess → state changes (cd, functions, variables) are lost when subprocess exits
- **Command Grouping `{ command; }`**: Executes in the current shell → state changes persist

## Architecture Comparison

### High-Level Flow (Both Implementations)

Both implementations follow the same basic pattern:

```
1. Spawn persistent bash shell with stdin pipe
2. When exec() is called:
   a. Build FIFO-based bash script
   b. Write script to shell's stdin
   c. Shell executes script in its context
   d. Wait for exit code file
   e. Parse output from log file
   f. Return result
```

This pattern SHOULD work for persistent state - and it does in Daytona!

---

## Key Differences

### 1. ⚠️ **CRITICAL: Subshell vs Command Grouping**

#### Daytona (Go) - `execute.go` lines 83-109

```go
cmdToExec := fmt.Sprintf(
  `{
    log=%q
    dir=%q

    # per-command FIFOs with unique names
    sp="$dir/stdout.pipe.%s.$$"; ep="$dir/stderr.pipe.%s.$$"
    rm -f "$sp" "$ep" && mkfifo "$sp" "$ep" || exit 1

    cleanup() { rm -f "$sp" "$ep"; }
    trap 'cleanup' EXIT HUP INT TERM

    # Start background labelers
    ( while IFS= read -r line || [ -n "$line" ]; do printf '%s%%s\n' "$line"; done < "$sp" ) >> "$log" & r1=$!
    ( while IFS= read -r line || [ -n "$line" ]; do printf '%s%%s\n' "$line"; done < "$ep" ) >> "$log" & r2=$!

    # ✅ Execute command with COMMAND GROUPING
    { %s; } > "$sp" 2> "$ep"
    echo "$?" >> %s

    # Wait for background labelers to finish
    wait "$r1" "$r2"

    cleanup
  }
`+"\n",
  logFilePath,    // %q  -> log
  logDir,         // %q  -> dir
  *cmdId, *cmdId, // %s  %s -> fifo names
  toOctalEscapes(STDOUT_PREFIX), // stdout prefix
  toOctalEscapes(STDERR_PREFIX), // stderr prefix
  request.Command,               // %s  -> USER COMMAND (injected here)
  exitCodeFilePath,              // %q
)

// Write to persistent shell stdin
_, err = session.stdinWriter.Write([]byte(cmdToExec))
```

**Key line:** `{ %s; } > "$sp" 2> "$ep"`
**Effect:** Command runs in the **CURRENT SHELL CONTEXT** - `cd`, `export`, and function definitions persist!

---

#### Current Implementation (TypeScript) - `session.ts` lines 366-437

```typescript
private buildFIFOScript(
  command: string,
  cmdId: string,
  logFile: string,
  exitCodeFile: string,
  cwd?: string
): string {
  // Create unique FIFO names
  const stdoutPipe = join(this.sessionDir!, `${cmdId}.stdout.pipe`);
  const stderrPipe = join(this.sessionDir!, `${cmdId}.stderr.pipe`);

  const safeStdoutPipe = this.escapeShellPath(stdoutPipe);
  const safeStderrPipe = this.escapeShellPath(stderrPipe);
  const safeLogFile = this.escapeShellPath(logFile);
  const safeExitCodeFile = this.escapeShellPath(exitCodeFile);

  let script = `{
  # Create FIFO pipes
  mkfifo ${safeStdoutPipe} ${safeStderrPipe}

  # Label stdout with binary prefix in background
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x01\\x01\\x01%s\\n' "$line"; done < ${safeStdoutPipe}) >> ${safeLogFile} &

  # Label stderr with binary prefix in background
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x02\\x02\\x02%s\\n' "$line"; done < ${safeStderrPipe}) >> ${safeLogFile} &

`;

  if (cwd) {
    // ... cwd handling code
    script += `    ( ${command}; ) > ${safeStdoutPipe} 2> ${safeStderrPipe}\n`;
  } else {
    // ❌ Execute command in SUBSHELL
    script += `  # Execute command in subshell (prevents 'exit' from killing session)\n`;
    script += `  ( ${command}; ) > ${safeStdoutPipe} 2> ${safeStderrPipe}\n`;
    script += `  EXIT_CODE=$?\n`;
  }

  script += `  wait\n`;
  script += `  echo "$EXIT_CODE" > ${safeExitCodeFile}\n`;
  script += `  rm -f ${safeStdoutPipe} ${safeStderrPipe}\n`;
  script += `}`;

  return script;
}
```

**Key line:** `( ${command}; ) > ${safeStdoutPipe} 2> ${safeStderrPipe}`
**Comment:** "Execute command in subshell (prevents 'exit' from killing session)"
**Effect:** Command runs in a **SUBPROCESS** - `cd`, `export`, and function definitions are LOST when subprocess exits!

---

### 2. Shell Initialization Flags

#### Daytona
```go
cmd := exec.CommandContext(ctx, common.GetShell())
cmd.Env = os.Environ()
```
- Uses system shell (typically `/bin/bash`)
- Inherits full environment
- No special flags

#### Current
```typescript
Bun.spawn({
  cmd: ['bash', '--norc'],
  cwd: this.options.cwd || CONFIG.DEFAULT_CWD,
  env: {
    ...process.env,
    ...this.options.env,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  },
  stdin: 'pipe',
  stdout: 'ignore',
  stderr: 'ignore',
})
```
- Explicitly uses `bash --norc` (disables reading ~/.bashrc)
- Sets UTF-8 locale
- Ignores stdout/stderr (uses log files instead)

**Impact:** Minimal - the `--norc` flag is fine for non-interactive sessions.

---

### 3. FIFO Pipe Creation

#### Daytona
```bash
sp="$dir/stdout.pipe.%s.$$"; ep="$dir/stderr.pipe.%s.$$"
rm -f "$sp" "$ep" && mkfifo "$sp" "$ep" || exit 1
```
- Uses `$$` (shell PID) for additional uniqueness
- Explicitly removes old pipes with `rm -f` before creating
- Fails fast with `|| exit 1` if mkfifo fails

#### Current
```typescript
const stdoutPipe = join(this.sessionDir!, `${cmdId}.stdout.pipe`);
const stderrPipe = join(this.sessionDir!, `${cmdId}.stderr.pipe`);
// ...
mkfifo ${safeStdoutPipe} ${safeStderrPipe}
```
- Uses UUID-based command ID (already unique)
- No explicit cleanup before creation
- No explicit error handling (relies on bash error propagation)

**Impact:** Minimal - both approaches ensure uniqueness. Current approach is actually safer since UUIDs are globally unique.

---

### 4. Error Handling Patterns

#### Daytona
```go
trap 'cleanup' EXIT HUP INT TERM
```
- Uses bash traps to ensure FIFO cleanup on ANY exit (normal or signal)
- More robust cleanup handling

#### Current
```typescript
script += `  wait\n`;
script += `  rm -f ${safeStdoutPipe} ${safeStderrPipe}\n`;
```
- Cleanup after `wait` completes
- No explicit trap handlers
- Relies on successful execution path

**Impact:** Moderate - Daytona's trap-based cleanup is more robust for signal handling. However, current implementation also has application-level cleanup in `cleanupCommandFiles()`.

---

## Test Failure Analysis

### Test 1: Environment Variable Isolation ❌

**Test code** (session-state-isolation-workflow.test.ts line 120):
```typescript
// First setEnvVars call - ✅ Works
await fetch('/api/env/set', {
  headers: createTestHeaders(sandboxId, session1Id),
  body: JSON.stringify({ envVars: { NEW_VAR: 'session1-only' } })
});

// Second setEnvVars call - ❌ 500 error
await fetch('/api/env/set', {
  headers: createTestHeaders(sandboxId, session1Id),
  body: JSON.stringify({ envVars: { ANOTHER_VAR: 'value' } })
});
```

**Root Cause:** `setEnvVars()` implementation (session-manager.ts lines 220-275):
```typescript
for (const [key, value] of Object.entries(envVars)) {
  const escapedValue = value.replace(/'/g, "'\\''");
  const exportCommand = `export ${key}='${escapedValue}'`;

  const result = await session.exec(exportCommand);  // ← Runs in SUBSHELL

  if (result.exitCode !== 0) {
    return { success: false, error: { ... } };
  }
}
```

**Problem:** Each `export` command runs in a **subshell** due to `( command )` syntax, so:
1. `export NEW_VAR='session1-only'` runs in subshell → sets variable in subprocess
2. Subprocess exits → variable is LOST
3. Next call tries to export more variables → same issue

**Why Daytona works:** With `{ command; }` syntax, `export` runs in the persistent shell, so variables actually persist.

---

### Test 2: Working Directory Isolation ❌

**Test code** (session-state-isolation-workflow.test.ts line 266):
```typescript
const session1 = await sandbox.createSession({ cwd: '/workspace/app' });

await session1.exec('cd src');  // Change directory

const pwd = await session1.exec('pwd');
expect(pwd.stdout.trim()).toBe('/workspace/app/src');  // ❌ Still '/workspace/app'
```

**Root Cause:** Same subshell issue:
1. `cd src` runs in subshell → changes directory in subprocess
2. Subprocess exits → directory change is LOST
3. `pwd` runs in new subshell → still in original directory

**Why Daytona works:** With `{ cd src; }`, the `cd` executes in the persistent shell context, so subsequent commands see the new directory.

---

### Test 3: Shell Function Persistence ❌

**Test code** (session-state-isolation-workflow.test.ts line 327):
```typescript
await session1.exec('greet() { echo "Hello from Production"; }');

const result = await session1.exec('greet');
expect(result.success).toBe(true);  // ❌ Fails - 'greet: command not found'
```

**Root Cause:** Same subshell issue:
1. Function definition runs in subshell → function defined in subprocess
2. Subprocess exits → function is LOST
3. `greet` call runs in new subshell → function doesn't exist

**Why Daytona works:** With `{ greet() { echo "Hello"; }; }`, the function is defined in the persistent shell, so subsequent commands can call it.

---

## The Trade-off: State Persistence vs Exit Safety

### Current Implementation Reasoning

The comment in `session.ts` line 419 reveals the intention:

> "Execute command in subshell (prevents 'exit' from killing session)"

**The concern:** If a user runs `exit`, it could kill the persistent bash session, making the Session object unusable.

**Example:**
```typescript
await session.exec('ls');    // Works
await session.exec('exit');  // Would kill the bash process
await session.exec('ls');    // Would fail - bash is dead
```

### Daytona's Approach

Daytona uses `{ command; }` with no explicit protection against `exit`. Checking their codebase:
- No parsing to block `exit` commands
- No trap to prevent session termination
- Session dies if user runs `exit`

**Daytona's implicit contract:** Don't run `exit` in a session, or it will die (like a terminal).

### Potential Solutions

#### Option 1: Match Daytona (Command Grouping)
**Change:** `( ${command}; )` → `{ ${command}; }`

**Pros:**
- ✅ State persistence works (cd, functions, exports)
- ✅ Matches battle-tested Daytona implementation
- ✅ Simpler mental model (session = persistent shell)

**Cons:**
- ❌ `exit` kills the session
- ❌ User error could break session

**Mitigation:**
- Document that `exit` will terminate the session
- Add explicit check: if command is `exit`, call `session.destroy()` instead
- Consider parsing to detect and warn about `exit`

#### Option 2: Hybrid Approach (Smart Detection)
**Change:** Detect state-changing commands and handle specially

```typescript
if (isStateChange(command)) {
  // Use grouping for cd, export, function definitions
  script = `{ ${command}; } > pipe 2> pipe`;
} else {
  // Use subshell for everything else (safety)
  script = `( ${command}; ) > pipe 2> pipe`;
}
```

**Pros:**
- ✅ State persistence for state-changing commands
- ✅ Safety for most commands

**Cons:**
- ❌ Complex logic to detect state changes
- ❌ Edge cases (compound commands, aliases, etc.)
- ❌ Inconsistent behavior between command types

#### Option 3: Persistent State Tracking (Alternative Architecture)
**Change:** Track state separately and inject before each command

```typescript
class Session {
  private currentDir: string;
  private envVars: Record<string, string>;
  private functions: Map<string, string>;

  async exec(command: string) {
    // Inject state before each command
    const preamble = `
      cd ${this.currentDir};
      ${Object.entries(this.envVars).map(([k,v]) => `export ${k}='${v}'`).join('; ')};
      ${Array.from(this.functions.values()).join('; ')};
    `;

    // Execute with injected state
    return this.execRaw(`${preamble} ${command}`);
  }
}
```

**Pros:**
- ✅ State persistence without shell dependence
- ✅ Safe from `exit`
- ✅ Explicit state management

**Cons:**
- ❌ Very complex implementation
- ❌ Need to parse command output to detect state changes
- ❌ Can't track all shell state (aliases, completion, history, etc.)
- ❌ High maintenance burden

---

## Recommendation

**Go with Option 1: Match Daytona's approach** - use command grouping `{ }` instead of subshell `( )`.

### Rationale

1. **Proven in production:** Daytona uses this pattern in a production system
2. **Correct semantics:** Sessions SHOULD behave like persistent shells
3. **Simple fix:** One-line change in `buildFIFOScript()`
4. **User expectations:** Developers expect `cd` and `export` to persist in a "session"
5. **Exit handling:** Can be handled explicitly at application level

### Implementation Steps

1. **Immediate fix** - Change `session.ts` line 420:
   ```typescript
   // BEFORE:
   script += `  ( ${command}; ) > ${safeStdoutPipe} 2> ${safeStderrPipe}\n`;

   // AFTER:
   script += `  { ${command}; } > ${safeStdoutPipe} 2> ${safeStderrPipe}\n`;
   ```

2. **Also fix cwd block** - Change `session.ts` line 404 (in the `if (cwd)` branch):
   ```typescript
   // BEFORE:
   script += `    ( ${command}; ) > ${safeStdoutPipe} 2> ${safeStderrPipe}\n`;

   // AFTER:
   script += `    { ${command}; } > ${safeStdoutPipe} 2> ${safeStderrPipe}\n`;
   ```

3. **Update comments** - Remove misleading comment about exit safety:
   ```typescript
   // Remove this comment (it's no longer accurate):
   // "Execute command in subshell (prevents 'exit' from killing session)"

   // Replace with:
   // "Execute command in current shell (enables state persistence)"
   ```

4. **Add exit detection** (optional but recommended):
   ```typescript
   async exec(command: string, options?: ExecOptions): Promise<RawExecResult> {
     this.ensureReady();

     // Detect explicit exit commands
     const trimmedCommand = command.trim();
     if (trimmedCommand === 'exit' || trimmedCommand.startsWith('exit ')) {
       throw new Error(
         'Cannot execute exit command in session. Use session.destroy() to terminate the session.'
       );
     }

     // ... rest of exec implementation
   }
   ```

5. **Document behavior** - Add to Session class documentation:
   ```typescript
   /**
    * Session - Persistent shell execution with state preservation
    *
    * This implementation provides a persistent bash session that maintains state
    * (cwd, env vars, shell functions) across commands using command grouping.
    *
    * Important notes:
    * - Working directory changes (cd) persist across exec() calls
    * - Environment variables (export) persist across exec() calls
    * - Shell functions defined in one exec() are available in subsequent calls
    * - Running 'exit' will terminate the session (use session.destroy() instead)
    * - Commands execute in the session's shell context, not in subshells
    */
   ```

6. **Test the fix:**
   ```bash
   npm run build
   npm run test:e2e
   ```

   Should see all 6 session isolation tests pass! ✅

---

## Expected Test Results After Fix

With the grouping syntax fix:

| Test | Before | After | Notes |
|------|--------|-------|-------|
| Environment Variable Isolation | ❌ FAIL | ✅ PASS | `export` will persist in shell context |
| Working Directory Isolation | ❌ FAIL | ✅ PASS | `cd` will persist in shell context |
| Shell Function Persistence | ❌ FAIL | ✅ PASS | Functions will persist in shell context |
| Process Space Sharing | ✅ PASS | ✅ PASS | Already working |
| File System Sharing | ✅ PASS | ✅ PASS | Already working |
| Concurrent Execution | ✅ PASS | ✅ PASS | Already working |

**Expected outcome:** 6/6 tests passing (100% success rate)

---

## Additional Daytona Features to Consider

Looking at their implementation, Daytona also has:

1. **Session Command History** (`session.go` lines 169-184):
   - Tracks all commands executed in a session
   - Stores exit codes and logs per command
   - Useful for debugging and auditing

2. **Cleanup Traps** (`execute.go` lines 91-92):
   ```go
   cleanup() { rm -f "$sp" "$ep"; }
   trap 'cleanup' EXIT HUP INT TERM
   ```
   - More robust FIFO cleanup on signals
   - Consider adding to current implementation

3. **Version Compatibility** (`session.go` lines 31-47):
   - Handles backward compatibility with older SDK versions
   - Good practice for production systems

These are enhancements for future consideration, not critical for fixing the immediate issue.

---

## Conclusion

The persistent shell state issue is caused by a single architectural choice: **subshell `( )` vs command grouping `{ }`**.

Daytona's battle-tested implementation proves that command grouping is the correct approach for session semantics. The fix is straightforward - change two lines of code from subshell syntax to grouping syntax.

The `exit` safety concern can be addressed through explicit detection and documentation rather than implicit subshell isolation that breaks session state persistence.

**Recommended action:** Implement Option 1 (match Daytona) immediately to fix all 3 failing tests.
