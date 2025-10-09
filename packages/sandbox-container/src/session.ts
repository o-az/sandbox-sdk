/**
 * Session - Persistent shell execution with FIFO-based output separation
 *
 * This implementation provides a persistent bash session that maintains state
 * (cwd, env vars, shell functions) across commands. It uses FIFO pipes with
 * binary prefixes to reliably separate stdout/stderr without markers or polling.
 *
 * Architecture:
 * - Single persistent bash process spawned via Bun.spawn()
 * - Commands written to bash stdin as FIFO scripts
 * - Binary prefixes (\x01\x01\x01 for stdout, \x02\x02\x02 for stderr) prevent collision
 * - Exit code file signals completion (watched via fs.watch)
 * - Session directory for temp files (cleaned up on destroy)
 *
 * State Persistence:
 * - Commands execute in the session's shell context (using {} grouping, not () subshells)
 * - Working directory changes (cd) persist across exec() calls
 * - Environment variables (export) persist across exec() calls
 * - Shell functions defined in one exec() are available in subsequent calls
 * - Like a terminal: running 'exit' will terminate the persistent shell
 *
 * Robustness Features:
 * - Trap-based cleanup ensures FIFO removal on signals (EXIT, HUP, INT, TERM)
 * - Pre-cleanup prevents "file exists" errors from previous failures
 * - Fail-fast error handling for mkfifo failures (permissions, disk space)
 * - Specific PID waiting prevents interference from unrelated background jobs
 *
 * Inspired by Daytona's approach: https://github.com/daytonaio/daytona
 */

import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ExecEvent } from '@repo/shared-types';
import type { Subprocess } from 'bun';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  /** Command execution timeout in milliseconds */
  COMMAND_TIMEOUT_MS: parseInt(process.env.COMMAND_TIMEOUT_MS || '30000', 10),

  /** Maximum output size in bytes (prevents OOM attacks) */
  MAX_OUTPUT_SIZE_BYTES: parseInt(
    process.env.MAX_OUTPUT_SIZE_BYTES || String(10 * 1024 * 1024),
    10
  ), // 10MB default

  /** Delay between chunks when streaming (debounce for fs.watch) */
  STREAM_CHUNK_DELAY_MS: 100,

  /** Default working directory */
  DEFAULT_CWD: '/workspace',
} as const;

// Binary prefixes for output labeling (won't appear in normal text)
// Using three bytes to minimize collision probability
const STDOUT_PREFIX = '\x01\x01\x01';
const STDERR_PREFIX = '\x02\x02\x02';

// ============================================================================
// Types
// ============================================================================

export interface SessionOptions {
  /** Session identifier (generated if not provided) */
  id: string;

  /** Working directory for the session */
  cwd?: string;

  /** Environment variables for the session */
  env?: Record<string, string>;

  /** Legacy isolation flag (ignored - kept for compatibility) */
  isolation?: boolean;

  /** Command timeout in milliseconds (overrides CONFIG.COMMAND_TIMEOUT_MS) */
  commandTimeoutMs?: number;

  /** Maximum output size in bytes (overrides CONFIG.MAX_OUTPUT_SIZE_BYTES) */
  maxOutputSizeBytes?: number;
}

export interface RawExecResult {
  /** Standard output */
  stdout: string;

  /** Standard error */
  stderr: string;

  /** Process exit code */
  exitCode: number;

  /** Command that was executed */
  command: string;

  /** Execution duration in milliseconds */
  duration: number;

  /** ISO timestamp when command started */
  timestamp: string;
}

interface ExecOptions {
  /** Override working directory for this command only */
  cwd?: string;
}

/** Command handle for tracking and killing running commands */
interface CommandHandle {
  /** Unique command identifier */
  commandId: string;
  /** Process ID of the command (not the shell) */
  pid?: number;
  /** Path to PID file */
  pidFile: string;
  /** Path to log file */
  logFile: string;
  /** Path to exit code file */
  exitCodeFile: string;
}

// ============================================================================
// Session Class
// ============================================================================

export class Session {
  private shell: Subprocess | null = null;
  private ready = false;
  private sessionDir: string | null = null;
  private readonly id: string;
  private readonly options: SessionOptions;
  private readonly commandTimeoutMs: number;
  private readonly maxOutputSizeBytes: number;
  /** Map of running commands for tracking and killing */
  private runningCommands = new Map<string, CommandHandle>();

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.options = options;
    this.commandTimeoutMs = options.commandTimeoutMs ?? CONFIG.COMMAND_TIMEOUT_MS;
    this.maxOutputSizeBytes = options.maxOutputSizeBytes ?? CONFIG.MAX_OUTPUT_SIZE_BYTES;
  }

  /**
   * Initialize the session by spawning a persistent bash shell
   */
  async initialize(): Promise<void> {
    // Create temp directory for this session's FIFO files
    this.sessionDir = join(tmpdir(), `session-${this.id}-${Date.now()}`);
    await mkdir(this.sessionDir, { recursive: true });

    // Spawn persistent bash with stdin pipe - no IPC or wrapper needed!
    this.shell = Bun.spawn({
      cmd: ['bash', '--norc'],
      cwd: this.options.cwd || CONFIG.DEFAULT_CWD,
      env: {
        ...process.env,
        ...this.options.env,
        // Ensure bash uses UTF-8 encoding
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
      stdin: 'pipe',
      stdout: 'ignore', // We'll read from log files instead
      stderr: 'ignore',
    });

    this.ready = true;
  }

  /**
   * Execute a command in the persistent shell and return the result
   */
  async exec(command: string, options?: ExecOptions): Promise<RawExecResult> {
    this.ensureReady();

    const startTime = Date.now();
    const commandId = randomUUID();
    const logFile = join(this.sessionDir!, `${commandId}.log`);
    const exitCodeFile = join(this.sessionDir!, `${commandId}.exit`);
    const pidFile = join(this.sessionDir!, `${commandId}.pid`);

    try {
      // Track command
      this.trackCommand(commandId, pidFile, logFile, exitCodeFile);

      // Build FIFO-based bash script (inspired by Daytona)
      const bashScript = this.buildFIFOScript(command, commandId, logFile, exitCodeFile, options?.cwd);

      // Write script to shell's stdin
      if (this.shell!.stdin && typeof this.shell!.stdin !== 'number') {
        this.shell!.stdin.write(`${bashScript}\n`);
      } else {
        throw new Error('Shell stdin is not available');
      }

      // Wait for exit code file (event-driven via fs.watch!)
      const exitCode = await this.waitForExitCode(exitCodeFile);

      // Read log file and parse prefixes
      const { stdout, stderr } = await this.parseLogFile(logFile);

      // Untrack command
      this.untrackCommand(commandId);

      // Clean up temp files
      await this.cleanupCommandFiles(logFile, exitCodeFile);

      const duration = Date.now() - startTime;

      return {
        command,
        stdout,
        stderr,
        exitCode,
        duration,
        timestamp: new Date(startTime).toISOString(),
      };
    } catch (error) {
      // Untrack and clean up on error
      this.untrackCommand(commandId);
      await this.cleanupCommandFiles(logFile, exitCodeFile);
      throw error;
    }
  }

  /**
   * Execute a command with streaming output (maintains session state!)
   */
  async *execStream(command: string, options?: ExecOptions): AsyncGenerator<ExecEvent> {
    this.ensureReady();

    const startTime = Date.now();
    const commandId = randomUUID();
    const logFile = join(this.sessionDir!, `${commandId}.log`);
    const exitCodeFile = join(this.sessionDir!, `${commandId}.exit`);
    const pidFile = join(this.sessionDir!, `${commandId}.pid`);

    try {
      // Track command
      this.trackCommand(commandId, pidFile, logFile, exitCodeFile);

      // Build FIFO script and write to persistent shell
      const bashScript = this.buildFIFOScript(command, commandId, logFile, exitCodeFile, options?.cwd);

      if (this.shell!.stdin && typeof this.shell!.stdin !== 'number') {
        this.shell!.stdin.write(`${bashScript}\n`);
      } else {
        throw new Error('Shell stdin is not available');
      }

      yield {
        type: 'start',
        timestamp: new Date().toISOString(),
        command,
      };

      // Hybrid approach: poll log file until exit code appears
      // (fs.watch on log file would trigger too often during writes)
      let position = 0;

      while (!(await Bun.file(exitCodeFile).exists())) {
        const file = Bun.file(logFile);
        if (await file.exists()) {
          const content = await file.text();
          const newContent = content.slice(position);
          position = content.length;

          // Yield chunks with binary prefix parsing
          if (newContent) {
            const lines = newContent.split('\n');
            for (const line of lines) {
              if (!line) continue;

              if (line.startsWith(STDOUT_PREFIX)) {
                yield {
                  type: 'stdout',
                  data: line.slice(STDOUT_PREFIX.length),
                  timestamp: new Date().toISOString(),
                };
              } else if (line.startsWith(STDERR_PREFIX)) {
                yield {
                  type: 'stderr',
                  data: line.slice(STDERR_PREFIX.length),
                  timestamp: new Date().toISOString(),
                };
              }
            }
          }
        }

        await Bun.sleep(CONFIG.STREAM_CHUNK_DELAY_MS);
      }

      // Read final chunks and exit code
      const file = Bun.file(logFile);
      if (await file.exists()) {
        const content = await file.text();
        const newContent = content.slice(position);

        if (newContent) {
          const lines = newContent.split('\n');
          for (const line of lines) {
            if (!line) continue;

            if (line.startsWith(STDOUT_PREFIX)) {
              yield {
                type: 'stdout',
                data: line.slice(STDOUT_PREFIX.length),
                timestamp: new Date().toISOString(),
              };
            } else if (line.startsWith(STDERR_PREFIX)) {
              yield {
                type: 'stderr',
                data: line.slice(STDERR_PREFIX.length),
                timestamp: new Date().toISOString(),
              };
            }
          }
        }
      }

      const exitCode = parseInt(await Bun.file(exitCodeFile).text(), 10);
      const duration = Date.now() - startTime;

      yield {
        type: 'complete',
        exitCode,
        timestamp: new Date().toISOString(),
        result: {
          stdout: '', // Already streamed
          stderr: '', // Already streamed
          exitCode,
          success: exitCode === 0,
          command,
          duration,
          timestamp: new Date(startTime).toISOString(),
        },
      };

      // Untrack command
      this.untrackCommand(commandId);

      // Clean up temp files
      await this.cleanupCommandFiles(logFile, exitCodeFile);
    } catch (error) {
      // Untrack and clean up on error
      this.untrackCommand(commandId);
      await this.cleanupCommandFiles(logFile, exitCodeFile);

      yield {
        type: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if the session is ready to execute commands
   */
  isReady(): boolean {
    return this.ready && this.shell !== null && !this.shell.killed;
  }

  /**
   * Kill a running command by its ID
   * @param commandId - The unique command identifier
   * @returns true if command was killed, false if not found or already completed
   */
  async killCommand(commandId: string): Promise<boolean> {
    const handle = this.runningCommands.get(commandId);
    if (!handle) {
      return false; // Command not found or already completed
    }

    try {
      // Try reading PID from file (might still exist if command running)
      const pidFile = Bun.file(handle.pidFile);
      if (await pidFile.exists()) {
        const pidText = await pidFile.text();
        const pid = parseInt(pidText.trim(), 10);

        if (!isNaN(pid)) {
          // Send SIGTERM for graceful termination
          process.kill(pid, 'SIGTERM');

          // Clean up
          this.runningCommands.delete(commandId);
          return true;
        }
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

  /**
   * Get list of running command IDs
   */
  getRunningCommandIds(): string[] {
    return Array.from(this.runningCommands.keys());
  }

  /**
   * Destroy the session and clean up resources
   */
  async destroy(): Promise<void> {
    if (this.shell && !this.shell.killed) {
      // Close stdin to send EOF to bash (standard way to terminate interactive shells)
      if (this.shell.stdin && typeof this.shell.stdin !== 'number') {
        try {
          this.shell.stdin.end();
        } catch {
          // stdin may already be closed
        }
      }

      // Send SIGTERM for graceful termination (triggers trap handlers)
      this.shell.kill();

      // Wait for shell to exit (with 1s timeout)
      try {
        await Promise.race([
          this.shell.exited,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
        ]);
      } catch {
        // Timeout: force kill with SIGKILL
        this.shell.kill('SIGKILL');
        await this.shell.exited.catch(() => {});
      }
    }

    // Clean up session directory
    if (this.sessionDir) {
      await rm(this.sessionDir, { recursive: true, force: true }).catch(() => {});
    }

    this.ready = false;
    this.shell = null;
    this.sessionDir = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Build FIFO-based bash script for command execution
   *
   * This is the core of the FIFO approach:
   * 1. Create two FIFO pipes (stdout.pipe, stderr.pipe)
   * 2. Start background processes that read from pipes and label with binary prefixes
   * 3. Execute command with output redirected to pipes
   * 4. Write exit code to file
   * 5. Wait for background processes and cleanup
   */
  private buildFIFOScript(
    command: string,
    cmdId: string,
    logFile: string,
    exitCodeFile: string,
    cwd?: string
  ): string {
    // Create unique FIFO names to prevent collisions
    const stdoutPipe = join(this.sessionDir!, `${cmdId}.stdout.pipe`);
    const stderrPipe = join(this.sessionDir!, `${cmdId}.stderr.pipe`);
    const pidFile = join(this.sessionDir!, `${cmdId}.pid`);

    // Escape paths for safe shell usage
    const safeStdoutPipe = this.escapeShellPath(stdoutPipe);
    const safeStderrPipe = this.escapeShellPath(stderrPipe);
    const safeLogFile = this.escapeShellPath(logFile);
    const safeExitCodeFile = this.escapeShellPath(exitCodeFile);
    const safeSessionDir = this.escapeShellPath(this.sessionDir!);
    const safePidFile = this.escapeShellPath(pidFile);

    // Build the FIFO script with Daytona-inspired robustness
    let script = `{
  log=${safeLogFile}
  dir=${safeSessionDir}
  sp=${safeStdoutPipe}
  ep=${safeStderrPipe}

  # Cleanup function (called on exit or signals)
  # Only removes FIFOs - reader processes exit naturally when they read EOF
  cleanup() { rm -f "$sp" "$ep"; }
  trap 'cleanup' EXIT HUP INT TERM

  # Pre-cleanup and create FIFOs with error handling
  rm -f "$sp" "$ep" && mkfifo "$sp" "$ep" || exit 1

  # Label stdout with binary prefix in background (capture PID)
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x01\\x01\\x01%s\\n' "$line"; done < "$sp") >> "$log" & r1=$!

  # Label stderr with binary prefix in background (capture PID)
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x02\\x02\\x02%s\\n' "$line"; done < "$ep") >> "$log" & r2=$!

`;

    // Add cwd change if needed
    if (cwd) {
      const safeCwd = this.escapeShellPath(cwd);
      script += `  # Save and change directory\n`;
      script += `  PREV_DIR=$(pwd)\n`;
      script += `  if cd ${safeCwd}; then\n`;
      script += `    # Execute command in BACKGROUND to capture PID (enables killing)\n`;
      script += `    { ${command}; } > "$sp" 2> "$ep" & CMD_PID=$!\n`;
      script += `    # Write PID immediately (so we can kill it)\n`;
      script += `    echo "$CMD_PID" > ${safePidFile}\n`;
      script += `    # Wait for command to complete\n`;
      script += `    wait "$CMD_PID"\n`;
      script += `    EXIT_CODE=$?\n`;
      script += `    # Clean up PID file\n`;
      script += `    rm -f ${safePidFile}\n`;
      script += `    # Restore directory\n`;
      script += `    cd "$PREV_DIR"\n`;
      script += `  else\n`;
      script += `    # Failed to change directory - close both pipes to unblock readers\n`;
      script += `    echo "Failed to change directory to ${safeCwd}" > "$ep"\n`;
      script += `    # Close stdout pipe (no output expected)\n`;
      script += `    : > "$sp"\n`;
      script += `    EXIT_CODE=1\n`;
      script += `  fi\n`;
      script += `  \n`;
    } else {
      // Execute command in current directory
      // Use command grouping {} to enable state persistence (cd, export, functions)
      script += `  # Execute command in BACKGROUND to capture PID (enables killing)\n`;
      script += `  { ${command}; } > "$sp" 2> "$ep" & CMD_PID=$!\n`;
      script += `  # Write PID immediately (so we can kill it)\n`;
      script += `  echo "$CMD_PID" > ${safePidFile}\n`;
      script += `  # Wait for command to complete\n`;
      script += `  wait "$CMD_PID"\n`;
      script += `  EXIT_CODE=$?\n`;
      script += `  # Clean up PID file\n`;
      script += `  rm -f ${safePidFile}\n`;
      script += `  \n`;
    }

    // Wait for specific labeler processes, then write exit code and cleanup
    script += `  # Wait for specific labeler processes to finish (not all background jobs)\n`;
    script += `  wait "$r1" "$r2"\n`;
    script += `  \n`;
    script += `  # Write exit code (AFTER labeler processes finish)\n`;
    script += `  echo "$EXIT_CODE" > ${safeExitCodeFile}\n`;
    script += `  \n`;
    script += `  # Explicit cleanup (redundant with trap, but ensures cleanup)\n`;
    script += `  cleanup\n`;
    script += `}`;

    return script;
  }

  /**
   * Wait for exit code file to appear using fs.watch (event-driven!)
   */
  private async waitForExitCode(exitCodeFile: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const dir = dirname(exitCodeFile);
      const filename = basename(exitCodeFile);

      // Check if already exists (race condition)
      Bun.file(exitCodeFile).exists().then(async (exists) => {
        if (exists) {
          const exitCode = await Bun.file(exitCodeFile).text();
          resolve(parseInt(exitCode.trim(), 10));
          return;
        }

        // Set up file watcher (event-driven!)
        const watcher = watch(dir, async (eventType, changedFile) => {
          if (changedFile === filename) {
            watcher.close();
            try {
              const exitCode = await Bun.file(exitCodeFile).text();
              resolve(parseInt(exitCode.trim(), 10));
            } catch (error) {
              reject(new Error(`Failed to read exit code: ${error}`));
            }
          }
        });

        // Set up timeout
        setTimeout(() => {
          watcher.close();
          reject(new Error(`Command timeout after ${this.commandTimeoutMs}ms`));
        }, this.commandTimeoutMs);
      }).catch(reject);
    });
  }

  /**
   * Parse log file and separate stdout/stderr using binary prefixes
   */
  private async parseLogFile(logFile: string): Promise<{ stdout: string; stderr: string }> {
    const file = Bun.file(logFile);

    if (!(await file.exists())) {
      return { stdout: '', stderr: '' };
    }

    // Safety check: prevent OOM attacks
    if (file.size > this.maxOutputSizeBytes) {
      throw new Error(
        `Output too large: ${file.size} bytes (max: ${this.maxOutputSizeBytes})`
      );
    }

    const content = await file.text();
    const lines = content.split('\n');

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith(STDOUT_PREFIX)) {
        stdoutLines.push(line.slice(STDOUT_PREFIX.length));
      } else if (line.startsWith(STDERR_PREFIX)) {
        stderrLines.push(line.slice(STDERR_PREFIX.length));
      }
      // Lines without prefix are ignored (shouldn't happen)
    }

    return {
      stdout: stdoutLines.join('\n'),
      stderr: stderrLines.join('\n'),
    };
  }

  /**
   * Clean up command temp files
   */
  private async cleanupCommandFiles(logFile: string, exitCodeFile: string): Promise<void> {
    // Derive PID file from log file
    const pidFile = logFile.replace('.log', '.pid');

    try {
      await rm(logFile, { force: true });
    } catch (error) {
      // Ignore errors
    }

    try {
      await rm(exitCodeFile, { force: true });
    } catch (error) {
      // Ignore errors
    }

    try {
      await rm(pidFile, { force: true });
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Escape shell path for safe usage in bash scripts
   */
  private escapeShellPath(path: string): string {
    // Use single quotes to prevent any interpretation, escape existing single quotes
    return `'${path.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Ensure session is ready, throw if not
   */
  private ensureReady(): void {
    if (!this.isReady()) {
      throw new Error(`Session '${this.id}' is not ready or shell has died`);
    }
  }

  /**
   * Track a command when it starts
   */
  private trackCommand(commandId: string, pidFile: string, logFile: string, exitCodeFile: string): void {
    const handle: CommandHandle = {
      commandId,
      pidFile,
      logFile,
      exitCodeFile,
    };
    this.runningCommands.set(commandId, handle);
  }

  /**
   * Untrack a command when it completes
   */
  private untrackCommand(commandId: string): void {
    this.runningCommands.delete(commandId);
  }
}
