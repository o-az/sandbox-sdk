# Process Killing Analysis - SessionManager Limitation

## The Problem

Commands executed via SessionManager run in a persistent bash shell:
```bash
# Session spawns ONE bash process
this.shell = Bun.spawn({ cmd: ['bash', '--norc'], stdin: 'pipe', ... });

# Commands are written to shell stdin as bash scripts
this.shell.stdin.write(`{ ${command}; } > "$sp" 2> "$ep"\n`);
```

**We don't have direct subprocess handles** for individual commands - they run inside the persistent bash shell.

## Current Session Interface

```typescript
class Session {
  private shell: Subprocess | null;  // The persistent bash shell

  async exec(command): Promise<RawExecResult>  // Wait for completion
  async *execStream(command): AsyncGenerator<ExecEvent>  // Stream output
  async destroy(): Promise<void>  // Kill the ENTIRE shell

  // ❌ NO METHOD TO KILL INDIVIDUAL COMMANDS
}
```

## Impact on Process Management

### Methods That Need Individual Process Control

1. **`killProcess(id)`** - Kill a specific background process
   - Current: Uses `process.subprocess.kill()`
   - With SessionManager: No subprocess handle available

2. **`killAllProcesses()`** - Kill all background processes
   - Current: Loops through and kills each subprocess
   - With SessionManager: Same problem

3. **`streamProcessLogs(id)`** - Stream logs from running process
   - Current: Returns `process.subprocess.stdout`
   - With SessionManager: No direct stdout access

## Potential Solutions

### Option 1: Track Command PIDs in Session (Complex)

Modify FIFO script to capture command PID:
```bash
{
  # Execute command in background
  { ${command}; } > "$sp" 2> "$ep" & CMD_PID=$!

  # Write PID to file
  echo "$CMD_PID" > ${safePidFile}

  # Wait for command
  wait "$CMD_PID"
  EXIT_CODE=$?
}
```

**Problems**:
- Makes command execution async (breaks current streaming model)
- Still need to send signals to PID from outside bash
- Complex state tracking (PID files, cleanup)
- Race conditions if command exits before PID written

### Option 2: Don't Use SessionManager for Background Processes (RECOMMENDED)

Keep two execution models:

**For Commands (exec/execStream)**:
- Use SessionManager
- Benefit from session state (env vars, cwd, shell functions)
- Commands complete relatively quickly
- No need to kill them individually

**For Background Processes (startProcess)**:
- Use direct spawn with `sh -c` wrapper
- Get subprocess handles for process control
- Can kill individual processes
- Can stream subprocess.stdout directly

**Why this makes sense**:
- Background processes are meant to run independently
- They don't need session state persistence
- They need lifecycle management (kill, monitor)
- Direct subprocess control is the right model

### Option 3: Hybrid - Add Killing to SessionManager (Over-engineered)

Add command tracking to Session:
```typescript
class Session {
  private runningCommands: Map<string, {
    pid: number;
    logFile: string;
    exitCodeFile: string;
  }>;

  async killCommand(commandId: string): Promise<void> {
    const cmd = this.runningCommands.get(commandId);
    if (cmd) {
      // Send SIGTERM to command PID
      process.kill(cmd.pid, 'SIGTERM');
    }
  }
}
```

**Problems**:
- Adds complexity to Session (mixing concerns)
- PID tracking is fragile
- Killing via PID doesn't guarantee cleanup of FIFO pipes
- Session is designed for sequential command execution, not process management

## Chosen Approach: Add Killing to SessionManager

**Decision**: Use SessionManager for ALL execution (commands AND background processes) and add command killing capability.

**Why**: Background processes need session state (cwd, env vars) just like commands. Users expect:
```typescript
await sandbox.exec('cd /my-app');
await sandbox.exec('export API_KEY=secret');
const server = await sandbox.startProcess('npm start');
// Should run in /my-app with API_KEY available!
```

## Implementation: Enhanced Session Class

### 1. Add Command Tracking to Session

```typescript
class Session {
  private shell: Subprocess | null = null;
  private runningCommands = new Map<string, CommandHandle>();  // NEW

  interface CommandHandle {
    commandId: string;
    pid: number;         // The actual command's PID (not shell PID)
    pidFile: string;     // Path to PID file
    logFile: string;
    exitCodeFile: string;
  }
}
```

### 2. Modify FIFO Script to Capture Command PID

```typescript
private buildFIFOScript(
  command: string,
  cmdId: string,
  logFile: string,
  exitCodeFile: string,
  cwd?: string
): string {
  const pidFile = join(this.sessionDir!, `${cmdId}.pid`);
  const safePidFile = this.escapeShellPath(pidFile);

  let script = `{
  # ... FIFO setup (same as before)

  # Execute command in BACKGROUND to capture PID
  { ${command}; } > "$sp" 2> "$ep" & CMD_PID=$!

  # Write PID immediately (so we can kill it)
  echo "$CMD_PID" > ${safePidFile}

  # Wait for command to complete
  wait "$CMD_PID"
  EXIT_CODE=$?

  # Clean up PID file
  rm -f ${safePidFile}

  # ... rest of script (wait for labelers, write exit code)
}`;

  return script;
}
```

**Why this works**:
- Command runs in background (`&`) so we can capture its PID
- PID written to file immediately
- We still wait for command (so exec/execStream work normally)
- PID file allows external killing via `kill -TERM $PID`

### 3. Add Command Killing Method to Session

```typescript
class Session {
  async killCommand(commandId: string): Promise<boolean> {
    const handle = this.runningCommands.get(commandId);
    if (!handle) {
      return false;  // Command not found or already completed
    }

    try {
      // Try reading PID from file (might still exist if command running)
      const pidFile = Bun.file(handle.pidFile);
      if (await pidFile.exists()) {
        const pid = parseInt(await pidFile.text(), 10);

        // Send SIGTERM for graceful termination
        process.kill(pid, 'SIGTERM');

        // Clean up
        this.runningCommands.delete(commandId);
        return true;
      }

      // PID file gone = command already completed
      this.runningCommands.delete(commandId);
      return false;
    } catch (error) {
      // Process already dead or PID invalid
      this.runningCommands.delete(commandId);
      return false;
    }
  }

  // Track commands when they start
  private trackCommand(commandId: string, handle: CommandHandle): void {
    this.runningCommands.set(commandId, handle);
  }

  // Clean up when command completes
  private untrackCommand(commandId: string): void {
    this.runningCommands.delete(commandId);
  }
}
```

### 4. Update SessionManager to Expose Killing

```typescript
class SessionManager {
  async killCommand(sessionId: string, commandId: string): Promise<ServiceResult<void>> {
    try {
      const sessionResult = await this.getSession(sessionId);

      if (!sessionResult.success) {
        return sessionResult as ServiceResult<void>;
      }

      const session = sessionResult.data;
      const killed = await session.killCommand(commandId);

      if (!killed) {
        return {
          success: false,
          error: {
            message: `Command '${commandId}' not found or already completed`,
            code: 'COMMAND_NOT_FOUND',
          },
        };
      }

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: {
          message: `Failed to kill command: ${errorMessage}`,
          code: 'COMMAND_KILL_ERROR',
          details: { sessionId, commandId, originalError: errorMessage },
        },
      };
    }
  }
}
```

### 5. Update ProcessService to Use SessionManager for Everything

```typescript
class ProcessService {
  // For exec() - waits for completion
  async executeCommand(command: string, options: ProcessOptions) {
    const sessionId = options.sessionId || 'default';
    const result = await this.sessionManager.executeInSession(
      sessionId,
      command,
      options.cwd
    );
    return result;
  }

  // For execStream() - streaming execution
  async executeCommandStream(command: string, options: ProcessOptions) {
    const sessionId = options.sessionId || 'default';
    const processRecord = this.manager.createProcessRecord(command, undefined, options);

    // Store command handle for potential killing
    processRecord.commandHandle = {
      sessionId,
      commandId: processRecord.id,  // Use process ID as command ID
    };

    // Start streaming via SessionManager
    this.sessionManager.executeStreamInSession(
      sessionId,
      command,
      (event) => {
        // Route events to process record listeners
      },
      options.cwd
    );

    await this.store.create(processRecord);
    return { success: true, data: processRecord };
  }

  // For startProcess() - background execution (SAME AS executeCommandStream!)
  async startProcess(command: string, options: ProcessOptions) {
    // Identical to executeCommandStream
    // The difference is semantic - caller doesn't wait
    return this.executeCommandStream(command, options);
  }

  // For killProcess() - now uses SessionManager
  async killProcess(id: string): Promise<ServiceResult<void>> {
    const process = await this.store.get(id);

    if (!process) {
      return {
        success: false,
        error: { message: `Process ${id} not found`, code: 'PROCESS_NOT_FOUND' },
      };
    }

    if (process.commandHandle) {
      // Kill via SessionManager
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
}
```

### 6. Update ProcessRecord Type

```typescript
interface ProcessRecord {
  id: string;
  command: string;
  status: ProcessStatus;
  stdout: string;
  stderr: string;
  exitCode?: number;
  startTime: Date;
  endTime?: Date;

  // CHANGE: Instead of subprocess, store command handle
  commandHandle?: {
    sessionId: string;
    commandId: string;
  };

  // Listeners remain the same
  outputListeners: Set<(stream: 'stdout' | 'stderr', data: string) => void>;
  statusListeners: Set<(status: ProcessStatus) => void>;
}
```

## Unified Approach: All Execution Uses SessionManager

### What This Gives Us

1. ✅ **Session state for everything**
   - Commands get env vars, cwd, shell history
   - Background processes also get env vars, cwd
   - Consistent behavior everywhere

2. ✅ **Shell features for everything**
   - SessionManager uses persistent bash
   - Pipes, redirects, loops all work
   - No naive parsing anywhere

3. ✅ **Process control for everything**
   - Session tracks command PIDs
   - Can kill background processes
   - Can monitor any running command

### Methods and Their Implementation

1. **exec()** (non-streaming)
   - Uses `SessionManager.executeInSession()`
   - Waits for completion
   - Returns accumulated output

2. **exec({stream: true})** / **execStream()**
   - Uses `SessionManager.executeStreamInSession()`
   - Streams events in real-time
   - Returns complete when done

3. **startProcess()**
   - Also uses `SessionManager.executeStreamInSession()`
   - Same implementation as streaming exec
   - Difference is semantic - caller doesn't wait

4. **killProcess(id)**
   - Uses `SessionManager.killCommand(sessionId, commandId)`
   - Reads PID from file, sends SIGTERM
   - Works for any running command

## Benefits of This Approach

1. **Unified execution model**
   - Single code path for all execution
   - Consistent behavior everywhere
   - Easier to maintain and reason about

2. **Session state everywhere**
   - Background processes inherit session environment
   - cd, export, shell functions all work
   - Natural user experience

3. **Full process control**
   - Can kill any running command
   - Session tracks command PIDs
   - Works for commands and background processes

4. **Shell features everywhere**
   - SessionManager handles shell syntax
   - No naive parsing anywhere
   - Pipes, redirects, loops just work

5. **Backward compatible**
   - Process management API unchanged
   - Client SDK methods unchanged
   - Only internal implementation changes

## Summary of Changes Required

### Layer 1: Session Class
1. Add `runningCommands` map to track command handles
2. Modify `buildFIFOScript()` to capture command PID via background execution
3. Add `killCommand(commandId)` method to send SIGTERM to running commands
4. Add `trackCommand()` and `untrackCommand()` helper methods

### Layer 2: SessionManager
1. Add `killCommand(sessionId, commandId)` method that delegates to Session
2. Update `executeStreamInSession()` to track command handles (already works, just needs tracking added)

### Layer 3: ProcessService
1. Make SessionManager required (remove optional parameter)
2. Keep `executeCommand()` as-is (already uses SessionManager)
3. Add `executeCommandStream()` method for streaming execution
4. Update `startProcess()` to use `executeCommandStream()` (same implementation)
5. Update `killProcess()` to use `SessionManager.killCommand()`
6. Update `killAllProcesses()` to iterate and kill via SessionManager
7. Remove all direct `adapter.spawn()` calls for execution
8. Remove `parseCommand()` usage from execution paths

### Layer 4: ProcessRecord Type
1. Replace `subprocess?: Subprocess` with `commandHandle?: { sessionId, commandId }`
2. Keep all other fields the same
3. Update any code that accesses `process.subprocess`

### Layer 5: Handler Updates
1. Update `ExecuteHandler.handleStreamingExecute()` to call `executeCommandStream()` instead of `startProcess()`
2. Update `streamProcessLogs()` to create stream from process record listeners instead of subprocess.stdout

## Summary

**Use SessionManager for ALL execution**:

- ✅ **exec()**: SessionManager.executeInSession() - waits for completion
- ✅ **execStream()**: SessionManager.executeStreamInSession() - streams events
- ✅ **startProcess()**: SessionManager.executeStreamInSession() - same as execStream, semantic difference only
- ✅ **killProcess()**: SessionManager.killCommand() - kills via PID from session

This gives us:
- Session state for all execution (env vars, cwd, shell history)
- Shell features everywhere (persistent bash handles syntax)
- Process control everywhere (PID tracking enables killing)
- Unified codebase (one execution model, not two)
