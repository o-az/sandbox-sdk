# Consolidation Analysis Summary

## What We Did

1. **Created comprehensive trace analysis** (`EXEC_TRACE_ANALYSIS.md`)
   - Traced all 10 methods from client SDK → container → session
   - Identified which methods share code paths
   - Discovered architectural mismatches

2. **Analyzed killing limitation** (`EXEC_KILLING_ANALYSIS.md`)
   - Found SessionManager can't kill individual commands
   - Only kills entire persistent bash shell
   - This prevents using SessionManager for background processes

3. **Updated consolidation plan** (`EXEC_CONSOLIDATION.md`)
   - Refined based on findings
   - Clear separation: Commands vs Background Processes
   - Implementation phases aligned with reality

## Key Findings

### Finding 1: Unified Execution Model with Enhanced SessionManager

**Initial assumption**: Use SessionManager for commands, direct spawn for background processes

**User insight**: Background processes need session state too!
```typescript
await sandbox.exec('cd /my-app && export API_KEY=secret');
await sandbox.startProcess('npm start');  // Must run in /my-app with API_KEY!
```

**Final decision**: Use SessionManager for ALL execution + add command killing

| Use Case | Model | Why |
|----------|-------|-----|
| **Commands** (exec, execStream) | SessionManager | • Need session state (env, cwd)<br>• Shell features via persistent bash |
| **Background Processes** (startProcess) | SessionManager | • Need session state (env, cwd)<br>• Need killing (via PID tracking)<br>• Need log streaming (via listeners) |

### Finding 2: SessionManager Already Has Shell Support

**Discovery**: SessionManager uses persistent bash shell - shell syntax just works!
- No need for `sh -c` wrapper (bash handles it)
- No naive parsing anywhere
- Pipes, redirects, loops all supported natively

**Problem**: We weren't using SessionManager for streaming/background execution

### Finding 3: SessionManager Can Be Enhanced with Killing

**Initial concern**: SessionManager can't kill individual commands

**Solution**: Add PID tracking to Session class
- Modify FIFO script to capture command PID
- Write PID to file for external access
- Add `Session.killCommand()` to send SIGTERM
- Add `SessionManager.killCommand()` wrapper

**Result**: SessionManager can now handle all execution needs

## Architectural Insights

### Unified Execution Model

**All execution uses SessionManager** - no distinction between commands and processes:

```typescript
// COMMANDS: Short-lived, use session state
await sandbox.exec('cd /app && npm test')  // SessionManager
const stream = await sandbox.execStream('npm run build')  // SessionManager

// PROCESSES: Long-lived, ALSO use session state
await sandbox.exec('cd /my-app && export API_KEY=secret');
const server = await sandbox.startProcess('npm start')  // SessionManager (inherits state!)
await sandbox.killProcess(server.id)  // SessionManager.killCommand()
```

### How SessionManager Now Handles Background Processes

```typescript
class Session {
  private shell: Subprocess;  // ONE persistent bash process
  private runningCommands: Map<string, CommandHandle>;  // ✅ TRACK COMMANDS

  async exec(command): Promise<Result> {
    // Writes to shell stdin, waits for completion
  }

  async *execStream(command): AsyncGenerator<ExecEvent> {
    // Writes to shell stdin, streams events
    // ✅ MODIFIED: Captures command PID in FIFO script
  }

  async killCommand(commandId: string): Promise<boolean> {
    // ✅ NEW: Read PID from file, send SIGTERM
    const handle = this.runningCommands.get(commandId);
    const pid = await readPidFromFile(handle.pidFile);
    process.kill(pid, 'SIGTERM');
  }

  async destroy(): Promise<void> {
    // Kills THE shell (terminates all commands)
    this.shell.kill();
  }
}
```

### Process Management with SessionManager

```typescript
interface ProcessRecord {
  id: string;
  command: string;
  status: ProcessStatus;
  stdout: string;  // Buffered output
  stderr: string;

  // CHANGED: Store command handle instead of subprocess
  commandHandle?: {
    sessionId: string;
    commandId: string;
  };

  // Listeners for real-time streaming
  outputListeners: Set<(stream, data) => void>;
  statusListeners: Set<(status) => void>;
}
```

**How this enables all features**:
- `killProcess(id)` → Uses `commandHandle` to call `SessionManager.killCommand()`
- `streamProcessLogs(id)` → Creates stream from `outputListeners` + buffered output
- `getProcess(id).pid` → Can be looked up from session's running commands map

## Implementation Strategy

### Phase 1: Enhance Session with Command Killing
- Add `runningCommands` map to track command handles
- Modify FIFO script to capture command PID
- Add `Session.killCommand(commandId)` method

### Phase 2: Add SessionManager.killCommand()
- Wrapper method that delegates to Session
- Returns ServiceResult<void>

### Phase 3: Make SessionManager Required
- Remove optional parameter from ProcessService
- Delete all fallback paths
- Update all tests to provide SessionManager

### Phase 4: Add executeCommandStream()
- New method for streaming via SessionManager
- Stores commandHandle for killing
- Used by exec({stream: true}) and execStream()

### Phase 5: Update startProcess() to Use SessionManager
- Call executeCommandStream() (same implementation)
- Background processes now inherit session state

### Phase 6: Update Killing and Streaming Methods
- killProcess() uses SessionManager.killCommand()
- streamProcessLogs() uses process record listeners
- Remove all subprocess references

### Phases 7-8: Update tests, verification

## What Changes for Users

### Before (Buggy)
```typescript
// Shell syntax broken in streaming
await sandbox.execStream('bash -c "echo hello | grep hello"');

// Background processes broken
const proc = await sandbox.startProcess('bash -c "for i in 1 2; do echo $i; done"');

// Background processes didn't inherit session state
await sandbox.exec('cd /my-app && export API_KEY=secret');
const server = await sandbox.startProcess('npm start');
// Would run in default directory WITHOUT API_KEY
```

### After (Fixed)
```typescript
// Shell syntax just works everywhere
await sandbox.execStream('echo hello | grep hello');
const proc = await sandbox.startProcess('for i in 1 2; do echo $i; done');

// Background processes inherit session state!
await sandbox.exec('cd /my-app && export API_KEY=secret');
const server = await sandbox.startProcess('npm start');
// Runs in /my-app WITH API_KEY available

// And you can still kill them
await sandbox.killProcess(server.id);
```

## What Doesn't Change

### Client API
- `exec()` - Same signature ✅
- `execStream()` - Same signature ✅
- `startProcess()` - Same signature ✅
- All process management methods - Same ✅

### Behavior Improvements
- Shell features work in streaming ✅
- Shell features work in background processes ✅
- Environment variables persist in sessions ✅
- Consistent behavior across all methods ✅

## Files Created

1. **`EXEC_TRACE_ANALYSIS.md`**
   - Complete method-by-method trace
   - From client SDK → container → session layer
   - Summary table of all methods

2. **`EXEC_KILLING_ANALYSIS.md`**
   - Why SessionManager can't kill commands
   - Three potential solutions analyzed
   - Recommendation: Two execution models

3. **`EXEC_CONSOLIDATION.md`** (Updated)
   - Refined implementation plan
   - Clear phase-by-phase approach
   - Test migration strategy

4. **`CONSOLIDATION_SUMMARY.md`** (This file)
   - High-level overview
   - Key findings and insights
   - Decision rationale

## Decision Rationale

### Why Use SessionManager for Everything?

❌ **Initial idea**: SessionManager for commands, direct spawn for background processes

**Problem identified by user**:
Background processes need session state! Users expect:
```typescript
await sandbox.exec('cd /my-app && export API_KEY=secret');
await sandbox.startProcess('npm start');  // Should inherit session state!
```

✅ **Final approach**: SessionManager for ALL execution + add killing capability

**Benefits**:
1. ✅ Unified execution model (one code path)
2. ✅ Session state everywhere (env vars, cwd persist)
3. ✅ Shell features everywhere (persistent bash)
4. ✅ Process control everywhere (PID tracking for killing)
5. ✅ Consistent behavior (no surprises for users)

### How We Solved the Killing Problem

❌ **Initial concern**: SessionManager can't kill individual commands

**Investigation showed**:
- Session only had `destroy()` which kills entire shell
- Commands run inside persistent bash - no subprocess handles
- Needed way to target specific commands

✅ **Solution**: Enhance Session with PID tracking

**Implementation**:
1. Modify FIFO script to capture command PID (`& CMD_PID=$!`)
2. Write PID to file for external access
3. Track command handles in Session
4. Add `Session.killCommand()` to send SIGTERM
5. Wrap in `SessionManager.killCommand()` for service layer

**Result**: SessionManager can now do everything!
- ✅ Run commands with session state
- ✅ Stream events in real-time
- ✅ Kill individual commands
- ✅ Background processes with full control

## Next Steps

1. Review plans with team
2. Get approval on approach
3. Implement Phase 1 (SessionManager required)
4. Implement Phase 2 (executeCommandStream)
5. Implement Phase 3 (Fix startProcess)
6. Update tests
7. Verify all tests pass

## Success Criteria

- [ ] All shell syntax works in all execution methods (exec, execStream, startProcess)
- [ ] Background processes inherit session state (cd, export persist)
- [ ] killProcess() works via SessionManager (no subprocess handles)
- [ ] streamProcessLogs() works via process record listeners
- [ ] killAllProcesses() iterates using SessionManager
- [ ] No breaking changes to client API
- [ ] All tests pass with production code paths
- [ ] No `bash -c` workarounds needed in user code
- [ ] SessionManager is always required (no optional parameter)
- [ ] ProcessRecord uses commandHandle (not subprocess)
