# Complete Execution Path Trace Analysis

This document traces every command/process-related method from the client SDK through to container implementation to identify consolidation opportunities and ensure clean code paths.

## Method Categories

1. **Command Execution**: `exec()`, `execStream()`
2. **Process Lifecycle**: `startProcess()`, `killProcess()`, `killAllProcesses()`
3. **Process Monitoring**: `listProcesses()`, `getProcess()`, `getProcessLogs()`, `streamProcessLogs()`
4. **Process Cleanup**: `cleanupCompletedProcesses()`

---

## 1. exec(command, options?)

**Purpose**: Execute command and return complete result (with optional streaming callbacks)

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
  const sessionId = await this.ensureDefaultSession();

  // Route to CommandClient
  return this.client.commands.execute(command, sessionId, options);
}
```

### CommandClient Layer
```typescript
// packages/sandbox/src/clients/command-client.ts
async execute(command: string, sessionId: string, options?: ExecOptions): Promise<ExecResult> {
  // If streaming requested, use streaming endpoint with callbacks
  if (options?.stream) {
    return this.executeWithStreaming(command, sessionId, options);
  }

  // Otherwise use non-streaming endpoint
  const response = await this.doFetch('/api/execute', {
    method: 'POST',
    body: JSON.stringify({ command, sessionId }),
  });

  return await response.json();
}

private async executeWithStreaming(command: string, sessionId: string, options: ExecOptions): Promise<ExecResult> {
  // Calls /api/execute/stream
  const response = await this.doFetch('/api/execute/stream', {
    method: 'POST',
    body: JSON.stringify({ command, sessionId }),
  });

  // Parse SSE stream, trigger callbacks, accumulate output
  const result = { stdout: '', stderr: '', exitCode: 0, success: true };

  for await (const event of parseSSEStream(response.body)) {
    if (event.type === 'stdout' || event.type === 'stderr') {
      result[event.type] += event.data;
      options.onOutput?.(event.type, event.data);
    } else if (event.type === 'complete') {
      result.exitCode = event.exitCode;
      result.success = event.exitCode === 0;
    }
  }

  return result;
}
```

### Container Handler Layer
```typescript
// packages/sandbox-container/src/handlers/execute-handler.ts

// Non-streaming path
async handleExecute(request: Request, context: RequestContext): Promise<Response> {
  const body = this.getValidatedData<ExecuteRequest>(context);
  const sessionId = body.sessionId || context.sessionId;

  // Calls ProcessService.executeCommand()
  const result = await this.processService.executeCommand(body.command, { sessionId });

  if (result.success) {
    return new Response(JSON.stringify(result.data), { status: 200 });
  }
  return this.createErrorResponse(result.error!, 400, context);
}

// Streaming path
async handleStreamingExecute(request: Request, context: RequestContext): Promise<Response> {
  const body = this.getValidatedData<ExecuteRequest>(context);
  const sessionId = body.sessionId || context.sessionId;

  // Calls ProcessService.startProcess() ❌ WRONG - should have dedicated method
  const processResult = await this.processService.startProcess(body.command, { sessionId });

  if (!processResult.success) {
    return this.createErrorResponse(processResult.error!, 400, context);
  }

  const process = processResult.data!;

  // Create SSE stream from process listeners
  const stream = new ReadableStream({
    start(controller) {
      // Send buffered output + set up listeners
      // (Current race condition fix)
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', ... }
  });
}
```

### Service Layer
```typescript
// packages/sandbox-container/src/services/process-service.ts

// Non-streaming
async executeCommand(command: string, options: ProcessOptions): Promise<ServiceResult<CommandResult>> {
  // ✅ CURRENT: Uses SessionManager
  if (this.sessionManager) {
    const sessionId = options.sessionId || 'default';
    const result = await this.sessionManager.executeInSession(sessionId, command, options.cwd);

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

  // ❌ FALLBACK: Direct adapter (should be removed)
  return this.adapter.executeShell(command, { ... });
}

// Streaming - currently shared with background processes
async startProcess(command: string, options: ProcessOptions): Promise<ServiceResult<ProcessRecord>> {
  // ❌ CURRENT: Does NOT use SessionManager for streaming execution
  // Uses naive parseCommand() + direct spawn

  const { executable, args } = this.manager.parseCommand(command);
  const spawnResult = this.adapter.spawn(executable, args, { ... });

  // Create process record, set up listeners, store
  // ...
}
```

### Session Layer
```typescript
// packages/sandbox-container/src/session.ts

// Non-streaming: session.exec()
async exec(command: string, options?: ExecOptions): Promise<RawExecResult> {
  // Write bash script to persistent shell stdin
  // Wait for exit code file
  // Parse output from log file
  // ✅ Shell features work (real bash)
}

// Streaming: session.execStream()
async *execStream(command: string, options?: ExecOptions): AsyncGenerator<ExecEvent> {
  // Write bash script to persistent shell stdin
  // Poll log file for incremental output
  // Yield events as they arrive
  // ✅ Shell features work (real bash)
}
```

### 📊 Analysis: exec()

**Current Issues**:
- Two execution paths: `/api/execute` (session) vs `/api/execute/stream` (direct spawn)
- `exec({stream: true})` uses `/api/execute/stream` which bypasses SessionManager
- Streaming path has shell syntax bugs

**Consolidation Opportunity**:
- Both paths should use SessionManager
- `handleStreamingExecute()` should call a dedicated service method, not `startProcess()`
- Create `ProcessService.executeCommandStream()` that mirrors `executeCommand()` but returns streaming

**Proposed Fix**:
```typescript
// NEW: Dedicated streaming execution method
async executeCommandStream(command: string, options: ProcessOptions): Promise<ServiceResult<ProcessRecord>> {
  const sessionId = options.sessionId || 'default';
  const processRecord = this.manager.createProcessRecord(command, undefined, options);

  // Use SessionManager for streaming
  const streamPromise = this.sessionManager.executeStreamInSession(
    sessionId,
    command,
    (event) => { /* route to listeners */ },
    options.cwd
  );

  await this.store.create(processRecord);
  return { success: true, data: processRecord };
}
```

---

## 2. execStream(command, options?)

**Purpose**: Return raw SSE stream for user to parse themselves

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async execStream(command: string, options?: StreamOptions): Promise<ReadableStream<Uint8Array>> {
  const sessionId = await this.ensureDefaultSession();
  return this.client.commands.executeStream(command, sessionId);
}
```

### CommandClient Layer
```typescript
// packages/sandbox/src/clients/command-client.ts
async executeStream(command: string, sessionId: string): Promise<ReadableStream<Uint8Array>> {
  const response = await this.doFetch('/api/execute/stream', {
    method: 'POST',
    body: JSON.stringify({ command, sessionId }),
  });

  // Return raw stream (user parses with parseSSEStream)
  return response.body!;
}
```

### Container Handler Layer
```typescript
// Same as exec({stream: true}) - uses handleStreamingExecute()
// Routes to /api/execute/stream
```

### 📊 Analysis: execStream()

**Current Issues**:
- Same as `exec({stream: true})` - both use `/api/execute/stream`
- Same shell syntax bugs

**Consolidation Opportunity**:
- Share implementation with `exec({stream: true})`
- Both benefit from SessionManager consolidation

---

## 3. startProcess(command, options?)

**Purpose**: Start a background process that runs independently

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async startProcess(command: string, options?: ProcessOptions): Promise<Process> {
  const sessionId = await this.ensureDefaultSession();
  return this.client.processes.start(command, sessionId, options);
}
```

### ProcessClient Layer
```typescript
// packages/sandbox/src/clients/process-client.ts
async start(command: string, sessionId: string, options?: ProcessOptions): Promise<Process> {
  const response = await this.doFetch('/api/process/start', {
    method: 'POST',
    body: JSON.stringify({ command, sessionId, ...options }),
  });

  return await response.json();
}
```

### Container Handler Layer
```typescript
// packages/sandbox-container/src/handlers/process-handler.ts
async handle(request: Request, context: RequestContext): Promise<Response> {
  if (pathname === '/api/process/start') {
    return await this.handleStartProcess(request, context);
  }
  // ... other routes
}

private async handleStartProcess(request: Request, context: RequestContext): Promise<Response> {
  const body = this.getValidatedData<StartProcessRequest>(context);

  // ✅ Uses dedicated endpoint (not shared with exec streaming)
  const result = await this.processService.startProcess(body.command, {
    sessionId: body.sessionId || context.sessionId,
    cwd: body.cwd,
  });

  if (result.success) {
    return new Response(JSON.stringify(result.data), { status: 200 });
  }
  return this.createErrorResponse(result.error!, 400, context);
}
```

### Service Layer
```typescript
// packages/sandbox-container/src/services/process-service.ts
async startProcess(command: string, options: ProcessOptions): Promise<ServiceResult<ProcessRecord>> {
  // ❌ CURRENT: Naive parsing + direct spawn (no SessionManager)
  const { executable, args } = this.manager.parseCommand(command);
  const spawnResult = this.adapter.spawn(executable, args, { ... });

  // Create process record, track in store
  // Process runs in background
}
```

### 📊 Analysis: startProcess()

**Current Issues**:
- Does NOT use SessionManager
- Uses naive parsing (same bugs as exec streaming)
- Intended for background processes but used by exec streaming too

**Key Question**: Should background processes use SessionManager?

**Answer**: YES!
- Background processes should inherit session state (env vars, cwd)
- Shell syntax should work for background processes too
- Example: `startProcess('for i in 1 2 3; do echo $i; sleep 1; done')`

**Consolidation Opportunity**:
- `startProcess()` should use SessionManager for background processes
- Keep separate from `executeCommandStream()` (different semantics)
- `startProcess()` = fire and forget, returns immediately
- `executeCommandStream()` = streaming execution, completes when done

**Proposed Design**:
```typescript
// Background process - runs independently
async startProcess(command: string, options: ProcessOptions) {
  const sessionId = options.sessionId || 'default';
  const processRecord = this.manager.createProcessRecord(command, undefined, options);

  // Use SessionManager but don't wait for completion
  this.sessionManager.executeStreamInSession(
    sessionId,
    command,
    (event) => { /* update process record */ },
    options.cwd
  ).catch(error => {
    // Handle errors async
    processRecord.status = 'error';
  });

  await this.store.create(processRecord);
  return { success: true, data: processRecord };
}

// Streaming execution - waits for completion
async executeCommandStream(command: string, options: ProcessOptions) {
  // Almost identical but caller waits for stream to complete
  // Used by exec({stream: true}) and execStream()
}
```

**Wait, these are almost the same!** The only difference is semantic - both start streaming and return immediately. The distinction is:
- `startProcess()`: Caller doesn't care about completion, just wants process ID
- `executeCommandStream()`: Caller will consume stream via SSE

Maybe they should be the same implementation?

---

## 4. listProcesses()

**Purpose**: Get all running/completed processes

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async listProcesses(): Promise<Process[]> {
  return this.client.processes.list();
}
```

### ProcessClient Layer
```typescript
// packages/sandbox/src/clients/process-client.ts
async list(): Promise<Process[]> {
  const response = await this.doFetch('/api/process/list', { method: 'GET' });
  return await response.json();
}
```

### Container Handler Layer
```typescript
// packages/sandbox-container/src/handlers/process-handler.ts
private async handleListProcesses(request: Request, context: RequestContext): Promise<Response> {
  const result = await this.processService.listProcesses();

  if (result.success) {
    return new Response(JSON.stringify(result.data), { status: 200 });
  }
  return this.createErrorResponse(result.error!, 500, context);
}
```

### Service Layer
```typescript
// packages/sandbox-container/src/services/process-service.ts
async listProcesses(filters?: ProcessFilters): Promise<ServiceResult<ProcessRecord[]>> {
  const processes = await this.store.list(filters);
  return { success: true, data: processes };
}
```

### 📊 Analysis: listProcesses()

**Current State**: ✅ Clean - just queries the store

**Consolidation Impact**: None - independent operation

---

## 5. getProcess(id)

**Purpose**: Get details of a specific process

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async getProcess(id: string): Promise<Process | null> {
  return this.client.processes.get(id);
}
```

### ProcessClient Layer
```typescript
// packages/sandbox/src/clients/process-client.ts
async get(id: string): Promise<Process | null> {
  const response = await this.doFetch(`/api/process/${id}`, { method: 'GET' });
  return await response.json();
}
```

### Container Handler Layer
```typescript
// packages/sandbox-container/src/handlers/process-handler.ts
// Handles GET /api/process/:id
const result = await this.processService.getProcess(processId);
```

### Service Layer
```typescript
// packages/sandbox-container/src/services/process-service.ts
async getProcess(id: string): Promise<ServiceResult<ProcessRecord>> {
  const process = await this.store.get(id);

  if (!process) {
    return { success: false, error: { message: `Process ${id} not found`, code: 'PROCESS_NOT_FOUND' } };
  }

  return { success: true, data: process };
}
```

### 📊 Analysis: getProcess()

**Current State**: ✅ Clean - just queries the store

**Consolidation Impact**: None - independent operation

---

## 6. killProcess(id, signal?)

**Purpose**: Terminate a specific process

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async killProcess(id: string, signal?: string): Promise<void> {
  return this.client.processes.kill(id, signal);
}
```

### ProcessClient Layer
```typescript
// packages/sandbox/src/clients/process-client.ts
async kill(id: string, signal?: string): Promise<void> {
  await this.doFetch(`/api/process/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ signal }),
  });
}
```

### Container Handler Layer
```typescript
// packages/sandbox-container/src/handlers/process-handler.ts
// Handles DELETE /api/process/:id
const result = await this.processService.killProcess(processId);
```

### Service Layer
```typescript
// packages/sandbox-container/src/services/process-service.ts
async killProcess(id: string): Promise<ServiceResult<void>> {
  const process = await this.store.get(id);

  if (!process) {
    return { success: false, error: { message: `Process ${id} not found`, code: 'PROCESS_NOT_FOUND' } };
  }

  if (process.subprocess) {
    this.adapter.kill(process.subprocess);
    await this.store.update(id, { status: 'killed', endTime: new Date() });
  }

  return { success: true };
}
```

### 📊 Analysis: killProcess()

**Current State**: ✅ Clean - kills subprocess directly

**Consolidation Impact**:
- If we move to SessionManager, how do we kill a command running in a session?
- Sessions run in persistent bash - commands are bash subprocesses
- We might not have direct subprocess handles anymore

**Key Question**: Can we kill commands running in a session?

**Investigation Needed**: How does SessionManager handle killing?

---

## 7. killAllProcesses()

**Purpose**: Terminate all processes

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async killAllProcesses(): Promise<number> {
  return this.client.processes.killAll();
}
```

### ProcessClient Layer
```typescript
// packages/sandbox/src/clients/process-client.ts
async killAll(): Promise<number> {
  const response = await this.doFetch('/api/process/kill-all', {
    method: 'POST',
  });
  const data = await response.json();
  return data.count;
}
```

### Container Handler Layer
```typescript
// packages/sandbox-container/src/handlers/process-handler.ts
const result = await this.processService.killAllProcesses();
```

### Service Layer
```typescript
// packages/sandbox-container/src/services/process-service.ts
async killAllProcesses(): Promise<ServiceResult<number>> {
  const processes = await this.store.list({ status: 'running' });
  let killed = 0;

  for (const process of processes) {
    const result = await this.killProcess(process.id);
    if (result.success) killed++;
  }

  return { success: true, data: killed };
}
```

### 📊 Analysis: killAllProcesses()

**Current State**: ✅ Loops through processes and kills each

**Consolidation Impact**: Same as killProcess() - depends on how session killing works

---

## 8. streamProcessLogs(processId, options?)

**Purpose**: Stream logs from a running background process

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async streamProcessLogs(processId: string, options?: { signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
  return this.client.processes.streamLogs(processId, options);
}
```

### ProcessClient Layer
```typescript
// packages/sandbox/src/clients/process-client.ts
async streamLogs(processId: string, options?: { signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>> {
  const response = await this.doFetch(`/api/process/${processId}/stream`, {
    method: 'GET',
    signal: options?.signal,
  });

  return response.body!;
}
```

### Container Handler Layer
```typescript
// packages/sandbox-container/src/handlers/process-handler.ts
// Handles GET /api/process/:id/stream
const result = await this.processService.streamProcessLogs(processId);

if (result.success) {
  // Convert to SSE stream
  const readableStream = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        const sseData = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(new TextEncoder().encode(sseData));
      }
      controller.close();
    },
  });

  return new Response(readableStream, {
    headers: { 'Content-Type': 'text/event-stream', ... }
  });
}
```

### Service Layer
```typescript
// packages/sandbox-container/src/services/process-service.ts
async streamProcessLogs(id: string): Promise<ServiceResult<ReadableStream>> {
  const process = await this.store.get(id);

  if (!process) {
    return { success: false, error: { message: `Process ${id} not found`, code: 'PROCESS_NOT_FOUND' } };
  }

  // ❌ CURRENT: Returns subprocess.stdout directly
  const stdout = process.subprocess?.stdout;

  if (!stdout || typeof stdout === 'number') {
    return { success: false, error: { message: `Process ${id} has no stdout stream`, code: 'NO_STDOUT_STREAM' } };
  }

  return { success: true, data: stdout };
}
```

### 📊 Analysis: streamProcessLogs()

**Current Issues**:
- Returns `subprocess.stdout` directly
- If we move to SessionManager, subprocesses won't have direct stdout handles
- Need to stream from process record's output listeners instead

**Consolidation Impact**: MAJOR
- Can't return subprocess.stdout if using SessionManager
- Need to create stream from process record's buffered output + listeners

**Proposed Fix**:
```typescript
async streamProcessLogs(id: string): Promise<ServiceResult<ReadableStream>> {
  const process = await this.store.get(id);

  if (!process) {
    return { success: false, error: { ... } };
  }

  // Create stream from process record (not subprocess)
  const stream = new ReadableStream({
    start(controller) {
      // Send buffered output
      if (process.stdout) {
        const data = `data: ${JSON.stringify({ type: 'stdout', data: process.stdout })}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
      }

      // Set up listener for future output
      const outputListener = (stream: 'stdout' | 'stderr', data: string) => {
        const event = `data: ${JSON.stringify({ type: stream, data })}\n\n`;
        controller.enqueue(new TextEncoder().encode(event));
      };

      process.outputListeners.add(outputListener);

      // Clean up when stream closes
      return () => {
        process.outputListeners.delete(outputListener);
      };
    }
  });

  return { success: true, data: stream };
}
```

---

## 9. getProcessLogs(id)

**Purpose**: Get accumulated logs from a process

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async getProcessLogs(id: string): Promise<{ stdout: string; stderr: string; processId: string }> {
  return this.client.processes.getLogs(id);
}
```

### ProcessClient Layer
```typescript
// packages/sandbox/src/clients/process-client.ts
async getLogs(id: string): Promise<{ stdout: string; stderr: string; processId: string }> {
  const response = await this.doFetch(`/api/process/${id}/logs`, { method: 'GET' });
  return await response.json();
}
```

### Container Handler Layer
```typescript
// packages/sandbox-container/src/handlers/process-handler.ts
// Handles GET /api/process/:id/logs
const process = await this.processService.getProcess(processId);

if (result.success) {
  return new Response(JSON.stringify({
    processId: result.data.id,
    stdout: result.data.stdout,
    stderr: result.data.stderr,
  }), { status: 200 });
}
```

### 📊 Analysis: getProcessLogs()

**Current State**: ✅ Returns buffered output from process record

**Consolidation Impact**: ✅ None - process record will still have stdout/stderr buffers

---

## 10. cleanupCompletedProcesses()

**Purpose**: Remove old completed processes from store

### Client SDK Layer
```typescript
// packages/sandbox/src/sandbox.ts
async cleanupCompletedProcesses(): Promise<number> {
  return this.client.processes.cleanup();
}
```

### ProcessClient Layer
```typescript
// packages/sandbox/src/clients/process-client.ts
async cleanup(): Promise<number> {
  const response = await this.doFetch('/api/process/cleanup', {
    method: 'POST',
  });
  const data = await response.json();
  return data.count;
}
```

### Service Layer
```typescript
// packages/sandbox-container/src/services/process-service.ts
// Automatic cleanup runs every 30 minutes
private startCleanupProcess(): void {
  this.cleanupInterval = setInterval(async () => {
    const thirtyMinutesAgo = this.manager.createCleanupCutoffDate(30);
    const cleaned = await this.store.cleanup(thirtyMinutesAgo);
  }, 30 * 60 * 1000);
}
```

### 📊 Analysis: cleanupCompletedProcesses()

**Current State**: ✅ Clean - just removes old records from store

**Consolidation Impact**: None - independent operation

---

## Summary Table (UPDATED with Unified Approach)

| Method | Current Implementation | Uses SessionManager? | Shell Syntax Works? | Action Required |
|--------|----------------------|---------------------|-------------------|-----------------|
| `exec()` (no stream) | `/api/execute` → `executeCommand()` | ✅ Yes | ✅ Yes | ✅ No changes needed |
| `exec({stream: true})` | `/api/execute/stream` → `startProcess()` | ❌ No | ❌ No | 🔧 Use `executeCommandStream()` |
| `execStream()` | `/api/execute/stream` → `startProcess()` | ❌ No | ❌ No | 🔧 Use `executeCommandStream()` |
| `startProcess()` | `/api/process/start` → `startProcess()` | ❌ No | ❌ No | 🔧 Use SessionManager with killing |
| `listProcesses()` | Query store | N/A | N/A | ✅ No changes needed |
| `getProcess()` | Query store | N/A | N/A | ✅ No changes needed |
| `killProcess()` | Kill subprocess | N/A | N/A | 🔧 Use `SessionManager.killCommand()` |
| `killAllProcesses()` | Loop kill subprocesses | N/A | N/A | 🔧 Loop using SessionManager |
| `streamProcessLogs()` | Return subprocess.stdout | N/A | N/A | 🔧 Create stream from listeners |
| `getProcessLogs()` | Return buffered output | N/A | N/A | ✅ No changes needed |
| `cleanupCompletedProcesses()` | Remove from store | N/A | N/A | ✅ No changes needed |

---

## Key Findings (UPDATED)

### 1. All Execution Needs SessionManager

**Problem**: `exec({stream: true})`, `execStream()`, and `startProcess()` all use broken streaming path without SessionManager.

**Critical insight**: Background processes need session state too! Users expect:
```typescript
await sandbox.exec('cd /my-app && export API_KEY=secret');
await sandbox.startProcess('npm start');  // Should run in /my-app with API_KEY!
```

**Solution**: Use SessionManager for ALL execution + add command killing:

```typescript
// 1. Enhance Session class to track command PIDs
class Session {
  private runningCommands = new Map<string, CommandHandle>();

  async killCommand(commandId: string): Promise<boolean> {
    // Read PID from file, send SIGTERM
  }
}

// 2. Add SessionManager.killCommand()
class SessionManager {
  async killCommand(sessionId: string, commandId: string): Promise<ServiceResult<void>> {
    // Delegates to Session.killCommand()
  }
}

// 3. Unified ProcessService implementation
async executeCommand(command: string, options: ProcessOptions) {
  // Non-streaming: SessionManager.executeInSession()
}

async executeCommandStream(command: string, options: ProcessOptions) {
  // Streaming: SessionManager.executeStreamInSession()
  // Stores commandHandle for killing
}

async startProcess(command: string, options: ProcessOptions) {
  // Same as executeCommandStream()
  return this.executeCommandStream(command, options);
}

async killProcess(id: string) {
  // Use SessionManager.killCommand()
}
```

This gives us:
- ✅ All execution uses SessionManager (session state everywhere)
- ✅ Shell features work everywhere (persistent bash)
- ✅ Background processes can be killed (PID tracking)
- ✅ Background processes inherit session state (cd, export work)

### 2. Process Killing Solution: PID Tracking

**Answer**: Modify FIFO script to capture command PID and track in Session:

```bash
# In buildFIFOScript():
{ ${command}; } > "$sp" 2> "$ep" & CMD_PID=$!
echo "$CMD_PID" > ${safePidFile}
wait "$CMD_PID"
```

Then Session can kill by reading PID and sending SIGTERM:
```typescript
const pid = parseInt(await Bun.file(handle.pidFile).text());
process.kill(pid, 'SIGTERM');
```

### 3. Process Log Streaming Solution: Use Listeners

**Current**: Returns `subprocess.stdout` directly (won't exist with SessionManager)

**Solution**: Create stream from process record's listeners + buffered output:
```typescript
const stream = new ReadableStream({
  start(controller) {
    // Send buffered output
    if (process.stdout) {
      controller.enqueue(encode({ type: 'stdout', data: process.stdout }));
    }

    // Add listener for future output
    const listener = (stream, data) => {
      controller.enqueue(encode({ type: stream, data }));
    };
    process.outputListeners.add(listener);

    // Cleanup
    return () => process.outputListeners.delete(listener);
  }
});
```

---

## Revised Consolidation Plan (FINAL)

### Phase 1: Enhance Session with Command Killing ✅
- Add `runningCommands` map to track command handles
- Modify `buildFIFOScript()` to capture command PID
- Add `killCommand(commandId)` method
- Track commands when they start, untrack when they complete

### Phase 2: Add SessionManager.killCommand() ✅
- Delegate to Session.killCommand()
- Return ServiceResult<void>

### Phase 3: Make SessionManager Required ✅
- Remove optional parameter from ProcessService
- Update all tests

### Phase 4: Add executeCommandStream() Method ✅
- New method for streaming execution via SessionManager
- Stores commandHandle instead of subprocess
- Used by exec({stream: true}) and execStream()

### Phase 5: Update startProcess() to Use SessionManager ✅
- Call executeCommandStream() (same implementation)
- Background processes now inherit session state

### Phase 6: Update killProcess() and Related Methods ✅
- Use SessionManager.killCommand() instead of subprocess.kill()
- Update streamProcessLogs() to use listeners instead of subprocess.stdout

### Phase 7: Update Tests ✅
- Provide SessionManager to all ProcessService tests
- Remove `bash -c` workarounds
- Test session state in background processes

---

## Questions Resolved

1. **Session Killing**: ✅ RESOLVED
   - Add `Session.killCommand(commandId)` method
   - Capture command PID in FIFO script
   - Send SIGTERM via process.kill(pid)

2. **Process vs Session**: ✅ RESOLVED
   - ProcessRecord stores `commandHandle: { sessionId, commandId }`
   - Enables killing via SessionManager
   - All execution tied to sessions

3. **Handler Separation**: ✅ RESOLVED
   - Keep handlers separate (ExecuteHandler vs ProcessHandler)
   - Share service implementation (both use executeCommandStream)
   - Handlers differ in how they consume process record
