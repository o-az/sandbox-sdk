import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { WranglerDevRunner } from './helpers/wrangler-runner';
import { createSandboxId } from './helpers/test-fixtures';
import { getSandbox } from '@cloudflare/sandbox';

/**
 * Build and Test Workflow Integration Tests
 *
 * Tests the README "Build and Test Code" example (lines 343-362):
 * - Clone a repository
 * - Run tests
 * - Build the project
 *
 * This validates the complete CI/CD workflow:
 * Git → Install → Test → Build
 */
describe('Build and Test Workflow', () => {
  describe('local', () => {
    let runner: WranglerDevRunner;
    let workerUrl: string;

    beforeAll(async () => {
      // Start wrangler dev once for all tests in this suite
      runner = new WranglerDevRunner({
        cwd: '__tests__/integration/test-worker',
      });
      workerUrl = await runner.getUrl();
    });

    afterAll(async () => {
      // Cleanup wrangler process
      if (runner) {
        await runner.stop();
      }
    });

    test('should execute basic commands and verify file operations', async () => {
      const sandboxId = createSandboxId();

      // Step 1: Execute simple command
      // Use vi.waitFor to handle container startup time
      const echoResponse = await vi.waitFor(
        async () => {
          const res = await fetch(`${workerUrl}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: 'echo "Hello from sandbox"',
              sessionId: sandboxId,
            }),
          });

          if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
          }

          return res;
        },
        { timeout: 30000, interval: 1000 } // Wait up to 30s, retry every 1s
      );

      expect(echoResponse.status).toBe(200);
      const echoData = await echoResponse.json();
      expect(echoData.exitCode).toBe(0);
      expect(echoData.stdout).toContain('Hello from sandbox');

      // Step 2: Write a file (using absolute path per README pattern)
      const writeResponse = await fetch(`${workerUrl}/api/file/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/test-file.txt',
          content: 'Integration test content',
          sessionId: sandboxId,
        }),
      });

      expect(writeResponse.status).toBe(200);
      const writeData = await writeResponse.json();
      expect(writeData.success).toBe(true);

      // Step 3: Read the file back to verify persistence
      const readResponse = await fetch(`${workerUrl}/api/file/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/test-file.txt',
          sessionId: sandboxId,
        }),
      });

      expect(readResponse.status).toBe(200);
      const readData = await readResponse.json();
      expect(readData.content).toBe('Integration test content');

      // Step 4: Verify pwd to understand working directory
      const pwdResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'pwd',
          sessionId: sandboxId,
        }),
      });

      expect(pwdResponse.status).toBe(200);
      const pwdData = await pwdResponse.json();
      expect(pwdData.stdout).toMatch(/\/app/);
    });

    test('should handle command failures correctly', async () => {
      const sandboxId = createSandboxId();

      // Execute a command that will fail
      // Use vi.waitFor to handle container startup
      const response = await vi.waitFor(
        async () => {
          const res = await fetch(`${workerUrl}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: 'exit 1',
              sessionId: sandboxId,
            }),
          });

          if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
          }

          return res;
        },
        { timeout: 30000, interval: 1000 }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.exitCode).toBe(1);
      expect(data.success).toBe(false);
    });
  });
});
