# Timeout Cleanup Plan

**Goal**: Remove arbitrary timeout limits from user code execution paths while maintaining sensible infrastructure-level timeouts.

## Problem Statement

Currently, the codebase has hardcoded timeouts in multiple places:
- 30s timeout for interpreter code execution (JS/TS/Python)
- 30s timeout for VM execution (JS/TS)
- 30s default for shell commands (changed from original implementation)
- 5s/60s timeout for interpreter process spawning
- 10s timeout for pre-warm scripts

The 30s limits on user code are arbitrary and prevent legitimate use cases like:
- Training ML models
- Processing large datasets
- Running scientific computations
- Long-running builds (`npm install`, `cargo build`, etc.)

## Categorization

### Category 1: Infrastructure Timeouts (MUST have defaults)

These protect against system-level failures, not user code issues:

| Timeout | Current | Proposed | Reason |
|---------|---------|----------|--------|
| Interpreter spawn | 5s (code says 5s, analysis mentions 60s) | 60s | If interpreter doesn't start, something is broken |
| Pre-warm script | 10s | 30s | Internal warmup; hangs indicate pool setup issues |

**These are non-negotiable system health checks.**

### Category 2: User Code Timeouts (should NOT have defaults)

These are user-controlled operations that might legitimately run indefinitely:

| Timeout | Current | Proposed | Reason |
|---------|---------|----------|--------|
| Interpreter code execution | 30s | **Unlimited** (unless user specifies) | User code might legitimately run for hours |
| VM execution (JS/TS) | 30s | **Unlimited** (unless user specifies) | Same as interpreter |
| Foreground shell command | 30s | **Unlimited** (unless user specifies) | Commands like `npm install` can take a long time |
| Streaming/background command | Unlimited | Unlimited ✓ | Already correct |

**Users should explicitly opt-in to timeouts if they want protection against runaway code.**

## Implementation Plan

### Phase 1: Centralized Configuration

Create `packages/sandbox-container/src/config.ts`:

```typescript
export const CONFIG = {
  // ========================================================================
  // INFRASTRUCTURE TIMEOUTS (Required - protect against system failures)
  // ========================================================================

  /** How long to wait for interpreter process to spawn (system health check) */
  INTERPRETER_SPAWN_TIMEOUT_MS: parseInt(
    process.env.INTERPRETER_SPAWN_TIMEOUT_MS || '60000', // 60 seconds
    10
  ),

  /** Timeout for internal pre-warm scripts (system health check) */
  INTERPRETER_PREWARM_TIMEOUT_MS: parseInt(
    process.env.INTERPRETER_PREWARM_TIMEOUT_MS || '30000', // 30 seconds
    10
  ),

  // ========================================================================
  // USER CODE TIMEOUTS (Optional - unlimited by default)
  // ========================================================================

  /**
   * Timeout for interpreter code execution (Python/JS/TS).
   * Default: 0 (unlimited)
   * Users can set via env var or pass to execute() method
   */
  INTERPRETER_EXECUTION_TIMEOUT_MS: (() => {
    const val = parseInt(process.env.INTERPRETER_EXECUTION_TIMEOUT_MS || '0', 10);
    return val === 0 ? undefined : val;
  })(),

  /**
   * Timeout for VM execution (JS/TS vm.runInContext).
   * Default: 0 (unlimited)
   * Users can set via env var or pass in execution request
   */
  VM_EXECUTION_TIMEOUT_MS: (() => {
    const val = parseInt(process.env.VM_EXECUTION_TIMEOUT_MS || '0', 10);
    return val === 0 ? undefined : val;
  })(),

  /**
   * Timeout for foreground shell command execution.
   * Default: 0 (unlimited)
   * Users can set via env var or pass to Session constructor
   */
  COMMAND_TIMEOUT_MS: (() => {
    const val = parseInt(process.env.COMMAND_TIMEOUT_MS || '0', 10);
    return val === 0 ? undefined : val;
  })(),

  // ========================================================================
  // OTHER EXISTING CONFIG
  // ========================================================================

  /** Maximum output size in bytes (prevents OOM attacks) */
  MAX_OUTPUT_SIZE_BYTES: parseInt(
    process.env.MAX_OUTPUT_SIZE_BYTES || String(10 * 1024 * 1024),
    10
  ), // 10MB default

  /** Default working directory */
  DEFAULT_CWD: '/workspace',

  /** Delay between chunks when streaming (debounce for fs.watch) */
  STREAM_CHUNK_DELAY_MS: 100,
} as const;
```

### Phase 2: Update Container Layer

#### 2.1. `packages/sandbox-container/src/session.ts`

**Changes:**
- Remove local `CONFIG` constant
- Import from centralized `config.ts`
- Update constructor to accept `commandTimeoutMs?: number` (already supports this ✓)
- Pass `undefined` to `waitForExitCode()` if no timeout is set

**Key change in `waitForExitCode()`:**
```typescript
private async waitForExitCode(exitCodeFile: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const dir = dirname(exitCodeFile);
    const filename = basename(exitCodeFile);

    // ... watcher setup ...

    // Set up timeout ONLY if configured
    if (this.commandTimeoutMs !== undefined) {
      setTimeout(() => {
        watcher.close();
        reject(new Error(`Command timeout after ${this.commandTimeoutMs}ms`));
      }, this.commandTimeoutMs);
    }
    // Otherwise, wait indefinitely
  });
}
```

#### 2.2. `packages/sandbox-container/src/runtime/process-pool.ts`

**Changes:**
- Import centralized CONFIG
- Change `execute()` signature: `timeout?: number` (not `timeout = 30000`)
- Use `timeout ?? CONFIG.INTERPRETER_EXECUTION_TIMEOUT_MS` as the effective timeout
- Update `createProcess()` to use `CONFIG.INTERPRETER_SPAWN_TIMEOUT_MS`
- Update `executePreWarmScript()` to use `CONFIG.INTERPRETER_PREWARM_TIMEOUT_MS`

**Key change in `execute()`:**
```typescript
async execute(
  language: InterpreterLanguage,
  code: string,
  sessionId?: string,
  timeout?: number // Optional, no default!
): Promise<ExecutionResult> {
  const totalStartTime = Date.now();
  const process = await this.getProcess(language, sessionId);
  const processAcquireTime = Date.now() - totalStartTime;

  const executionId = randomUUID();

  try {
    const execStartTime = Date.now();
    const effectiveTimeout = timeout ?? CONFIG.INTERPRETER_EXECUTION_TIMEOUT_MS;
    const result = await this.executeCode(process, code, executionId, effectiveTimeout);
    // ... rest of method
  }
}
```

**Key change in `executeCode()`:**
```typescript
private async executeCode(
  process: InterpreterProcess,
  code: string,
  executionId: string,
  timeout?: number // Can be undefined = unlimited
): Promise<ExecutionResult> {
  const request = JSON.stringify({ code, executionId, timeout });

  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;

    // Only set timeout if specified
    if (timeout !== undefined) {
      timer = setTimeout(() => {
        // NOTE: This currently leaks listeners and doesn't kill the child!
        // TODO: Kill the child process and remove listeners on timeout
        reject(new Error("Execution timeout"));
      }, timeout);
    }

    let responseBuffer = "";

    const responseHandler = (data: Buffer) => {
      responseBuffer += data.toString();

      try {
        const response = JSON.parse(responseBuffer);
        if (timer) clearTimeout(timer);
        process.process.stdout?.removeListener("data", responseHandler);

        resolve({
          stdout: response.stdout || "",
          stderr: response.stderr || "",
          success: response.success !== false,
          executionId,
          outputs: response.outputs || [],
          error: response.error || null,
        });
      } catch (e) {
        // Incomplete JSON, keep buffering
      }
    };

    process.process.stdout?.on("data", responseHandler);
    process.process.stdin?.write(`${request}\n`);
  });
}
```

#### 2.3. `packages/sandbox-container/src/runtime/executors/javascript/node_executor.ts`

**Changes:**
- Accept optional `timeout` field in JSON request
- Use `CONFIG.VM_EXECUTION_TIMEOUT_MS` as fallback
- Only pass `timeout` option to `vm.runInContext()` if defined

**Key change:**
```typescript
rl.on('line', async (line: string) => {
  try {
    const request = JSON.parse(line);
    const { code, executionId, timeout } = request;

    // ... output capture setup ...

    try {
      const effectiveTimeout = timeout ?? CONFIG.VM_EXECUTION_TIMEOUT_MS;
      const options: any = {
        filename: `<execution-${executionId}>`,
      };

      // Only add timeout if specified (undefined = unlimited)
      if (effectiveTimeout !== undefined) {
        options.timeout = effectiveTimeout;
      }

      result = vm.runInContext(code, context, options);

    } catch (error: unknown) {
      // ... error handling ...
    }
    // ... response ...
  }
});
```

#### 2.4. `packages/sandbox-container/src/runtime/executors/typescript/ts_executor.ts`

Same changes as `node_executor.ts` above.

#### 2.5. `packages/sandbox-container/src/interpreter-service.ts`

**Changes:**
- Accept optional `timeoutMs` in execute request body
- Pass to `processPool.execute()`

**Key change:**
```typescript
async executeCode(
  contextId: string,
  code: string,
  language?: string,
  timeoutMs?: number // New parameter
): Promise<Response> {
  // ... context lookup ...

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const startTime = Date.now();

      try {
        const result = await processPool.execute(
          execLanguage,
          code,
          contextId,
          timeoutMs // Pass through user-provided timeout
        );

        // ... rest of streaming logic ...
      }
    }
  });

  return new Response(stream, { /* ... */ });
}
```

#### 2.6. `packages/sandbox-container/src/services/session-manager.ts`

**Changes:**
- Add optional `timeoutMs` parameter to `executeInSession()` method
- Pass through to `Session` constructor via options

**Key change:**
```typescript
async executeInSession(
  sessionId: string,
  command: string,
  cwd?: string,
  timeoutMs?: number // New parameter
): Promise<ServiceResult<RawExecResult>> {
  try {
    let sessionResult = await this.getSession(sessionId);

    if (!sessionResult.success && sessionResult.error!.code === 'SESSION_NOT_FOUND') {
      sessionResult = await this.createSession({
        id: sessionId,
        cwd: cwd || '/workspace',
        commandTimeoutMs: timeoutMs, // Pass timeout to session
      });
    }

    if (!sessionResult.success) {
      return sessionResult as ServiceResult<RawExecResult>;
    }

    const session = sessionResult.data;
    const result = await session.exec(command, cwd ? { cwd } : undefined);

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    // ... error handling ...
  }
}
```

### Phase 3: Update Services

#### 3.1. `packages/sandbox-container/src/services/process-service.ts`

**Changes:**
- Add optional `timeoutMs` parameter to `executeCommand()` method
- Pass through to `SessionManager.executeInSession()`

### Phase 4: Update Handlers

#### 4.1. `packages/sandbox-container/src/handlers/execute-handler.ts`

**Changes:**
- Accept optional `timeoutMs` field in `ExecuteRequest` body
- Pass to `processService.executeCommand()`

**Key change:**
```typescript
private async handleExecute(request: Request, context: RequestContext): Promise<Response> {
  const body = this.getValidatedData<ExecuteRequest>(context);
  const sessionId = body.sessionId || context.sessionId;

  if (body.background) {
    const processResult = await this.processService.startProcess(body.command, {
      sessionId,
      timeoutMs: body.timeoutMs, // Pass timeout
    });
    // ... rest
  }

  const result = await this.processService.executeCommand(body.command, {
    sessionId,
    timeoutMs: body.timeoutMs, // Pass timeout
  });

  // ... rest
}
```

#### 4.2. Interpreter execute handler

Update the handler that calls `InterpreterService.executeCode()` to accept and pass `timeoutMs`.

### Phase 5: Update Client SDK

#### 5.1. `packages/sandbox/src/clients/types.ts`

**Changes:**
- Add optional `timeoutMs` field to `ExecuteRequest` interface

```typescript
export interface ExecuteRequest extends SessionRequest {
  command: string;
  timeoutMs?: number; // Optional timeout in milliseconds
}
```

#### 5.2. `packages/sandbox/src/clients/command-client.ts`

**Changes:**
- Add optional `timeoutMs` parameter to `execute()` method
- Include in request body when provided

```typescript
async execute(
  command: string,
  sessionId: string,
  timeoutMs?: number // New parameter
): Promise<ExecuteResponse> {
  try {
    const data: ExecuteRequest = {
      command,
      sessionId,
      ...(timeoutMs !== undefined && { timeoutMs })
    };

    const response = await this.post<ExecuteResponse>(
      '/api/execute',
      data
    );

    // ... rest
  }
}
```

#### 5.3. `packages/sandbox/src/clients/interpreter-client.ts`

**Changes:**
- Add optional `timeoutMs` parameter to `runCodeStream()` method
- Include in request body

```typescript
async runCodeStream(
  contextId: string | undefined,
  code: string,
  language: string | undefined,
  callbacks: ExecutionCallbacks,
  timeoutMs?: number // New parameter
): Promise<void> {
  return this.executeWithRetry(async () => {
    const response = await this.doFetch("/api/execute/code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        context_id: contextId,
        code,
        language,
        ...(timeoutMs !== undefined && { timeout_ms: timeoutMs })
      }),
    });

    // ... rest
  });
}
```

### Phase 6: Fix Existing Bugs

While implementing, fix the listener leak bug in `process-pool.ts`:

**Current bug in `executeCode()` line 302-330:**
- On timeout, the promise rejects but the stdout listener is NOT removed
- The child process is NOT killed
- This causes stale output to interfere with subsequent executions

**Fix:**
```typescript
private async executeCode(
  process: InterpreterProcess,
  code: string,
  executionId: string,
  timeout?: number
): Promise<ExecutionResult> {
  const request = JSON.stringify({ code, executionId, timeout });

  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      process.process.stdout?.removeListener("data", responseHandler);
    };

    if (timeout !== undefined) {
      timer = setTimeout(() => {
        cleanup();
        // TODO: Consider killing the child process here
        // process.process.kill('SIGTERM');
        reject(new Error("Execution timeout"));
      }, timeout);
    }

    let responseBuffer = "";

    const responseHandler = (data: Buffer) => {
      responseBuffer += data.toString();

      try {
        const response = JSON.parse(responseBuffer);
        cleanup();

        resolve({
          stdout: response.stdout || "",
          stderr: response.stderr || "",
          success: response.success !== false,
          executionId,
          outputs: response.outputs || [],
          error: response.error || null,
        });
      } catch (e) {
        // Incomplete JSON, keep buffering
      }
    };

    process.process.stdout?.on("data", responseHandler);
    process.process.stdin?.write(`${request}\n`);
  });
}
```

## Environment Variables

After this change, users can configure timeouts via:

| Environment Variable | Purpose | Default | Valid Values |
|---------------------|---------|---------|--------------|
| `INTERPRETER_SPAWN_TIMEOUT_MS` | Interpreter startup timeout (infrastructure) | 60000 (60s) | Any positive integer |
| `INTERPRETER_PREWARM_TIMEOUT_MS` | Pre-warm script timeout (infrastructure) | 30000 (30s) | Any positive integer |
| `INTERPRETER_EXECUTION_TIMEOUT_MS` | Python/JS/TS code execution timeout | 0 (unlimited) | 0 = unlimited, or positive integer |
| `VM_EXECUTION_TIMEOUT_MS` | JS/TS vm.runInContext timeout | 0 (unlimited) | 0 = unlimited, or positive integer |
| `COMMAND_TIMEOUT_MS` | Shell command execution timeout | 0 (unlimited) | 0 = unlimited, or positive integer |
| `MAX_OUTPUT_SIZE_BYTES` | Maximum output size | 10485760 (10MB) | Any positive integer |

## Testing Strategy

### 1. Test Infrastructure Timeouts

```typescript
describe('Infrastructure timeouts', () => {
  it('should timeout if interpreter fails to spawn within 60s', async () => {
    // Test with broken interpreter path
    // Should throw after INTERPRETER_SPAWN_TIMEOUT_MS
  });

  it('should timeout pre-warm scripts after 30s', async () => {
    // Test with infinite loop in pre-warm script
    // Should timeout and log warning, but continue
  });
});
```

### 2. Test Unlimited Execution (Default)

```typescript
describe('User code execution (unlimited by default)', () => {
  it('should allow interpreter code to run for more than 30s', async () => {
    const code = 'import time; time.sleep(35); print("done")';
    const result = await processPool.execute('python', code);
    expect(result.stdout).toContain('done');
  });

  it('should allow shell commands to run for more than 30s', async () => {
    const result = await session.exec('sleep 35 && echo done');
    expect(result.stdout).toContain('done');
  });
});
```

### 3. Test Opt-In Timeouts

```typescript
describe('User-specified timeouts', () => {
  it('should timeout when user specifies timeout parameter', async () => {
    const code = 'import time; time.sleep(10)';
    await expect(
      processPool.execute('python', code, undefined, 5000)
    ).rejects.toThrow('timeout');
  });

  it('should timeout when env var is set', async () => {
    process.env.INTERPRETER_EXECUTION_TIMEOUT_MS = '5000';
    const code = 'import time; time.sleep(10)';
    await expect(
      processPool.execute('python', code)
    ).rejects.toThrow('timeout');
  });
});
```

### 4. Test Timeout Priority (Method > Session > Env Var > Default)

```typescript
describe('Timeout priority', () => {
  it('method parameter overrides env var', async () => {
    process.env.COMMAND_TIMEOUT_MS = '5000';
    const session = new Session({ id: 'test' });
    await session.initialize();

    // Should not timeout (method param = undefined = unlimited)
    const result = await session.exec('sleep 10');
    expect(result.exitCode).toBe(0);
  });

  it('session option overrides env var', async () => {
    process.env.COMMAND_TIMEOUT_MS = '5000';
    const session = new Session({
      id: 'test',
      commandTimeoutMs: undefined // Explicitly unlimited
    });
    await session.initialize();

    const result = await session.exec('sleep 10');
    expect(result.exitCode).toBe(0);
  });
});
```

## Migration Guide

### For Existing Users

**Before:**
```typescript
// Code would timeout after 30s (hardcoded)
await interpreter.runCodeStream(contextId, longRunningCode, 'python', callbacks);
```

**After (unlimited by default):**
```typescript
// No timeout by default - runs until completion
await interpreter.runCodeStream(contextId, longRunningCode, 'python', callbacks);

// Opt-in to timeout if desired
await interpreter.runCodeStream(
  contextId,
  longRunningCode,
  'python',
  callbacks,
  120000 // 2 minutes
);
```

**Via Environment Variables:**
```bash
# Set global default timeout for all interpreter executions
export INTERPRETER_EXECUTION_TIMEOUT_MS=300000  # 5 minutes

# Or unlimited (default)
export INTERPRETER_EXECUTION_TIMEOUT_MS=0
```

## Files to Modify (In Order)

1. ✅ Create `packages/sandbox-container/src/config.ts`
2. ✅ Update `packages/sandbox-container/src/session.ts`
3. ✅ Update `packages/sandbox-container/src/runtime/process-pool.ts`
4. ✅ Update `packages/sandbox-container/src/runtime/executors/javascript/node_executor.ts`
5. ✅ Update `packages/sandbox-container/src/runtime/executors/typescript/ts_executor.ts`
6. ✅ Update `packages/sandbox-container/src/interpreter-service.ts`
7. ✅ Update `packages/sandbox-container/src/services/session-manager.ts`
8. ✅ Update `packages/sandbox-container/src/services/process-service.ts`
9. ✅ Update `packages/sandbox-container/src/handlers/execute-handler.ts`
10. ✅ Update `packages/sandbox/src/clients/types.ts`
11. ✅ Update `packages/sandbox/src/clients/command-client.ts`
12. ✅ Update `packages/sandbox/src/clients/interpreter-client.ts`
13. ✅ Update handler for `/api/execute/code` endpoint
14. ✅ Update tests
15. ✅ Update documentation (README.md)

## Key Principles

1. ✅ **Infrastructure timeouts are required** - they protect against system failures
2. ✅ **User code timeouts are optional** - unlimited by default, user can opt-in
3. ✅ **No arbitrary limits** - if there's no technical reason for a timeout, don't impose one
4. ✅ **Clear configuration** - environment variables for defaults, method parameters for overrides
5. ✅ **Special value 0 or undefined = unlimited** - clear semantic meaning
6. ✅ **Backward compatible** - existing code without timeout params continues to work (but better!)

## Success Criteria

- ✅ No hardcoded timeouts in user code execution paths
- ✅ Infrastructure timeouts remain in place with sensible defaults
- ✅ Users can set global timeout defaults via environment variables
- ✅ Users can override timeouts per-call via method parameters
- ✅ Default behavior is unlimited execution (no arbitrary 30s limit)
- ✅ Existing tests pass with new timeout behavior
- ✅ New tests cover timeout configuration and unlimited execution
- ✅ Documentation explains timeout model clearly
