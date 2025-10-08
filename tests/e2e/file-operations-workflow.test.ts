/**
 * E2E Test: File Operations Workflow
 *
 * Tests comprehensive file system operations including:
 * - Directory creation (mkdir)
 * - File deletion (deleteFile)
 * - File renaming (renameFile)
 * - File moving (moveFile)
 *
 * These tests validate realistic workflows like project scaffolding
 * and file manipulation across directory structures.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { WranglerDevRunner } from './helpers/wrangler-runner';
import { createSandboxId } from './helpers/test-fixtures';

describe('File Operations Workflow (E2E)', () => {
  let runner: WranglerDevRunner;
  let workerUrl: string;

  beforeAll(async () => {
    runner = new WranglerDevRunner({
      cwd: 'tests/e2e/test-worker',
    });

    workerUrl = await runner.getUrl();
  }, 120000); // 2 minute timeout for wrangler startup

  afterAll(async () => {
    await runner.stop();
  });

  test('should create nested directories', async () => {
    const sandboxId = createSandboxId();

    // Create nested directory structure
    const mkdirResponse = await vi.waitFor(
      async () => {
        const res = await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/project/src/components',
            sessionId: sandboxId,
            recursive: true,
          }),
        });
        if (res.status !== 200) {
          throw new Error(`Expected 200, got ${res.status}`);
        }
        return res;
      },
      { timeout: 30000, interval: 2000 }
    );

    const mkdirData = await mkdirResponse.json();
    expect(mkdirData.success).toBe(true);

    // Verify directory exists by listing it
    const lsResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'ls -la /workspace/project/src/components',
        sessionId: sandboxId,
      }),
    });

    const lsData = await lsResponse.json();
    expect(lsResponse.status).toBe(200);
    expect(lsData.success).toBe(true);
    // Directory should exist (ls succeeds)
  }, 60000);

  test('should write files in subdirectories and read them back', async () => {
    const sandboxId = createSandboxId();

    // Create directory structure
    await vi.waitFor(
      async () => {
        const res = await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/app/config',
            sessionId: sandboxId,
            recursive: true,
          }),
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        return res;
      },
      { timeout: 30000, interval: 2000 }
    );

    // Write file in subdirectory
    const writeResponse = await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/app/config/settings.json',
        content: JSON.stringify({ debug: true, port: 3000 }),
        sessionId: sandboxId,
      }),
    });

    expect(writeResponse.status).toBe(200);

    // Read file back
    const readResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/app/config/settings.json',
        sessionId: sandboxId,
      }),
    });

    const readData = await readResponse.json();
    expect(readResponse.status).toBe(200);
    expect(readData.content).toContain('debug');
    expect(readData.content).toContain('3000');
  }, 60000);

  test('should rename files', async () => {
    const sandboxId = createSandboxId();

    // Create directory and write file
    await vi.waitFor(
      async () => {
        const res = await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/docs',
            sessionId: sandboxId,
            recursive: true,
          }),
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        return res;
      },
      { timeout: 30000, interval: 2000 }
    );

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/docs/README.txt',
        content: '# Project Documentation',
        sessionId: sandboxId,
      }),
    });

    // Rename file from .txt to .md
    const renameResponse = await fetch(`${workerUrl}/api/file/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldPath: '/workspace/docs/README.txt',
        newPath: '/workspace/docs/README.md',
        sessionId: sandboxId,
      }),
    });

    expect(renameResponse.status).toBe(200);

    // Verify new file exists
    const readNewResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/docs/README.md',
        sessionId: sandboxId,
      }),
    });

    const readNewData = await readNewResponse.json();
    expect(readNewResponse.status).toBe(200);
    expect(readNewData.content).toContain('Project Documentation');

    // Verify old file doesn't exist
    const readOldResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/docs/README.txt',
        sessionId: sandboxId,
      }),
    });

    expect(readOldResponse.status).toBe(500); // Should fail - file doesn't exist
  }, 60000);

  test('should move files between directories', async () => {
    const sandboxId = createSandboxId();

    // Create two directories
    await vi.waitFor(
      async () => {
        await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/source',
            sessionId: sandboxId,
            recursive: true,
          }),
        });

        const res = await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/destination',
            sessionId: sandboxId,
            recursive: true,
          }),
        });

        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        return res;
      },
      { timeout: 30000, interval: 2000 }
    );

    // Write file in source directory
    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/source/data.json',
        content: JSON.stringify({ id: 1, name: 'test' }),
        sessionId: sandboxId,
      }),
    });

    // Move file to destination
    const moveResponse = await fetch(`${workerUrl}/api/file/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePath: '/workspace/source/data.json',
        destinationPath: '/workspace/destination/data.json',
        sessionId: sandboxId,
      }),
    });

    expect(moveResponse.status).toBe(200);

    // Verify file exists in destination
    const readDestResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/destination/data.json',
        sessionId: sandboxId,
      }),
    });

    const readDestData = await readDestResponse.json();
    expect(readDestResponse.status).toBe(200);
    expect(readDestData.content).toContain('test');

    // Verify file doesn't exist in source
    const readSourceResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/source/data.json',
        sessionId: sandboxId,
      }),
    });

    expect(readSourceResponse.status).toBe(500); // Should fail - file moved
  }, 60000);

  test('should delete files', async () => {
    const sandboxId = createSandboxId();

    // Create directory and file
    await vi.waitFor(
      async () => {
        const res = await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/temp',
            sessionId: sandboxId,
            recursive: true,
          }),
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        return res;
      },
      { timeout: 30000, interval: 2000 }
    );

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/temp/delete-me.txt',
        content: 'This file will be deleted',
        sessionId: sandboxId,
      }),
    });

    // Verify file exists
    const readBeforeResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/temp/delete-me.txt',
        sessionId: sandboxId,
      }),
    });

    expect(readBeforeResponse.status).toBe(200);

    // Delete file
    const deleteResponse = await fetch(`${workerUrl}/api/file/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/temp/delete-me.txt',
        sessionId: sandboxId,
      }),
    });

    expect(deleteResponse.status).toBe(200);

    // Verify file doesn't exist
    const readAfterResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/temp/delete-me.txt',
        sessionId: sandboxId,
      }),
    });

    expect(readAfterResponse.status).toBe(500); // Should fail - file deleted
  }, 60000);

  test('should reject deleting directories with deleteFile', async () => {
    const sandboxId = createSandboxId();

    // Create a directory
    await vi.waitFor(
      async () => {
        const res = await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/test-dir',
            sessionId: sandboxId,
            recursive: true,
          }),
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        return res;
      },
      { timeout: 30000, interval: 2000 }
    );

    // Try to delete directory with deleteFile - should fail
    const deleteResponse = await fetch(`${workerUrl}/api/file/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/test-dir',
        sessionId: sandboxId,
      }),
    });

    // Should return error
    expect(deleteResponse.status).toBe(500);

    const deleteData = await deleteResponse.json();
    expect(deleteData.error).toContain('Cannot delete directory');
    expect(deleteData.error).toContain('deleteFile()');

    // Verify directory still exists
    const lsResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'ls -d /workspace/test-dir',
        sessionId: sandboxId,
      }),
    });

    const lsData = await lsResponse.json();
    expect(lsResponse.status).toBe(200);
    expect(lsData.success).toBe(true); // Directory should still exist

    // Cleanup - delete directory properly using exec
    await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'rm -rf /workspace/test-dir',
        sessionId: sandboxId,
      }),
    });
  }, 60000);

  test('should delete directories recursively using exec', async () => {
    const sandboxId = createSandboxId();

    // Create nested directory structure with files
    await vi.waitFor(
      async () => {
        const res = await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/cleanup/nested/deep',
            sessionId: sandboxId,
            recursive: true,
          }),
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        return res;
      },
      { timeout: 30000, interval: 2000 }
    );

    // Write files in different levels
    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/cleanup/file1.txt',
        content: 'Level 1',
        sessionId: sandboxId,
      }),
    });

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/cleanup/nested/file2.txt',
        content: 'Level 2',
        sessionId: sandboxId,
      }),
    });

    // Delete entire directory tree (use exec since deleteFile only works on files)
    const deleteResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'rm -rf /workspace/cleanup',
        sessionId: sandboxId,
      }),
    });

    const deleteData = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteData.success).toBe(true);

    // Verify directory doesn't exist
    const lsResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'ls /workspace/cleanup',
        sessionId: sandboxId,
      }),
    });

    const lsData = await lsResponse.json();
    // ls should fail or show empty result
    expect(lsData.success).toBe(false);
  }, 60000);

  test('should handle complete project scaffolding workflow', async () => {
    const sandboxId = createSandboxId();

    // Step 1: Create project directory structure
    await vi.waitFor(
      async () => {
        // Create main project directories
        await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/myapp/src',
            sessionId: sandboxId,
            recursive: true,
          }),
        });

        await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/myapp/tests',
            sessionId: sandboxId,
            recursive: true,
          }),
        });

        const res = await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: '/workspace/myapp/config',
            sessionId: sandboxId,
            recursive: true,
          }),
        });

        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        return res;
      },
      { timeout: 30000, interval: 2000 }
    );

    // Step 2: Write initial files
    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/myapp/package.json',
        content: JSON.stringify({ name: 'myapp', version: '1.0.0' }),
        sessionId: sandboxId,
      }),
    });

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/myapp/src/index.js',
        content: 'console.log("Hello World");',
        sessionId: sandboxId,
      }),
    });

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/myapp/config/dev.json',
        content: JSON.stringify({ env: 'development' }),
        sessionId: sandboxId,
      }),
    });

    // Step 3: Rename config file
    const renameResponse = await fetch(`${workerUrl}/api/file/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldPath: '/workspace/myapp/config/dev.json',
        newPath: '/workspace/myapp/config/development.json',
        sessionId: sandboxId,
      }),
    });

    expect(renameResponse.status).toBe(200);

    // Step 4: Move index.js to a lib subdirectory
    await fetch(`${workerUrl}/api/file/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/myapp/src/lib',
        sessionId: sandboxId,
        recursive: true,
      }),
    });

    const moveResponse = await fetch(`${workerUrl}/api/file/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePath: '/workspace/myapp/src/index.js',
        destinationPath: '/workspace/myapp/src/lib/index.js',
        sessionId: sandboxId,
      }),
    });

    expect(moveResponse.status).toBe(200);

    // Step 5: Verify final structure
    const readPackageResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/myapp/package.json',
        sessionId: sandboxId,
      }),
    });

    const packageData = await readPackageResponse.json();
    expect(readPackageResponse.status).toBe(200);
    expect(packageData.content).toContain('myapp');

    const readConfigResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/myapp/config/development.json',
        sessionId: sandboxId,
      }),
    });

    const configData = await readConfigResponse.json();
    expect(readConfigResponse.status).toBe(200);
    expect(configData.content).toContain('development');

    const readIndexResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/workspace/myapp/src/lib/index.js',
        sessionId: sandboxId,
      }),
    });

    const indexData = await readIndexResponse.json();
    expect(readIndexResponse.status).toBe(200);
    expect(indexData.content).toContain('Hello World');

    // Step 6: Cleanup - delete entire project (use exec since deleteFile only works on files)
    const deleteResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'rm -rf /workspace/myapp',
        sessionId: sandboxId,
      }),
    });

    const deleteData = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteData.success).toBe(true);

    // Verify cleanup
    const lsResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'ls /workspace/myapp',
        sessionId: sandboxId,
      }),
    });

    const lsData = await lsResponse.json();
    expect(lsData.success).toBe(false); // Directory should not exist
  }, 90000);
});
