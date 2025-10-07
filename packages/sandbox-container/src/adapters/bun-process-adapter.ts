/**
 * BunProcessAdapter - Infrastructure Wrapper
 *
 * Thin wrapper around Bun's native process APIs.
 * This class handles all I/O operations and Bun-specific functionality.
 *
 * Responsibilities:
 * - Spawning processes using Bun.spawn()
 * - Reading process streams
 * - Managing process lifecycle
 * - Handling process exit events
 *
 * Testing Strategy:
 * - Unit tests: Mock this adapter in service tests
 * - Integration tests: Use real Bun APIs to verify actual I/O
 */

import type { Subprocess } from 'bun';

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: 'pipe' | 'inherit' | null;
  stdout?: 'pipe' | 'inherit' | null;
  stderr?: 'pipe' | 'inherit' | null;
}

export interface SpawnResult {
  pid: number;
  subprocess: Subprocess;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface StreamHandlers {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onExit?: (exitCode: number) => void;
  onError?: (error: Error) => void;
}

export class BunProcessAdapter {
  /**
   * Spawns a new process using Bun.spawn()
   * Returns immediately with the subprocess handle
   */
  spawn(executable: string, args: string[], options: SpawnOptions = {}): SpawnResult {
    const subprocess = Bun.spawn([executable, ...args], {
      stdout: options.stdout || 'pipe',
      stderr: options.stderr || 'pipe',
      stdin: options.stdin || 'pipe',
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
    });

    return {
      pid: subprocess.pid,
      subprocess,
    };
  }

  /**
   * Executes a command and waits for completion
   * Returns stdout, stderr, and exit code
   */
  async execute(
    executable: string,
    args: string[],
    options: SpawnOptions = {}
  ): Promise<ExecutionResult> {
    const { subprocess } = this.spawn(executable, args, options);

    const [stdout, stderr] = await Promise.all([
      this.readStream(subprocess.stdout),
      this.readStream(subprocess.stderr),
    ]);

    await subprocess.exited;
    const exitCode = subprocess.exitCode || 0;

    return {
      exitCode,
      stdout,
      stderr,
    };
  }

  /**
   * Executes a shell command using sh -c
   * This is useful for commands with shell features (pipes, redirects, etc.)
   */
  async executeShell(command: string, options: SpawnOptions = {}): Promise<ExecutionResult> {
    return this.execute('sh', ['-c', command], options);
  }

  /**
   * Reads a stream completely and returns as string
   * Uses Bun's optimized Response API for stream reading
   *
   * Note: Bun's subprocess stdout/stderr can be number (fd) | ReadableStream | undefined
   * We only handle ReadableStream - number types are ignored
   */
  async readStream(stream: ReadableStream | number | undefined): Promise<string> {
    // Handle undefined or number (file descriptor)
    if (!stream || typeof stream === 'number') {
      return '';
    }

    try {
      const response = new Response(stream);
      return await response.text();
    } catch (error) {
      console.warn('Error reading stream:', error);
      return '';
    }
  }

  /**
   * Reads a stream incrementally with callbacks
   * Useful for real-time output streaming
   */
  async streamOutput(
    stream: ReadableStream | number | undefined,
    onData: (data: string) => void
  ): Promise<void> {
    // Handle undefined or number (file descriptor)
    if (!stream || typeof stream === 'number') {
      return;
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const data = decoder.decode(value, { stream: true });
        onData(data);
      }
    } catch (error) {
      console.warn('Error streaming output:', error);
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Sets up stream handlers for a subprocess
   * Returns a cleanup function to stop listening
   */
  handleStreams(subprocess: Subprocess, handlers: StreamHandlers): () => void {
    const abortController = new AbortController();
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      abortController.abort();
    };

    // Handle stdout
    if (subprocess.stdout && handlers.onStdout) {
      this.streamOutput(subprocess.stdout, handlers.onStdout).catch((error) => {
        if (handlers.onError && !abortController.signal.aborted) {
          handlers.onError(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }

    // Handle stderr
    if (subprocess.stderr && handlers.onStderr) {
      this.streamOutput(subprocess.stderr, handlers.onStderr).catch((error) => {
        if (handlers.onError && !abortController.signal.aborted) {
          handlers.onError(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }

    // Handle exit
    if (handlers.onExit) {
      subprocess.exited
        .then(() => {
          if (!abortController.signal.aborted) {
            handlers.onExit?.(subprocess.exitCode || 0);
          }
        })
        .catch((error) => {
          if (handlers.onError && !abortController.signal.aborted) {
            handlers.onError(error instanceof Error ? error : new Error(String(error)));
          }
        });
    }

    return cleanup;
  }

  /**
   * Waits for a subprocess to exit and returns the result
   */
  async waitForExit(subprocess: Subprocess): Promise<ExecutionResult> {
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited.then(() => subprocess.exitCode || 0),
      this.readStream(subprocess.stdout),
      this.readStream(subprocess.stderr),
    ]);

    return {
      exitCode,
      stdout,
      stderr,
    };
  }

  /**
   * Kills a subprocess
   * Returns true if killed successfully
   */
  kill(subprocess: Subprocess, signal?: number): boolean {
    try {
      subprocess.kill(signal);
      return true;
    } catch (error) {
      console.warn('Error killing subprocess:', error);
      return false;
    }
  }

  /**
   * Checks if a subprocess is still running
   */
  isRunning(subprocess: Subprocess): boolean {
    // In Bun, we can check if the process has exited
    // If exitCode is defined, the process has exited
    return subprocess.exitCode === undefined;
  }
}
