import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

export interface WranglerDevOptions {
  cwd?: string;
  timeout?: number;
  env?: typeof process.env;
}

/**
 * WranglerDevRunner - Manages wrangler dev lifecycle for integration tests
 *
 * Based on patterns from @cloudflare/containers test suite.
 *
 * Usage:
 * ```typescript
 * const runner = new WranglerDevRunner({ cwd: 'packages/sandbox' });
 * const url = await runner.getUrl();
 *
 * // Run tests against url...
 *
 * await runner.stop([sandboxId1, sandboxId2]);
 * ```
 */
export class WranglerDevRunner {
  private process: ChildProcessWithoutNullStreams;
  private stdout: string = '';
  private stderr: string = '';
  private url: string | null = null;
  private readonly timeout: number;
  private urlPromise: Promise<string>;

  constructor(private options: WranglerDevOptions = {}) {
    // Default to 5 minutes timeout to allow for Docker startup and initialization
    // After first run with pre-built image, startup is typically < 30s
    this.timeout = options.timeout || 300000;

    // Spawn wrangler dev
    this.process = spawn('npx', ['wrangler', 'dev'], {
      cwd: this.options.cwd,
      env: this.options.env || process.env,
      stdio: 'pipe',
    });

    // Capture stdout/stderr and extract URL
    this.urlPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout after ${this.timeout}ms waiting for wrangler dev to be ready`));
      }, this.timeout);

      this.process.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        this.stdout += output;
        console.log(output);

        // Check for ready pattern: "Ready on http://..."
        const match = output.match(/Ready on (?<url>https?:\/\/[^\s]+)/);
        if (match && match.groups?.url && !this.url) {
          this.url = match.groups.url;
          clearTimeout(timeoutId);
          resolve(this.url);
        }
      });

      this.process.stderr.on('data', (data: Buffer) => {
        this.stderr += data.toString();
        console.log(data.toString());
      });

      this.process.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Get captured stdout (useful for verifying lifecycle hooks)
   */
  getStdout(): string {
    return this.stdout;
  }

  /**
   * Get captured stderr
   */
  getStderr(): string {
    return this.stderr;
  }

  /**
   * Wait for wrangler dev to be ready and return the URL
   */
  async getUrl(): Promise<string> {
    return this.urlPromise;
  }

  /**
   * Stop wrangler dev and cleanup containers
   *
   * @param containerIds - Optional array of container IDs to cleanup
   *
   * Cleanup sequence:
   * 1. Call cleanup endpoints for each container
   * 2. Wait 2s for onStop hooks to complete
   * 3. Kill wrangler process with SIGTERM
   * 4. Wait for process to exit
   */
  async stop(containerIds?: string[]): Promise<void> {
    // Step 1: Call cleanup endpoints
    if (containerIds && containerIds.length > 0 && this.url) {
      for (const id of containerIds) {
        try {
          // Try to call cleanup endpoint if your worker exposes one
          // This is optional - adjust based on your worker implementation
          await fetch(`${this.url}/cleanup?id=${id}`).catch(() => {
            // Ignore errors - container might already be stopped
          });
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }

    // Step 2: Wait 2s for onStop hooks to complete
    // This ensures lifecycle hooks have time to run before we kill the process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Kill wrangler process
    this.process.kill('SIGTERM');

    // Step 4: Wait for process to exit
    return new Promise<void>(resolve => {
      this.process.on('close', () => resolve());
      // Fallback timeout
      setTimeout(resolve, 1000);
    });
  }
}
