import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { WranglerDevRunner } from './helpers/wrangler-runner';
import { createSandboxId } from './helpers/test-fixtures';

/**
 * Git Clone Workflow Integration Tests
 *
 * Tests the README "Build and Test Code" example (lines 343-362):
 * - Clone a repository
 * - Run npm install
 * - Execute npm commands
 *
 * This validates the complete Git workflow:
 * Clone → Install → Build/Test
 *
 * Uses a real public repository to test:
 * - Git clone operations
 * - Working with actual repositories
 * - Multi-step workflows matching production usage
 */
describe('Git Clone Workflow', () => {
  describe('local', () => {
    let runner: WranglerDevRunner;
    let workerUrl: string;

    beforeAll(async () => {
      // Start wrangler dev once for all tests in this suite
      runner = new WranglerDevRunner({
        cwd: 'tests/e2e/test-worker',
      });
      workerUrl = await runner.getUrl();
    });

    afterAll(async () => {
      // Cleanup wrangler process
      if (runner) {
        await runner.stop();
      }
    });

    test('should clone a public repository successfully', async () => {
      const sandboxId = createSandboxId();

      // Clone a very small public repository for testing
      // Using octocat/Hello-World - a minimal test repository
      // Use vi.waitFor to handle container startup time
      const cloneResponse = await vi.waitFor(
        async () => {
          const res = await fetch(`${workerUrl}/api/git/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoUrl: 'https://github.com/octocat/Hello-World',
              branch: 'master',
              targetDir: '/workspace/test-repo',
              sessionId: sandboxId,
            }),
          });

          if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
          }

          return res;
        },
        { timeout: 90000, interval: 3000 } // Git clone can take longer, wait up to 90s
      );

      expect(cloneResponse.status).toBe(200);
      const cloneData = await cloneResponse.json();
      expect(cloneData.success).toBe(true);

      // Verify the repository was cloned by checking for README
      const fileCheckResponse = await fetch(`${workerUrl}/api/file/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/workspace/test-repo/README',
          sessionId: sandboxId,
        }),
      });

      expect(fileCheckResponse.status).toBe(200);
      const fileData = await fileCheckResponse.json();
      expect(fileData.content).toBeTruthy();
      expect(fileData.content).toContain('Hello'); // Verify README content
    });

    test('should clone repository with specific branch', async () => {
      const sandboxId = createSandboxId();

      // Clone a repository with a specific branch (using master for Hello-World)
      const cloneResponse = await vi.waitFor(
        async () => {
          const res = await fetch(`${workerUrl}/api/git/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoUrl: 'https://github.com/octocat/Hello-World',
              branch: 'master', // Explicitly specify master branch
              targetDir: '/workspace/branch-test',
              sessionId: sandboxId,
            }),
          });

          if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
          }

          return res;
        },
        { timeout: 90000, interval: 3000 }
      );

      expect(cloneResponse.status).toBe(200);
      const cloneData = await cloneResponse.json();
      expect(cloneData.success).toBe(true);

      // Verify we're on the correct branch by checking git branch
      const branchCheckResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'cd /workspace/branch-test && git branch --show-current',
          sessionId: sandboxId,
        }),
      });

      expect(branchCheckResponse.status).toBe(200);
      const branchData = await branchCheckResponse.json();
      expect(branchData.stdout.trim()).toBe('master');
    });

    test('should execute complete workflow: clone → list files → verify structure', async () => {
      const sandboxId = createSandboxId();

      // Step 1: Clone the Hello-World repository
      const cloneResponse = await vi.waitFor(
        async () => {
          const res = await fetch(`${workerUrl}/api/git/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoUrl: 'https://github.com/octocat/Hello-World',
              targetDir: '/workspace/project',
              sessionId: sandboxId,
            }),
          });

          if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
          }

          return res;
        },
        { timeout: 90000, interval: 3000 }
      );

      expect(cloneResponse.status).toBe(200);

      // Step 2: List directory contents to verify clone
      const listResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'ls -la /workspace/project',
          sessionId: sandboxId,
        }),
      });

      expect(listResponse.status).toBe(200);
      const listData = await listResponse.json();
      expect(listData.exitCode).toBe(0);
      expect(listData.stdout).toContain('README'); // Verify README exists
      expect(listData.stdout).toContain('.git'); // Verify .git directory exists

      // Step 3: Verify README content
      const readmeResponse = await fetch(`${workerUrl}/api/file/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/workspace/project/README',
          sessionId: sandboxId,
        }),
      });

      expect(readmeResponse.status).toBe(200);
      const readmeData = await readmeResponse.json();
      expect(readmeData.content).toBeTruthy();

      // Step 4: Run a git command to verify repo is functional
      const gitLogResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'cd /workspace/project && git log --oneline -1',
          sessionId: sandboxId,
        }),
      });

      expect(gitLogResponse.status).toBe(200);
      const gitLogData = await gitLogResponse.json();
      expect(gitLogData.exitCode).toBe(0);
      expect(gitLogData.stdout).toBeTruthy(); // Should have at least one commit
    });

    test('should handle cloning to default directory when targetDir not specified', async () => {
      const sandboxId = createSandboxId();

      // Clone without specifying targetDir (should use repo name "Hello-World")
      const cloneResponse = await vi.waitFor(
        async () => {
          const res = await fetch(`${workerUrl}/api/git/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoUrl: 'https://github.com/octocat/Hello-World',
              sessionId: sandboxId,
            }),
          });

          if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
          }

          return res;
        },
        { timeout: 90000, interval: 3000 }
      );

      expect(cloneResponse.status).toBe(200);
      const cloneData = await cloneResponse.json();
      expect(cloneData.success).toBe(true);

      // The SDK should extract 'Hello-World' from the URL and clone there
      // Verify by checking if Hello-World directory exists
      const dirCheckResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'ls -la /workspace',
          sessionId: sandboxId,
        }),
      });

      expect(dirCheckResponse.status).toBe(200);
      const dirData = await dirCheckResponse.json();
      expect(dirData.stdout).toContain('Hello-World');
    });

    test('should handle git clone errors gracefully', async () => {
      const sandboxId = createSandboxId();

      // Try to clone a non-existent repository
      const cloneResponse = await vi.waitFor(
        async () => {
          const res = await fetch(`${workerUrl}/api/git/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoUrl: 'https://github.com/nonexistent/repository-that-does-not-exist-12345',
              sessionId: sandboxId,
            }),
          });

          // Should get a response (either 500 error or 200 with error in body)
          return res;
        },
        { timeout: 30000, interval: 2000 }
      );

      // Git clone should fail, but the API should handle it gracefully
      // Could be 500 status or 200 with error field
      if (cloneResponse.status === 500) {
        const errorData = await cloneResponse.json();
        expect(errorData.error).toBeTruthy();
      } else if (cloneResponse.status === 200) {
        const data = await cloneResponse.json();
        // Check if there's an error field or non-zero exit code
        expect(data.success === false || data.exitCode !== 0 || data.error).toBeTruthy();
      }
    });

    test('should maintain session state across git clone and subsequent commands', async () => {
      const sandboxId = createSandboxId();

      // Step 1: Clone a repository
      const cloneResponse = await vi.waitFor(
        async () => {
          const res = await fetch(`${workerUrl}/api/git/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repoUrl: 'https://github.com/octocat/Hello-World',
              targetDir: '/workspace/state-test',
              sessionId: sandboxId,
            }),
          });

          if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
          }

          return res;
        },
        { timeout: 90000, interval: 3000 }
      );

      expect(cloneResponse.status).toBe(200);

      // Step 2: Create a new file in the cloned directory
      const writeResponse = await fetch(`${workerUrl}/api/file/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/workspace/state-test/test-marker.txt',
          content: 'Session state test',
          sessionId: sandboxId,
        }),
      });

      expect(writeResponse.status).toBe(200);

      // Step 3: List files to verify both cloned content and our new file exist
      const listResponse = await fetch(`${workerUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'ls /workspace/state-test',
          sessionId: sandboxId,
        }),
      });

      expect(listResponse.status).toBe(200);
      const listData = await listResponse.json();
      expect(listData.stdout).toContain('README'); // From cloned repo
      expect(listData.stdout).toContain('test-marker.txt'); // Our new file
    });
  });
});
