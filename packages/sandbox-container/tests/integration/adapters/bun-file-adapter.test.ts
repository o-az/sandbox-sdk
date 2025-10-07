import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BunFileAdapter } from '@sandbox-container/adapters/bun-file-adapter.ts';
import { BunProcessAdapter } from '@sandbox-container/adapters/bun-process-adapter.ts';
import * as os from 'os';
import * as path from 'path';

describe('BunFileAdapter (Integration)', () => {
  let adapter: BunFileAdapter;
  let testDir: string;
  const testFiles: string[] = [];

  beforeEach(async () => {
    adapter = new BunFileAdapter();
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `bun-file-adapter-test-${timestamp}-${random}`);
    const processAdapter = new BunProcessAdapter();
    await processAdapter.execute('mkdir', ['-p', testDir]);
  });

  afterEach(async () => {
    try {
      const processAdapter = new BunProcessAdapter();
      await processAdapter.execute('rm', ['-rf', testDir]);
    } catch (error) {
      console.warn('Failed to cleanup test directory:', error);
    }
    testFiles.length = 0;
  });

  describe('getFile', () => {
    it('should return a BunFile object', () => {
      const testPath = path.join(testDir, 'test.txt');
      const file = adapter.getFile(testPath);

      expect(file).toBeDefined();
      expect(typeof file.size).toBe('number');
      expect(typeof file.type).toBe('string');
    });
  });

  describe('exists', () => {
    it('should return false for non-existent file', async () => {
      const testPath = path.join(testDir, 'nonexistent.txt');
      expect(await adapter.exists(testPath)).toBe(false);
    });

    it('should return true for existing file', async () => {
      const testPath = path.join(testDir, 'exists.txt');
      testFiles.push(testPath);
      await adapter.write(testPath, 'test content');
      expect(await adapter.exists(testPath)).toBe(true);
    });
  });

  describe('readText', () => {
    it('should read file content correctly', async () => {
      const testPath = path.join(testDir, 'read-test.txt');
      testFiles.push(testPath);
      const testContent = 'Hello, Bun File Adapter!';
      await adapter.write(testPath, testContent);
      expect(await adapter.readText(testPath)).toBe(testContent);
    });

    it('should read empty file', async () => {
      const testPath = path.join(testDir, 'empty.txt');
      testFiles.push(testPath);
      await adapter.write(testPath, '');
      expect(await adapter.readText(testPath)).toBe('');
    });

    it('should read multi-line content', async () => {
      const testPath = path.join(testDir, 'multiline.txt');
      testFiles.push(testPath);
      const testContent = 'Line 1\nLine 2\nLine 3\n';
      await adapter.write(testPath, testContent);
      expect(await adapter.readText(testPath)).toBe(testContent);
    });
  });

  describe('read', () => {
    it('should return content and size', async () => {
      const testPath = path.join(testDir, 'read-size-test.txt');
      testFiles.push(testPath);
      const testContent = 'Test content with size';
      await adapter.write(testPath, testContent);
      const result = await adapter.read(testPath);
      expect(result.content).toBe(testContent);
      expect(result.size).toBe(testContent.length);
    });
  });

  describe('write', () => {
    it('should write string content to file', async () => {
      const testPath = path.join(testDir, 'write-test.txt');
      testFiles.push(testPath);
      const testContent = 'Written by BunFileAdapter';
      await adapter.write(testPath, testContent);
      expect(await adapter.readText(testPath)).toBe(testContent);
    });

    it('should overwrite existing file', async () => {
      const testPath = path.join(testDir, 'overwrite-test.txt');
      testFiles.push(testPath);
      await adapter.write(testPath, 'Original content');
      await adapter.write(testPath, 'New content');
      expect(await adapter.readText(testPath)).toBe('New content');
    });

    it('should create file in nested directory if it exists', async () => {
      const nestedDir = path.join(testDir, 'nested');
      const testPath = path.join(nestedDir, 'nested-file.txt');
      testFiles.push(testPath);
      const processAdapter = new BunProcessAdapter();
      await processAdapter.execute('mkdir', ['-p', nestedDir]);
      await adapter.write(testPath, 'Nested content');
      expect(await adapter.readText(testPath)).toBe('Nested content');
    });
  });

  describe('deleteFile', () => {
    it('should delete existing file', async () => {
      const testPath = path.join(testDir, 'delete-test.txt');
      await adapter.write(testPath, 'To be deleted');
      expect(await adapter.exists(testPath)).toBe(true);
      const result = await adapter.deleteFile(testPath);
      expect(result.exitCode).toBe(0);
      expect(await adapter.exists(testPath)).toBe(false);
    });

    it('should return non-zero exit code for non-existent file', async () => {
      const testPath = path.join(testDir, 'nonexistent.txt');
      const result = await adapter.deleteFile(testPath);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('renameFile', () => {
    it('should rename file successfully', async () => {
      const oldPath = path.join(testDir, 'old-name.txt');
      const newPath = path.join(testDir, 'new-name.txt');
      testFiles.push(newPath);
      await adapter.write(oldPath, 'Content to rename');
      const result = await adapter.renameFile(oldPath, newPath);
      expect(result.exitCode).toBe(0);
      expect(await adapter.exists(oldPath)).toBe(false);
      expect(await adapter.exists(newPath)).toBe(true);
      expect(await adapter.readText(newPath)).toBe('Content to rename');
    });

    it('should return non-zero exit code for non-existent source', async () => {
      const oldPath = path.join(testDir, 'nonexistent.txt');
      const newPath = path.join(testDir, 'new.txt');
      const result = await adapter.renameFile(oldPath, newPath);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('createDirectory', () => {
    it('should create directory', async () => {
      const dirPath = path.join(testDir, 'new-directory');
      const result = await adapter.createDirectory(['mkdir', dirPath]);
      expect(result.exitCode).toBe(0);
      expect(await adapter.exists(dirPath)).toBe(true);
    });

    it('should create nested directories with -p flag', async () => {
      const dirPath = path.join(testDir, 'nested', 'deep', 'directory');
      const result = await adapter.createDirectory(['mkdir', '-p', dirPath]);
      expect(result.exitCode).toBe(0);
      expect(await adapter.exists(dirPath)).toBe(true);
    });

    it('should fail to create nested directory without -p flag', async () => {
      const dirPath = path.join(testDir, 'will-fail', 'deep');
      const result = await adapter.createDirectory(['mkdir', dirPath]);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return file statistics', async () => {
      const testPath = path.join(testDir, 'stats-test.txt');
      testFiles.push(testPath);
      await adapter.write(testPath, 'Content for stats');
      const result = await adapter.getStats(testPath, '%F:%s:%Y:%W');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toLowerCase()).toContain('regular file');
      expect(result.stdout).toMatch(/:\d+:\d+:\d+/);
    });

    it('should return directory stats', async () => {
      const dirPath = path.join(testDir, 'stats-dir');
      const processAdapter = new BunProcessAdapter();
      await processAdapter.execute('mkdir', [dirPath]);
      const result = await adapter.getStats(dirPath, '%F:%s:%Y:%W');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toLowerCase()).toContain('directory');
    });

    it('should fail for non-existent path', async () => {
      const testPath = path.join(testDir, 'nonexistent.txt');
      const result = await adapter.getStats(testPath, '%F:%s:%Y:%W');
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('copy', () => {
    it('should copy file content', async () => {
      const sourcePath = path.join(testDir, 'source.txt');
      const destPath = path.join(testDir, 'dest.txt');
      testFiles.push(sourcePath, destPath);
      const testContent = 'Content to copy';
      await adapter.write(sourcePath, testContent);
      await adapter.copy(sourcePath, destPath);
      expect(await adapter.exists(destPath)).toBe(true);
      expect(await adapter.readText(destPath)).toBe(testContent);
      expect(await adapter.exists(sourcePath)).toBe(true);
    });
  });

  describe('move', () => {
    it('should move file (copy + delete)', async () => {
      const sourcePath = path.join(testDir, 'move-source.txt');
      const destPath = path.join(testDir, 'move-dest.txt');
      testFiles.push(destPath);
      const testContent = 'Content to move';
      await adapter.write(sourcePath, testContent);
      await adapter.move(sourcePath, destPath);
      expect(await adapter.exists(sourcePath)).toBe(false);
      expect(await adapter.exists(destPath)).toBe(true);
      expect(await adapter.readText(destPath)).toBe(testContent);
    });
  });

  describe('getSize', () => {
    it('should return file size', async () => {
      const testPath = path.join(testDir, 'size-test.txt');
      testFiles.push(testPath);
      const testContent = 'Test content for size';
      await adapter.write(testPath, testContent);
      expect(await adapter.getSize(testPath)).toBe(testContent.length);
    });

    it('should return 0 for empty file', async () => {
      const testPath = path.join(testDir, 'empty-size.txt');
      testFiles.push(testPath);
      await adapter.write(testPath, '');
      expect(await adapter.getSize(testPath)).toBe(0);
    });
  });

  describe('getFileType', () => {
    it('should return mime type for text file', () => {
      const testPath = path.join(testDir, 'type-test.txt');
      expect(adapter.getFileType(testPath)).toContain('text');
    });

    it('should return mime type for json file', () => {
      const testPath = path.join(testDir, 'data.json');
      expect(adapter.getFileType(testPath)).toContain('json');
    });
  });
});
