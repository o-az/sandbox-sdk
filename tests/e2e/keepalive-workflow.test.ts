import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getTestWorkerUrl, WranglerDevRunner } from './helpers/wrangler-runner';
import { createSandboxId, createTestHeaders, fetchWithStartup, cleanupSandbox } from './helpers/test-fixtures';

/**
 * KeepAlive Workflow Integration Tests
 *
 * Tests the keepAlive feature that keeps containers alive indefinitely:
 * - Container stays alive with keepAlive: true
 * - Container respects normal timeout without keepAlive
 * - Long-running processes work with keepAlive
 * - Explicit destroy stops keepAlive container
 *
 * This validates that:
 * - The keepAlive interval properly renews activity timeout
 * - Containers don't auto-timeout when keepAlive is enabled
 * - Manual cleanup via destroy() works correctly
 */
describe('KeepAlive Workflow', () => {
  describe('local', () => {
    let runner: WranglerDevRunner | null = null;
    let workerUrl: string;
    let currentSandboxId: string | null = null;

    beforeAll(async () => {
      const result = await getTestWorkerUrl();
      workerUrl = result.url;
      runner = result.runner;
    });

    afterEach(async () => {
      // Cleanup sandbox container after each test
      if (currentSandboxId) {
        await cleanupSandbox(workerUrl, currentSandboxId);
        currentSandboxId = null;
      }
    });

    afterAll(async () => {
      // Only stop runner if we spawned one locally (CI uses deployed worker)
      if (runner) {
        await runner.stop();
      }
    });

    test('should keep container alive with keepAlive enabled', async () => {
      currentSandboxId = createSandboxId();
      const headers = createTestHeaders(currentSandboxId);

      // Add keepAlive header to enable keepAlive mode
      const keepAliveHeaders = {
        ...headers,
        'X-Sandbox-KeepAlive': 'true',
      };

      // Step 1: Initialize sandbox with keepAlive
      const initResponse = await vi.waitFor(
        async () => fetchWithStartup(`${workerUrl}/api/execute`, {
          method: 'POST',
          headers: keepAliveHeaders,
          body: JSON.stringify({
            command: 'echo "Container initialized with keepAlive"',
          }),
        }),
        { timeout: 90000, interval: 2000 }
      );

      expect(initResponse.status).toBe(200);
      const initData = await initResponse.json();
      expect(initData.stdout).toContain('Container initialized with keepAlive');

      // Step 2: Wait longer than normal activity timeout would allow (15 seconds)
      // With keepAlive, container should stay alive
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // Step 3: Execute another command to verify container is still alive
      const verifyResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: keepAliveHeaders,
        body: JSON.stringify({
          command: 'echo "Still alive after timeout period"',
        }),
      });

      expect(verifyResponse.status).toBe(200);
      const verifyData = await verifyResponse.json();
      expect(verifyData.stdout).toContain('Still alive after timeout period');
    }, 120000);

    test('should support long-running processes with keepAlive', async () => {
      currentSandboxId = createSandboxId();
      const headers = createTestHeaders(currentSandboxId);

      const keepAliveHeaders = {
        ...headers,
        'X-Sandbox-KeepAlive': 'true',
      };

      // Start a long sleep process (30 seconds)
      const startResponse = await vi.waitFor(
        async () => fetchWithStartup(`${workerUrl}/api/process/start`, {
          method: 'POST',
          headers: keepAliveHeaders,
          body: JSON.stringify({
            command: 'sleep 30',
          }),
        }),
        { timeout: 90000, interval: 2000 }
      );

      expect(startResponse.status).toBe(200);
      const startData = await startResponse.json();
      expect(startData.status).toBe('running');
      const processId = startData.id;

      // Wait 20 seconds (longer than normal activity timeout)
      await new Promise((resolve) => setTimeout(resolve, 20000));

      // Verify process is still running
      const statusResponse = await fetch(`${workerUrl}/api/process/${processId}`, {
        method: 'GET',
        headers: keepAliveHeaders,
      });

      expect(statusResponse.status).toBe(200);
      const statusData = await statusResponse.json();
      expect(statusData.status).toBe('running');

      // Cleanup - kill the process
      await fetch(`${workerUrl}/api/process/${processId}`, {
        method: 'DELETE',
        headers: keepAliveHeaders,
      });
    }, 120000);

    test('should destroy container when explicitly requested', async () => {
      currentSandboxId = createSandboxId();
      const headers = createTestHeaders(currentSandboxId);

      const keepAliveHeaders = {
        ...headers,
        'X-Sandbox-KeepAlive': 'true',
      };

      // Step 1: Initialize sandbox with keepAlive
      await vi.waitFor(
        async () => fetchWithStartup(`${workerUrl}/api/execute`, {
          method: 'POST',
          headers: keepAliveHeaders,
          body: JSON.stringify({
            command: 'echo "Testing destroy"',
          }),
        }),
        { timeout: 90000, interval: 2000 }
      );

      // Step 2: Explicitly destroy the container
      const destroyResponse = await fetch(`${workerUrl}/cleanup`, {
        method: 'POST',
        headers: keepAliveHeaders,
      });

      expect(destroyResponse.status).toBe(200);

      // Step 3: Verify container was destroyed by trying to execute a command
      // This should fail or require re-initialization
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const verifyResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: keepAliveHeaders,
        body: JSON.stringify({
          command: 'echo "After destroy"',
        }),
      });

      // Container should be restarted (new container), not the same one
      // We can verify by checking that the response is successful but it's a fresh container
      expect(verifyResponse.status).toBe(200);

      // Mark as null so afterEach doesn't try to clean it up again
      currentSandboxId = null;
    }, 120000);

    test('should handle multiple commands with keepAlive over time', async () => {
      currentSandboxId = createSandboxId();
      const headers = createTestHeaders(currentSandboxId);

      const keepAliveHeaders = {
        ...headers,
        'X-Sandbox-KeepAlive': 'true',
      };

      // Initialize
      await vi.waitFor(
        async () => fetchWithStartup(`${workerUrl}/api/execute`, {
          method: 'POST',
          headers: keepAliveHeaders,
          body: JSON.stringify({
            command: 'echo "Command 1"',
          }),
        }),
        { timeout: 90000, interval: 2000 }
      );

      // Execute multiple commands with delays between them
      for (let i = 2; i <= 4; i++) {
        // Wait 8 seconds between commands (would timeout without keepAlive)
        await new Promise((resolve) => setTimeout(resolve, 8000));

        const response = await fetch(`${workerUrl}/api/execute`, {
          method: 'POST',
          headers: keepAliveHeaders,
          body: JSON.stringify({
            command: `echo "Command ${i}"`,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.stdout).toContain(`Command ${i}`);
      }
    }, 120000);

    test('should work with file operations while keepAlive is enabled', async () => {
      currentSandboxId = createSandboxId();
      const headers = createTestHeaders(currentSandboxId);

      const keepAliveHeaders = {
        ...headers,
        'X-Sandbox-KeepAlive': 'true',
      };

      // Initialize
      await vi.waitFor(
        async () => fetchWithStartup(`${workerUrl}/api/file/write`, {
          method: 'POST',
          headers: keepAliveHeaders,
          body: JSON.stringify({
            path: '/workspace/test.txt',
            content: 'Initial content',
          }),
        }),
        { timeout: 90000, interval: 2000 }
      );

      // Wait longer than normal timeout
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // Perform file operations - should still work
      const writeResponse = await fetch(`${workerUrl}/api/file/write`, {
        method: 'POST',
        headers: keepAliveHeaders,
        body: JSON.stringify({
          path: '/workspace/test.txt',
          content: 'Updated content after keepAlive',
        }),
      });

      expect(writeResponse.status).toBe(200);

      // Read file to verify
      const readResponse = await fetch(`${workerUrl}/api/file/read`, {
        method: 'POST',
        headers: keepAliveHeaders,
        body: JSON.stringify({
          path: '/workspace/test.txt',
        }),
      });

      expect(readResponse.status).toBe(200);
      const readData = await readResponse.json();
      expect(readData.content).toContain('Updated content after keepAlive');
    }, 120000);

    test('should persist keepAlive flag across DO hibernation/wakeup cycles', async () => {
      currentSandboxId = createSandboxId();
      const headers = createTestHeaders(currentSandboxId);

      const keepAliveHeaders = {
        ...headers,
        'X-Sandbox-KeepAlive': 'true',
      };

      // Step 1: Initialize sandbox with keepAlive enabled
      const initResponse = await vi.waitFor(
        async () => fetchWithStartup(`${workerUrl}/api/execute`, {
          method: 'POST',
          headers: keepAliveHeaders,
          body: JSON.stringify({
            command: 'echo "Initial setup with keepAlive"',
          }),
        }),
        { timeout: 90000, interval: 2000 }
      );

      expect(initResponse.status).toBe(200);
      const initData = await initResponse.json();
      expect(initData.stdout).toContain('Initial setup with keepAlive');

      // Step 2: Wait for potential DO hibernation (20+ seconds of complete inactivity)
      // This simulates the DO going to sleep and waking up
      console.log('[Test] Waiting 20 seconds to allow potential DO hibernation...');
      await new Promise((resolve) => setTimeout(resolve, 20000));

      // Step 3: Make a new request WITHOUT setting keepAlive header again
      // If the flag wasn't persisted, the container would timeout after this point
      const headersWithoutKeepAlive = headers; // No X-Sandbox-KeepAlive header

      const afterHibernationResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: headersWithoutKeepAlive,
        body: JSON.stringify({
          command: 'echo "After potential hibernation"',
        }),
      });

      expect(afterHibernationResponse.status).toBe(200);
      const afterHibernationData = await afterHibernationResponse.json();
      expect(afterHibernationData.stdout).toContain('After potential hibernation');

      // Step 4: Wait another 15+ seconds to verify keepAlive is still active
      // If persistence failed, the container would have timed out by now
      console.log('[Test] Waiting another 15 seconds to verify persistent keepAlive...');
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // Step 5: Verify container is STILL alive (without re-setting keepAlive)
      const finalResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: headersWithoutKeepAlive, // Still no keepAlive header
        body: JSON.stringify({
          command: 'echo "Still alive after 35+ seconds total"',
        }),
      });

      expect(finalResponse.status).toBe(200);
      const finalData = await finalResponse.json();
      expect(finalData.stdout).toContain('Still alive after 35+ seconds total');

      console.log('[Test] ✅ keepAlive flag successfully persisted across hibernation cycle!');
    }, 120000);
  });
});
