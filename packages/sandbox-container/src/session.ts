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

    try {
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
      // Clean up on error
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

    try {
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

      // Clean up temp files
      await this.cleanupCommandFiles(logFile, exitCodeFile);
    } catch (error) {
      // Clean up on error
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
   * Destroy the session and clean up resources
   */
  async destroy(): Promise<void> {
    // Kill shell if still running
    if (this.shell && !this.shell.killed) {
      this.shell.kill();
      // Wait for shell to exit
      await this.shell.exited;
    }

    // Clean up session directory
    if (this.sessionDir) {
      try {
        await rm(this.sessionDir, { recursive: true, force: true });
      } catch (error) {
        console.error(`Failed to cleanup session directory: ${error}`);
      }
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

    // Escape paths for safe shell usage
    const safeStdoutPipe = this.escapeShellPath(stdoutPipe);
    const safeStderrPipe = this.escapeShellPath(stderrPipe);
    const safeLogFile = this.escapeShellPath(logFile);
    const safeExitCodeFile = this.escapeShellPath(exitCodeFile);

    // Build the FIFO script
    // Note: Using subshell with {} to ensure proper cleanup even if command fails
    let script = `{
  # Create FIFO pipes
  mkfifo ${safeStdoutPipe} ${safeStderrPipe}

  # Label stdout with binary prefix in background
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x01\\x01\\x01%s\\n' "$line"; done < ${safeStdoutPipe}) >> ${safeLogFile} &

  # Label stderr with binary prefix in background
  (while IFS= read -r line || [[ -n "$line" ]]; do printf '\\x02\\x02\\x02%s\\n' "$line"; done < ${safeStderrPipe}) >> ${safeLogFile} &

`;

    // Add cwd change if needed
    if (cwd) {
      const safeCwd = this.escapeShellPath(cwd);
      script += `  # Save and change directory\n`;
      script += `  PREV_DIR=$(pwd)\n`;
      script += `  if cd ${safeCwd}; then\n`;
      script += `    # Execute command in new directory\n`;
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
      script += `  \n`;
    } else {
      // Execute command in current directory
      script += `  # Execute command\n`;
      script += `  { ${command}; } > ${safeStdoutPipe} 2> ${safeStderrPipe}\n`;
      script += `  EXIT_CODE=$?\n`;
      script += `  \n`;
    }

    // Wait for background processes, then write exit code and cleanup
    script += `  # Wait for background processes to finish writing to log file\n`;
    script += `  wait\n`;
    script += `  \n`;
    script += `  # Write exit code (AFTER background processes finish)\n`;
    script += `  echo "$EXIT_CODE" > ${safeExitCodeFile}\n`;
    script += `  \n`;
    script += `  # Remove FIFO pipes\n`;
    script += `  rm -f ${safeStdoutPipe} ${safeStderrPipe}\n`;
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
}
