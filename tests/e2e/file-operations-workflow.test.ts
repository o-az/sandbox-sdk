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
import { getTestWorkerUrl, WranglerDevRunner } from './helpers/wrangler-runner';
import { createSandboxId, createTestHeaders, fetchWithStartup } from './helpers/test-fixtures';

describe('File Operations Workflow (E2E)', () => {
  let runner: WranglerDevRunner | null;
  let workerUrl: string;

  beforeAll(async () => {
    // Get test worker URL (CI: uses deployed URL, Local: spawns wrangler dev)
    const result = await getTestWorkerUrl();
    workerUrl = result.url;
    runner = result.runner;
  }, 120000); // 2 minute timeout for wrangler startup

  afterAll(async () => {
    if (runner) {
      await runner.stop();
    }
  });

  test('should create nested directories', async () => {
    const sandboxId = createSandboxId();
      const headers = createTestHeaders(sandboxId);

    // Create nested directory structure
    const mkdirResponse = await vi.waitFor(
      async () => fetchWithStartup(`${workerUrl}/api/file/mkdir`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: '/workspace/project/src/components',

          recursive: true,
        }),
      }),
      { timeout: 30000, interval: 2000 }
    );

    const mkdirData = await mkdirResponse.json();
    expect(mkdirData.success).toBe(true);

    // Verify directory exists by listing it
    const lsResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: 'ls -la /workspace/project/src/components',

      }),
    });

    const lsData = await lsResponse.json();
    expect(lsResponse.status).toBe(200);
    expect(lsData.success).toBe(true);
    // Directory should exist (ls succeeds)
  }, 60000);

  test('should write files in subdirectories and read them back', async () => {
    const sandboxId = createSandboxId();
      const headers = createTestHeaders(sandboxId);

    // Create directory structure
    await vi.waitFor(
      async () => fetchWithStartup(`${workerUrl}/api/file/mkdir`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: '/workspace/app/config',

          recursive: true,
        }),
      }),
      { timeout: 30000, interval: 2000 }
    );

    // Write file in subdirectory
    const writeResponse = await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/app/config/settings.json',
        content: JSON.stringify({ debug: true, port: 3000 }),

      }),
    });

    expect(writeResponse.status).toBe(200);

    // Read file back
    const readResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/app/config/settings.json',

      }),
    });

    const readData = await readResponse.json();
    expect(readResponse.status).toBe(200);
    expect(readData.content).toContain('debug');
    expect(readData.content).toContain('3000');
  }, 60000);

  test('should rename files', async () => {
    const sandboxId = createSandboxId();
      const headers = createTestHeaders(sandboxId);

    // Create directory and write file
    await vi.waitFor(
      async () => fetchWithStartup(`${workerUrl}/api/file/mkdir`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: '/workspace/docs',

          recursive: true,
        }),
      }),
      { timeout: 30000, interval: 2000 }
    );

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/docs/README.txt',
        content: '# Project Documentation',

      }),
    });

    // Rename file from .txt to .md
    const renameResponse = await fetch(`${workerUrl}/api/file/rename`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        oldPath: '/workspace/docs/README.txt',
        newPath: '/workspace/docs/README.md',

      }),
    });

    expect(renameResponse.status).toBe(200);

    // Verify new file exists
    const readNewResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/docs/README.md',

      }),
    });

    const readNewData = await readNewResponse.json();
    expect(readNewResponse.status).toBe(200);
    expect(readNewData.content).toContain('Project Documentation');

    // Verify old file doesn't exist
    const readOldResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/docs/README.txt',

      }),
    });

    expect(readOldResponse.status).toBe(500); // Should fail - file doesn't exist
  }, 60000);

  test('should move files between directories', async () => {
    const sandboxId = createSandboxId();
      const headers = createTestHeaders(sandboxId);

    // Create two directories
    await vi.waitFor(
      async () => {
        await fetchWithStartup(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            path: '/workspace/source',

            recursive: true,
          }),
        });

        return fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            path: '/workspace/destination',

            recursive: true,
          }),
        });
      },
      { timeout: 30000, interval: 2000 }
    );

    // Write file in source directory
    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/source/data.json',
        content: JSON.stringify({ id: 1, name: 'test' }),

      }),
    });

    // Move file to destination
    const moveResponse = await fetch(`${workerUrl}/api/file/move`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourcePath: '/workspace/source/data.json',
        destinationPath: '/workspace/destination/data.json',

      }),
    });

    expect(moveResponse.status).toBe(200);

    // Verify file exists in destination
    const readDestResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/destination/data.json',

      }),
    });

    const readDestData = await readDestResponse.json();
    expect(readDestResponse.status).toBe(200);
    expect(readDestData.content).toContain('test');

    // Verify file doesn't exist in source
    const readSourceResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/source/data.json',

      }),
    });

    expect(readSourceResponse.status).toBe(500); // Should fail - file moved
  }, 60000);

  test('should delete files', async () => {
    const sandboxId = createSandboxId();
      const headers = createTestHeaders(sandboxId);

    // Create directory and file
    await vi.waitFor(
      async () => fetchWithStartup(`${workerUrl}/api/file/mkdir`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: '/workspace/temp',

          recursive: true,
        }),
      }),
      { timeout: 30000, interval: 2000 }
    );

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/temp/delete-me.txt',
        content: 'This file will be deleted',

      }),
    });

    // Verify file exists
    const readBeforeResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/temp/delete-me.txt',

      }),
    });

    expect(readBeforeResponse.status).toBe(200);

    // Delete file
    const deleteResponse = await fetch(`${workerUrl}/api/file/delete`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        path: '/workspace/temp/delete-me.txt',

      }),
    });

    expect(deleteResponse.status).toBe(200);

    // Verify file doesn't exist
    const readAfterResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/temp/delete-me.txt',

      }),
    });

    expect(readAfterResponse.status).toBe(500); // Should fail - file deleted
  }, 60000);

  test('should reject deleting directories with deleteFile', async () => {
    const sandboxId = createSandboxId();
      const headers = createTestHeaders(sandboxId);

    // Create a directory
    await vi.waitFor(
      async () => fetchWithStartup(`${workerUrl}/api/file/mkdir`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: '/workspace/test-dir',

          recursive: true,
        }),
      }),
      { timeout: 30000, interval: 2000 }
    );

    // Try to delete directory with deleteFile - should fail
    const deleteResponse = await fetch(`${workerUrl}/api/file/delete`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({
        path: '/workspace/test-dir',

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
      headers,
      body: JSON.stringify({
        command: 'ls -d /workspace/test-dir',

      }),
    });

    const lsData = await lsResponse.json();
    expect(lsResponse.status).toBe(200);
    expect(lsData.success).toBe(true); // Directory should still exist

    // Cleanup - delete directory properly using exec
    await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: 'rm -rf /workspace/test-dir',

      }),
    });
  }, 60000);

  test('should delete directories recursively using exec', async () => {
    const sandboxId = createSandboxId();
      const headers = createTestHeaders(sandboxId);

    // Create nested directory structure with files
    await vi.waitFor(
      async () => fetchWithStartup(`${workerUrl}/api/file/mkdir`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: '/workspace/cleanup/nested/deep',

          recursive: true,
        }),
      }),
      { timeout: 30000, interval: 2000 }
    );

    // Write files in different levels
    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/cleanup/file1.txt',
        content: 'Level 1',

      }),
    });

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/cleanup/nested/file2.txt',
        content: 'Level 2',

      }),
    });

    // Delete entire directory tree (use exec since deleteFile only works on files)
    const deleteResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: 'rm -rf /workspace/cleanup',

      }),
    });

    const deleteData = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteData.success).toBe(true);

    // Verify directory doesn't exist
    const lsResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: 'ls /workspace/cleanup',

      }),
    });

    const lsData = await lsResponse.json();
    // ls should fail or show empty result
    expect(lsData.success).toBe(false);
  }, 60000);

  test('should handle complete project scaffolding workflow', async () => {
    const sandboxId = createSandboxId();
      const headers = createTestHeaders(sandboxId);

    // Step 1: Create project directory structure
    await vi.waitFor(
      async () => {
        // Create main project directories
        await fetchWithStartup(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            path: '/workspace/myapp/src',

            recursive: true,
          }),
        });

        await fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            path: '/workspace/myapp/tests',

            recursive: true,
          }),
        });

        return fetch(`${workerUrl}/api/file/mkdir`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            path: '/workspace/myapp/config',

            recursive: true,
          }),
        });
      },
      { timeout: 30000, interval: 2000 }
    );

    // Step 2: Write initial files
    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/myapp/package.json',
        content: JSON.stringify({ name: 'myapp', version: '1.0.0' }),

      }),
    });

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/myapp/src/index.js',
        content: 'console.log("Hello World");',

      }),
    });

    await fetch(`${workerUrl}/api/file/write`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/myapp/config/dev.json',
        content: JSON.stringify({ env: 'development' }),

      }),
    });

    // Step 3: Rename config file
    const renameResponse = await fetch(`${workerUrl}/api/file/rename`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        oldPath: '/workspace/myapp/config/dev.json',
        newPath: '/workspace/myapp/config/development.json',

      }),
    });

    expect(renameResponse.status).toBe(200);

    // Step 4: Move index.js to a lib subdirectory
    await fetch(`${workerUrl}/api/file/mkdir`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/myapp/src/lib',

        recursive: true,
      }),
    });

    const moveResponse = await fetch(`${workerUrl}/api/file/move`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourcePath: '/workspace/myapp/src/index.js',
        destinationPath: '/workspace/myapp/src/lib/index.js',

      }),
    });

    expect(moveResponse.status).toBe(200);

    // Step 5: Verify final structure
    const readPackageResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/myapp/package.json',

      }),
    });

    const packageData = await readPackageResponse.json();
    expect(readPackageResponse.status).toBe(200);
    expect(packageData.content).toContain('myapp');

    const readConfigResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/myapp/config/development.json',

      }),
    });

    const configData = await readConfigResponse.json();
    expect(readConfigResponse.status).toBe(200);
    expect(configData.content).toContain('development');

    const readIndexResponse = await fetch(`${workerUrl}/api/file/read`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        path: '/workspace/myapp/src/lib/index.js',

      }),
    });

    const indexData = await readIndexResponse.json();
    expect(readIndexResponse.status).toBe(200);
    expect(indexData.content).toContain('Hello World');

    // Step 6: Cleanup - delete entire project (use exec since deleteFile only works on files)
    const deleteResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: 'rm -rf /workspace/myapp',

      }),
    });

    const deleteData = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteData.success).toBe(true);

    // Verify cleanup
    const lsResponse = await fetch(`${workerUrl}/api/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        command: 'ls /workspace/myapp',

      }),
    });

    const lsData = await lsResponse.json();
    expect(lsData.success).toBe(false); // Directory should not exist
  }, 90000);
});
