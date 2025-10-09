# Command Execution Consolidation Plan

## Problem Statement

The container runtime has two divergent execution paths that cause inconsistent behavior:

### Path 1: Non-Streaming (`/api/execute`)
```
ExecuteHandler → ProcessService.executeCommand()
└── IF SessionManager: sessionManager.executeInSession()
    └── session.exec() [persistent bash, shell features work ✅]
└── ELSE: adapter.executeShell()
    └── Bun.spawn('sh', ['-c', command]) [shell wrapper, works ✅]
```

### Path 2: Streaming (`/api/execute/stream`)
```
ExecuteHandler → ProcessService.startProcess()
├── manager.parseCommand() [naive space-splitting ❌]
└── adapter.spawn(executable, args) [no shell wrapper ❌]
    └── NO SESSION SUPPORT ❌
```

### Bugs Caused by Divergence

| Issue | Non-Streaming | Streaming | Impact |
|-------|--------------|-----------|---------|
| **Shell syntax** | ✅ Works (`sh -c` wrapper) | ❌ Broken (naive parsing) | Pipes, redirects, loops fail |
| **Session state** | ✅ Uses SessionManager | ❌ Ignores SessionManager | Env vars don't persist |
| **Environment vars** | ✅ Applied via session | ❌ Not applied | `$VAR` expansion fails |
| **Command parsing** | ✅ Shell handles it | ❌ Splits on spaces | Quotes break |

### Root Causes

1. **ProcessService has optional SessionManager**: `constructor(store, logger, sessionManager?)`
   - In production: SessionManager is ALWAYS present (container.ts:92-96)
   - Fallback path exists "for tests" but creates a different execution environment
   - Tests using fallback path aren't testing production behavior

2. **startProcess() doesn't use SessionManager**: Even though it's available!
   - Uses naive `parseCommand()` that splits on spaces
   - Spawns processes directly without shell wrapper
   - Completely bypasses session state management

3. **Duplicated environment preparation**: Same logic in both paths

## Goals

1. ✅ **Single execution engine**: Both streaming and non-streaming use SessionManager
2. ✅ **Consistent behavior**: Shell syntax, env vars, state persistence work everywhere
3. ✅ **No test-only code**: Tests must use same code paths as production
4. ✅ **Clean architecture**: Remove dead code and consolidate common logic
5. ✅ **Preserve client API**: No changes to SDK's `exec()` or `execStream()` signatures

## Solution Design

### Make SessionManager Required

**Current (wrong)**:
```typescript
class ProcessService {
  constructor(
    private store: ProcessStore,
    private logger: Logger,
    private sessionManager?: SessionManager  // ❌ Optional = two code paths
  ) {}
}
```

**Proposed (correct)**:
```typescript
class ProcessService {
  constructor(
    private store: ProcessStore,
    private logger: Logger,
    private sessionManager: SessionManager  // ✅ Required
  ) {}
}
```

**Why?**
- Container ALWAYS creates SessionManager (proven in container.ts:92-96)
- Optional parameter creates an illusion of flexibility we don't need
- Forces tests to use production code paths
- Removes entire classes of bugs

### Critical Discovery: Background Processes Need Session State

After tracing all methods (see `EXEC_TRACE_ANALYSIS.md` and `EXEC_KILLING_ANALYSIS.md`), we discovered:

**Background processes need session state** - users expect this to work:
```typescript
await sandbox.exec('cd /my-app');
await sandbox.exec('export API_KEY=secret');
const server = await sandbox.startProcess('npm start');
// Should run in /my-app with API_KEY available!
```

**But SessionManager couldn't kill individual commands** - it only killed the entire persistent bash shell.

**Solution**: Enhance SessionManager with command killing capability:
- ✅ **All execution** → Use SessionManager (unified model)
- ✅ **Add killing** → Track command PIDs, send SIGTERM to specific commands
- ✅ **Best of both** → Session state + process control

### Consolidated Execution Flow

**All execution uses SessionManager with enhanced killing capability**:

```typescript
// Non-streaming commands: /api/execute
async executeCommand(command: string, options: ProcessOptions) {
  // ✅ Uses SessionManager (already implemented correctly)
  const sessionId = options.sessionId || 'default';
  const result = await this.sessionManager.executeInSession(
    sessionId,
    command,
    options.cwd
  );

  return {
    success: true,
    data: {
      success: result.data.exitCode === 0,
      exitCode: result.data.exitCode,
      stdout: result.data.stdout,
      stderr: result.data.stderr,
    }
  };
}

// Streaming commands: /api/execute/stream (NEW METHOD)
async executeCommandStream(command: string, options: ProcessOptions) {
  // ✅ Uses SessionManager for streaming execution
  const sessionId = options.sessionId || 'default';
  const processRecord = this.manager.createProcessRecord(command, undefined, options);

  // Store command handle for potential killing
  processRecord.commandHandle = {
    sessionId,
    commandId: processRecord.id,
  };

  // Start streaming via SessionManager
  const streamPromise = this.sessionManager.executeStreamInSession(
    sessionId,
    command,
    (event) => {
      // Route session events to process record listeners
      if (event.type === 'stdout' || event.type === 'stderr') {
        processRecord[event.type] += event.data;
        processRecord.outputListeners.forEach(listener =>
          listener(event.type, event.data)
        );
      } else if (event.type === 'complete') {
        processRecord.exitCode = event.exitCode;
        processRecord.status = event.exitCode === 0 ? 'completed' : 'failed';
        processRecord.endTime = new Date();
        processRecord.statusListeners.forEach(listener =>
          listener(processRecord.status)
        );
      }
    },
    options.cwd
  );

  await this.store.create(processRecord);

  // Let stream run, handle errors async
  streamPromise.catch(error => {
    processRecord.status = 'error';
    processRecord.endTime = new Date();
  });

  return { success: true, data: processRecord };
}

// Background processes: /api/process/start
async startProcess(command: string, options: ProcessOptions) {
  // ✅ SAME AS executeCommandStream - uses SessionManager
  // The only difference is semantic: caller doesn't wait for completion
  return this.executeCommandStream(command, options);
}

// Killing processes: now uses SessionManager
async killProcess(id: string): Promise<ServiceResult<void>> {
  const process = await this.store.get(id);

  if (!process) {
    return {
      success: false,
      error: { message: `Process ${id} not found`, code: 'PROCESS_NOT_FOUND' },
    };
  }

  if (process.commandHandle) {
    // Kill via SessionManager (reads PID, sends SIGTERM)
    const result = await this.sessionManager.killCommand(
      process.commandHandle.sessionId,
      process.commandHandle.commandId
    );

    if (result.success) {
      await this.store.update(id, {
        status: 'killed',
        endTime: new Date(),
      });
    }

    return result;
  }

  return { success: true };  // Already completed
}
```

### What Gets Deleted

**Dead code removal**:
```typescript
// DELETE: Fallback execution paths in executeCommand()
if (!this.sessionManager) {
  return this.adapter.executeShell(...);  // Should never happen
}

// DELETE: All direct spawn in startProcess()
const spawnResult = this.adapter.spawn('sh', ['-c', command], {...});
const processRecord = { ...processRecordData, subprocess: spawnResult.subprocess };

// REPLACE WITH: SessionManager execution
return this.executeCommandStream(command, options);

// DELETE: subprocess handling in startProcess()
this.adapter.handleStreams(spawnResult.subprocess, { ... });

// REPLACE WITH: Session event routing (handled in executeCommandStream)
```

**Keep but mark as deprecated**:
```typescript
// ProcessManager.parseCommand() - keep for potential other uses
/**
 * @deprecated This method does naive space-splitting and cannot handle shell syntax.
 * Not recommended for command execution. Use SessionManager instead.
 */
parseCommand(command: string): ParsedCommand {
  // ... existing implementation
}
```

### What Gets Added

**New Session class capabilities**:
```typescript
// Command tracking
private runningCommands = new Map<string, CommandHandle>();

// Command killing
async killCommand(commandId: string): Promise<boolean> {
  // Reads PID from file, sends SIGTERM
}
```

**New SessionManager method**:
```typescript
async killCommand(sessionId: string, commandId: string): Promise<ServiceResult<void>> {
  // Delegates to Session.killCommand()
}
```

**New ProcessService method**:
```typescript
async executeCommandStream(command: string, options: ProcessOptions) {
  // For streaming execution via SessionManager
}
```

**Updated ProcessRecord**:
```typescript
interface ProcessRecord {
  // CHANGE: subprocess → commandHandle
  commandHandle?: {
    sessionId: string;
    commandId: string;
  };
}
```

## Test Migration Strategy

### Phase 1: Identify Affected Tests

Search for:
```bash
# Tests creating ProcessService without SessionManager
grep -r "new ProcessService" packages/sandbox-container/src/tests/

# Tests using parseCommand
grep -r "parseCommand" packages/sandbox-container/src/tests/
```

### Phase 2: Update Container Tests

**Before (wrong)**:
```typescript
// Test creates ProcessService without SessionManager
const processService = new ProcessService(mockStore, mockLogger);
```

**After (correct)**:
```typescript
// Test uses real or mocked SessionManager
const sessionManager = new SessionManager(mockLogger);
const processService = new ProcessService(mockStore, mockLogger, sessionManager);

// OR for unit tests:
const mockSessionManager = {
  executeInSession: vi.fn(),
  executeStreamInSession: vi.fn(),
} as any;
const processService = new ProcessService(mockStore, mockLogger, mockSessionManager);
```

### Phase 3: Update Integration Tests

**Before (may fail with shell syntax)**:
```typescript
const result = await processService.startProcess('bash -c "echo hello"');
```

**After (works with shell syntax)**:
```typescript
const result = await processService.startProcess('echo hello');
// Shell features just work now!
```

### Phase 4: Verify E2E Tests

E2E tests should work without changes because:
- They test through the full stack (handler → service → session)
- SessionManager is always available in real containers
- We're fixing bugs, not changing API contracts

**But we can remove workarounds**:
```typescript
// DELETE these workarounds from tests
command: "bash -c 'echo stdout message; echo stderr message >&2'"
// BECOMES:
command: 'echo stdout message; echo stderr message >&2'

// Users shouldn't need bash -c - the container handles it!
```

## Implementation Phases

### Phase 1: Enhance Session Class with Killing

**Files**:
- `packages/sandbox-container/src/session.ts`

**Changes**:
```typescript
class Session {
  // ADD: Command tracking
  private runningCommands = new Map<string, CommandHandle>();

  interface CommandHandle {
    commandId: string;
    pid: number;
    pidFile: string;
    logFile: string;
    exitCodeFile: string;
  }

  // MODIFY: buildFIFOScript() to capture PID
  private buildFIFOScript(...) {
    // Execute command in background: { command; } > pipe 2> pipe & CMD_PID=$!
    // Write PID: echo "$CMD_PID" > pidFile
    // Wait for command: wait "$CMD_PID"
  }

  // ADD: Killing method
  async killCommand(commandId: string): Promise<boolean> {
    // Read PID from file, send SIGTERM
  }

  // ADD: Tracking helpers
  private trackCommand(commandId: string, handle: CommandHandle): void
  private untrackCommand(commandId: string): void
}
```

### Phase 2: Add SessionManager Killing Method

**Files**:
- `packages/sandbox-container/src/services/session-manager.ts`

**Changes**:
```typescript
class SessionManager {
  // NEW: Kill command in a session
  async killCommand(sessionId: string, commandId: string): Promise<ServiceResult<void>> {
    const session = await this.getSession(sessionId);
    const killed = await session.data.killCommand(commandId);

    if (!killed) {
      return {
        success: false,
        error: { message: 'Command not found or already completed', code: 'COMMAND_NOT_FOUND' }
      };
    }

    return { success: true };
  }
}
```

### Phase 3: Update ProcessService - Unified Execution

**Files**:
- `packages/sandbox-container/src/services/process-service.ts`
- `packages/sandbox-container/src/core/types.ts` (ProcessRecord type)

**Changes**:
```typescript
// 1. Make SessionManager required
constructor(
  private store: ProcessStore,
  private logger: Logger,
  private sessionManager: SessionManager  // Remove ?
) {}

// 2. Remove fallback in executeCommand()
// DELETE: if (!this.sessionManager) { ... }

// 3. ADD: executeCommandStream() method
async executeCommandStream(command: string, options: ProcessOptions) {
  // Uses SessionManager.executeStreamInSession()
  // Stores commandHandle for killing
}

// 4. UPDATE: startProcess() to use SessionManager
async startProcess(command: string, options: ProcessOptions) {
  // CHANGE FROM: Direct spawn with subprocess
  // TO: Call executeCommandStream() (same implementation)
  return this.executeCommandStream(command, options);
}

// 5. UPDATE: killProcess() to use SessionManager
async killProcess(id: string) {
  // CHANGE FROM: process.subprocess.kill()
  // TO: this.sessionManager.killCommand(process.commandHandle.sessionId, ...)
}

// 6. UPDATE: killAllProcesses()
async killAllProcesses() {
  // Iterate and call killProcess() (which now uses SessionManager)
}

// 7. UPDATE: streamProcessLogs()
async streamProcessLogs(id: string) {
  // CHANGE FROM: return process.subprocess.stdout
  // TO: Create stream from process.outputListeners + buffered output
}

// 8. UPDATE ProcessRecord type
interface ProcessRecord {
  // CHANGE: subprocess?: Subprocess
  // TO: commandHandle?: { sessionId, commandId }
}
```

### Phase 4: Update Handlers

**Files**:
- `packages/sandbox-container/src/handlers/execute-handler.ts`
- `packages/sandbox-container/src/handlers/process-handler.ts`

**Changes**:
```typescript
// ExecuteHandler
async handleStreamingExecute(request: Request, context: RequestContext) {
  // CHANGE FROM: this.processService.startProcess()
  // TO: this.processService.executeCommandStream()
}

// ProcessHandler - streamProcessLogs
// Update to use process record listeners instead of subprocess.stdout
```

### Phase 5: Clean Up Dead Code

**Files**:
- `packages/sandbox-container/src/services/process-service.ts`
- `packages/sandbox-container/src/managers/process-manager.ts`

**Changes**:
- Remove fallback execution paths in `executeCommand()`
- Remove all direct spawn code from `startProcess()`
- Mark `parseCommand()` as deprecated
- Remove `prepareEnvironment()` helper (no longer needed - sessions handle env)

### Phase 6: Update Tests

**Files**:
- `packages/sandbox-container/src/services/tests/process-service.test.ts`
- Any integration tests using ProcessService

**Changes**:
- Add SessionManager to all ProcessService instantiations
- Remove `bash -c` workarounds from test commands
- Update assertions to expect shell syntax to work

### Phase 7: Update E2E Tests

**Files**:
- `tests/e2e/streaming-operations-workflow.test.ts`
- Any other E2E tests using shell syntax

**Changes**:
- Remove `bash -c` wrappers: `"bash -c 'cmd'"` → `'cmd'`
- Test should verify shell features work without wrappers
- Update test comments to reflect natural shell syntax
- Test background processes with session state

### Phase 8: Verification

After implementation:

- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` succeeds
- [ ] `npm run test:unit` passes (all unit tests)
- [ ] `npm run test:container` passes (all container tests)
- [ ] `npm run test:e2e` passes (all e2e tests)
- [ ] Streaming operations test passes 9/9 tests
- [ ] Shell features work without `bash -c`:
  - [ ] Pipes: `echo hello | grep hello`
  - [ ] Redirects: `echo error >&2`
  - [ ] Variables: `VAR=value; echo $VAR`
  - [ ] Loops: `for i in 1 2 3; do echo $i; done`
  - [ ] Semicolons: `echo a; echo b; echo c`
- [ ] Environment variables persist in sessions
- [ ] Background processes inherit session state:
  - [ ] `cd /dir` then `startProcess` runs in `/dir`
  - [ ] `export VAR=val` then `startProcess` has `VAR` available
- [ ] Process killing works via SessionManager:
  - [ ] `killProcess()` terminates background processes
  - [ ] `killAllProcesses()` works correctly
  - [ ] Commands can be killed mid-execution
- [ ] No subprocess handles remain in code
- [ ] No fallback code paths remaining (grep for `if (this.sessionManager)`)

## Migration Guide for Users

### Before (Users had to work around bugs)

```typescript
// Users needed bash -c for shell features
await sandbox.execStream('bash -c "echo hello | grep hello"');

// Environment variables didn't work in streaming
const stream = await sandbox.execStream('echo $MY_VAR');  // Empty output

// Background processes couldn't inherit session state
await sandbox.exec('cd /my-app');
await sandbox.exec('export API_KEY=secret');
const server = await sandbox.startProcess('npm start');
// Would run in default directory WITHOUT API_KEY
```

### After (Shell features and session state work everywhere)

```typescript
// Shell syntax works naturally
await sandbox.execStream('echo hello | grep hello');

// Environment variables work everywhere
await sandbox.setEnvVars({ MY_VAR: 'hello' });
const stream = await sandbox.execStream('echo $MY_VAR');  // Outputs: hello

// Background processes inherit session state!
await sandbox.exec('cd /my-app');
await sandbox.exec('export API_KEY=secret');
const server = await sandbox.startProcess('npm start');
// Runs in /my-app WITH API_KEY available

// And you can still kill background processes
await sandbox.killProcess(server.id);
```

### Breaking Changes

**None for users!** This is purely an internal refactoring. The client SDK API remains unchanged:
- `exec(command, options)` - same signature
- `execStream(command, options)` - same signature
- Both now have consistent behavior with full shell support

**For SDK contributors/tests**:
- ProcessService constructor now requires SessionManager (not optional)
- Tests must provide SessionManager when creating ProcessService

## Success Criteria

1. ✅ All shell syntax works in all execution methods (exec, execStream, startProcess)
2. ✅ Environment variables persist in sessions for all execution
3. ✅ Background processes inherit session state (cwd, env vars)
4. ✅ Process killing works via SessionManager (no subprocess handles)
5. ✅ Unified execution model (single code path via SessionManager)
6. ✅ No test-only fallback code
7. ✅ All tests pass using production code paths
8. ✅ E2E tests demonstrate:
   - Shell features working naturally
   - Background processes with session state
   - Process killing functionality
9. ✅ Client API unchanged (no breaking changes for users)

## Future Improvements

After consolidation:

1. **Session lifecycle management**: Auto-create default session on first command
2. **Session pooling**: Reuse sessions for better performance
3. **Streaming error handling**: Better error propagation in streaming context
4. **Signal support**: Allow custom signals for killing (SIGTERM, SIGKILL, etc.)
5. **Graceful shutdown**: Timeout and force-kill if SIGTERM doesn't work
6. **Process groups**: Kill process trees (not just individual commands)
7. **Documentation**: Update architecture docs to reflect unified execution model

## References

- Original issue: Streaming tests failing due to shell syntax not working
- Root cause: `parseCommand()` naive space-splitting
- SessionManager already has streaming: `executeStreamInSession()`
- Container always creates SessionManager: `container.ts:92-96`
- Client API unchanged: Both `exec()` and `execStream()` keep current signatures
