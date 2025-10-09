# Daytona Pattern Adoption Plan

**Date:** 2025-10-09
**Target:** Incorporate improvements 1-3 from Daytona's session implementation
**Branch:** `refactor-with-tests` (unpublished - breaking changes acceptable)

---

## Summary of Changes

We'll enhance the FIFO script generation in `session.ts` to match Daytona's robustness patterns:

1. **Trap-based cleanup** - Handle signals gracefully
2. **Explicit FIFO error handling** - Pre-cleanup and fail-fast
3. **Wait for specific PIDs** - More predictable background job handling

---

## Current Implementation Analysis

### File: `packages/sandbox-container/src/session.ts`

#### Current `buildFIFOScript()` (lines 366-437)

**Current bash script structure:**
```bash
{
  # Create FIFO pipes
  mkfifo ${safeStdoutPipe} ${safeStderrPipe}

  # Label stdout with binary prefix in background
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x01\\x01\\x01%s\\n' "$line"; done < ${safeStdoutPipe}) >> ${safeLogFile} &

  # Label stderr with binary prefix in background
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x02\\x02\\x02%s\\n' "$line"; done < ${safeStderrPipe}) >> ${safeLogFile} &

  # Execute command
  { ${command}; } > ${safeStdoutPipe} 2> ${safeStderrPipe}
  EXIT_CODE=$?

  wait

  echo "$EXIT_CODE" > ${safeExitCodeFile}

  rm -f ${safeStdoutPipe} ${safeStderrPipe}
}
```

**Issues:**
- ❌ No signal handling (Ctrl+C leaves orphaned FIFOs)
- ❌ No pre-cleanup (can fail if FIFOs already exist)
- ❌ No mkfifo error handling (silent failures)
- ❌ `wait` waits for all background jobs (not just our labelers)
- ❌ Single cleanup point (not executed on signals)

---

## Proposed Implementation

### New `buildFIFOScript()` Structure

**Daytona-inspired bash script:**
```bash
{
  log=${safeLogFile}
  dir=${sessionDir}
  sp=${safeStdoutPipe}
  ep=${safeStderrPipe}

  # Cleanup function (will be called on exit or signals)
  cleanup() { rm -f "$sp" "$ep"; }
  trap 'cleanup' EXIT HUP INT TERM

  # Pre-cleanup and create FIFOs with error handling
  rm -f "$sp" "$ep" && mkfifo "$sp" "$ep" || exit 1

  # Start labeler processes and capture PIDs
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x01\\x01\\x01%s\\n' "$line"; done < "$sp") >> "$log" & r1=$!
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x02\\x02\\x02%s\\n' "$line"; done < "$ep") >> "$log" & r2=$!

  # Execute command in current shell (enables state persistence)
  { ${command}; } > "$sp" 2> "$ep"
  EXIT_CODE=$?

  # Wait for specific labeler processes (not all background jobs)
  wait "$r1" "$r2"

  # Write exit code (AFTER labelers finish)
  echo "$EXIT_CODE" > ${safeExitCodeFile}

  # Ensure cleanup even if waits failed (redundant with trap, but safe)
  cleanup
}
```

**Improvements:**
- ✅ Trap handler ensures cleanup on EXIT, HUP, INT, TERM
- ✅ Pre-cleanup with `rm -f` prevents "file exists" errors
- ✅ Fail-fast with `|| exit 1` if mkfifo fails
- ✅ Wait for specific PIDs `$r1` and `$r2` (our labeler processes)
- ✅ Double cleanup (trap + explicit) for robustness

---

## Implementation Steps

### Step 1: Update `buildFIFOScript()` Method

**File:** `packages/sandbox-container/src/session.ts`
**Lines:** 366-437 (replace entire method)

**Changes:**
1. Add variable assignments at the top of the script block
2. Add `cleanup()` function definition
3. Add `trap 'cleanup' EXIT HUP INT TERM`
4. Change mkfifo line to: `rm -f "$sp" "$ep" && mkfifo "$sp" "$ep" || exit 1`
5. Capture PIDs: `& r1=$!` and `& r2=$!` after background processes
6. Change `wait` to `wait "$r1" "$r2"`
7. Add explicit `cleanup` call at the end

**Impact:**
- Only changes bash script generation (no TypeScript API changes)
- No breaking changes to Session class interface
- More robust FIFO handling

---

### Step 2: Handle CWD Override Block

**Current code** (lines 398-415):
```typescript
if (cwd) {
  const safeCwd = this.escapeShellPath(cwd);
  script += `  # Save and change directory\n`;
  script += `  PREV_DIR=$(pwd)\n`;
  script += `  if cd ${safeCwd}; then\n`;
  script += `    # Execute command in current shell (enables state persistence)\n`;
  script += `    { ${command}; } > ${safeStdoutPipe} 2> ${safeStderrPipe}\n`;
  script += `    EXIT_CODE=$?\n`;
  script += `    # Restore directory\n`;
  script += `    cd "$PREV_DIR"\n`;
  script += `  else\n`;
  script += `    # Failed to change directory - close both pipes to unblock readers\n`;
  script += `    echo "Failed to change directory to ${safeCwd}" > ${safeStderrPipe}\n`;
  script += `    # Close stdout pipe (no output expected)\n`;
  script += `    : > ${safeStdoutPipe}\n`;
  script += `    EXIT_CODE=1\n`;
  script += `  fi\n`;
}
```

**Changes needed:**
- Use `$sp` and `$ep` variables instead of safe paths (since we define them)
- Maintain the same logic flow

---

### Step 3: Update Comments and Documentation

**File:** `session.ts` (top-level comment, lines 1-23)

**Current state:** Already updated with state persistence notes

**Additional note to add:**
```typescript
 * Robustness Features:
 * - Trap-based cleanup ensures FIFO removal on signals (EXIT, HUP, INT, TERM)
 * - Pre-cleanup prevents "file exists" errors from previous failures
 * - Fail-fast error handling for mkfifo failures
 * - Specific PID waiting prevents interference from unrelated background jobs
```

---

## Code Changes Detail

### Change 1: Variable Definitions and Trap Setup

**Before:**
```typescript
let script = `{
  # Create FIFO pipes
  mkfifo ${safeStdoutPipe} ${safeStderrPipe}
```

**After:**
```typescript
let script = `{
  log=${safeLogFile}
  dir=${this.escapeShellPath(this.sessionDir!)}
  sp=${safeStdoutPipe}
  ep=${safeStderrPipe}

  # Cleanup function (called on exit or signals)
  cleanup() { rm -f "$sp" "$ep"; }
  trap 'cleanup' EXIT HUP INT TERM

  # Pre-cleanup and create FIFOs with error handling
  rm -f "$sp" "$ep" && mkfifo "$sp" "$ep" || exit 1
```

---

### Change 2: Capture Background Process PIDs

**Before:**
```typescript
script += `  # Label stdout with binary prefix in background\n`;
script += `  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x01\\x01\\x01%s\\n' "$line"; done < ${safeStdoutPipe}) >> ${safeLogFile} &\n`;
script += `\n`;
script += `  # Label stderr with binary prefix in background\n`;
script += `  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x02\\x02\\x02%s\\n' "$line"; done < ${safeStderrPipe}) >> ${safeLogFile} &\n`;
```

**After:**
```typescript
script += `  # Label stdout with binary prefix in background (capture PID)\n`;
script += `  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x01\\x01\\x01%s\\n' "$line"; done < "$sp") >> "$log" & r1=$!\n`;
script += `\n`;
script += `  # Label stderr with binary prefix in background (capture PID)\n`;
script += `  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x02\\x02\\x02%s\\n' "$line"; done < "$ep") >> "$log" & r2=$!\n`;
```

---

### Change 3: Wait for Specific PIDs

**Before:**
```typescript
script += `  # Wait for background processes to finish writing to log file\n`;
script += `  wait\n`;
```

**After:**
```typescript
script += `  # Wait for specific labeler processes to finish (not all background jobs)\n`;
script += `  wait "$r1" "$r2"\n`;
```

---

### Change 4: Double Cleanup

**Before:**
```typescript
script += `  # Remove FIFO pipes\n`;
script += `  rm -f ${safeStdoutPipe} ${safeStderrPipe}\n`;
script += `}`;
```

**After:**
```typescript
script += `  \n`;
script += `  # Explicit cleanup (redundant with trap, but ensures cleanup)\n`;
script += `  cleanup\n`;
script += `}`;
```

---

### Change 5: Update CWD Block to Use Variables

**Before:**
```typescript
script += `    { ${command}; } > ${safeStdoutPipe} 2> ${safeStderrPipe}\n`;
```

**After:**
```typescript
script += `    { ${command}; } > "$sp" 2> "$ep"\n`;
```

**Before:**
```typescript
script += `    echo "Failed to change directory to ${safeCwd}" > ${safeStderrPipe}\n`;
script += `    # Close stdout pipe (no output expected)\n`;
script += `    : > ${safeStdoutPipe}\n`;
```

**After:**
```typescript
script += `    echo "Failed to change directory to ${safeCwd}" > "$ep"\n`;
script += `    # Close stdout pipe (no output expected)\n`;
script += `    : > "$sp"\n`;
```

---

## Testing Strategy

### Unit Testing (Not Required - Container Tests)

Since our container tests mock the Session class, we don't need new tests for this.

### E2E Testing (Validation)

**Test plan:**
1. ✅ Run existing e2e tests (should still pass)
2. ✅ Verify session isolation tests (6/6 should pass with subshell fix)
3. 🆕 Add signal handling test:
   ```typescript
   it('should cleanup FIFOs when command is interrupted', async () => {
     const session = new Session({ id: 'signal-test' });
     await session.initialize();

     // Start a long-running command
     const execPromise = session.exec('sleep 300');

     // Give it time to create FIFOs
     await new Promise(resolve => setTimeout(resolve, 100));

     // Kill the session (simulates SIGTERM)
     await session.destroy();

     // Verify FIFOs are cleaned up (check sessionDir)
     // This would be an integration test, not unit test
   });
   ```

**Expected outcome:**
- All 6 session isolation tests pass
- No orphaned FIFO files in `/tmp/session-*` directories
- Commands interrupted by signals clean up gracefully

---

## Rollout Plan

### Phase 1: Implementation (30 minutes)
1. Update `buildFIFOScript()` method
2. Update top-level documentation
3. Build project (`npm run build`)

### Phase 2: Testing (10 minutes)
1. Run e2e session tests: `npm run test:e2e -- session-state-isolation`
2. Verify all 6 tests pass
3. Manual verification: Start session, interrupt command, check `/tmp` for orphaned FIFOs

### Phase 3: Documentation Update (10 minutes)
1. Update `ISOLATION_TEST.md` with new robustness features
2. Update `SESSION_COMPARISON.md` to note we've adopted all 3 patterns

---

## Risk Assessment

### Low Risk Changes
- ✅ Bash script generation only (no TypeScript API changes)
- ✅ Backward compatible (same Session interface)
- ✅ More robust (can only improve reliability)
- ✅ Matches battle-tested Daytona implementation

### Potential Issues
- ⚠️ **Bash version compatibility**: `trap` and `$!` are POSIX-compliant, should work on all shells
- ⚠️ **Variable escaping**: Using shell variables `$sp`, `$ep` - must ensure proper quoting
- ⚠️ **Exit code capture**: Ensure `EXIT_CODE=$?` happens immediately after command

### Mitigation
- Test on actual Bun container environment (already using `bash --norc`)
- Verify FIFO paths don't contain special characters (already using `escapeShellPath()`)
- Exit code capture already positioned correctly

---

## Bun API Considerations

**Question:** Should we use Bun-specific APIs?

**Analysis:**

### Current Approach (Node.js compatible):
```typescript
import { watch } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
```

### Bun Alternatives:
```typescript
// Bun.write() for files
await Bun.write(exitCodeFile, exitCode.toString());

// Bun.file() for reading (already using)
await Bun.file(exitCodeFile).exists();

// Bun-specific temp directory
Bun.env.TMPDIR || '/tmp';
```

**Recommendation:** **Stick with Node.js APIs for now**

**Reasons:**
1. Current code is already Bun-optimized (using `Bun.file()`, `Bun.spawn()`)
2. File operations are not the bottleneck (FIFO handling in bash is)
3. Node.js compatibility provides flexibility (could run tests in Node if needed)
4. These improvements are about bash robustness, not Bun runtime features

**When to use Bun APIs:**
- Performance-critical paths (already using `Bun.spawn()`, `Bun.file()`)
- Bun-specific features (HTTP server, WebSockets, etc.)
- When Node.js APIs have limitations

---

## Summary

**What changes:**
- Bash script generation in `buildFIFOScript()` method
- Enhanced error handling and cleanup robustness

**What stays the same:**
- Session class public API
- TypeScript type definitions
- Test infrastructure
- Node.js API usage (keep compatibility)

**Expected improvements:**
- Graceful handling of interrupted commands (Ctrl+C, signals)
- No orphaned FIFO files
- Fail-fast on mkfifo errors (permissions, disk space)
- More predictable background process handling

**Effort estimate:**
- Implementation: 30 minutes
- Testing: 10 minutes
- Documentation: 10 minutes
- **Total: ~50 minutes**

Ready to implement? 🚀
