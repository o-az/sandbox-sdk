import { beforeEach, describe, expect, it, vi } from "bun:test";
import type { BunFileAdapter, FileContent } from '@sandbox-container/adapters/bun-file-adapter';
import type { ExecutionResult } from '@sandbox-container/adapters/bun-process-adapter';
import type { Logger } from '@sandbox-container/core/types';
import { FileService, type SecurityService } from '@sandbox-container/services/file-service';
import { mocked } from '../test-utils';

// Mock SecurityService with proper typing
const mockSecurityService: SecurityService = {
  validatePath: vi.fn(),
  sanitizePath: vi.fn(),
};

// Mock Logger with proper typing
const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// Mock BunFileAdapter with proper typing
const mockAdapter: BunFileAdapter = {
  getFile: vi.fn(),
  exists: vi.fn(),
  readText: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  deleteFile: vi.fn(),
  renameFile: vi.fn(),
  createDirectory: vi.fn(),
  getStats: vi.fn(),
  copy: vi.fn(),
  move: vi.fn(),
  getSize: vi.fn(),
  getFileType: vi.fn(),
} as unknown as BunFileAdapter;

describe('FileService', () => {
  let FileServiceClass: typeof FileService;
  let fileService: FileService;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Set up default successful security validation
    mocked(mockSecurityService.validatePath).mockReturnValue({
      isValid: true,
      errors: []
    });

    // Create service with mocked adapter
    fileService = new FileService(
      mockSecurityService,
      mockLogger,
      mockAdapter  // Inject mocked adapter
    );
  });

  describe('read', () => {
    it('should read file successfully', async () => {
      const testPath = '/tmp/test.txt';
      const testContent = 'Hello, World!';

      mocked(mockAdapter.exists).mockResolvedValue(true);
      mocked(mockAdapter.read).mockResolvedValue({
        content: testContent,
        size: testContent.length,
      });

      const result = await fileService.read(testPath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(testContent);
      }

      // Verify security validation was called
      expect(mockSecurityService.validatePath).toHaveBeenCalledWith(testPath);

      // Verify adapter was called correctly
      expect(mockAdapter.exists).toHaveBeenCalledWith(testPath);
      expect(mockAdapter.read).toHaveBeenCalledWith(testPath);
    });

    it('should return error when security validation fails', async () => {
      mocked(mockSecurityService.validatePath).mockReturnValue({
        isValid: false,
        errors: ['Path contains invalid characters', 'Path outside sandbox']
      });

      const result = await fileService.read('/malicious/../path');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('SECURITY_VALIDATION_FAILED');
        expect(result.error.message).toContain('Path contains invalid characters');
      }

      // Should not attempt file operations
      expect(mockAdapter.exists).not.toHaveBeenCalled();
    });

    it('should return error when file does not exist', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(false);

      const result = await fileService.read('/tmp/nonexistent.txt');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FILE_NOT_FOUND');
      }

      // Should not attempt to read
      expect(mockAdapter.read).not.toHaveBeenCalled();
    });

    it('should handle adapter errors gracefully', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(true);
      mocked(mockAdapter.read).mockRejectedValue(new Error('Permission denied'));

      const result = await fileService.read('/tmp/test.txt');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
        expect(result.error.message).toContain('Permission denied');
      }
    });
  });

  describe('write', () => {
    it('should write file successfully', async () => {
      const testPath = '/tmp/test.txt';
      const testContent = 'Test content';

      mocked(mockAdapter.write).mockResolvedValue(undefined);

      const result = await fileService.write(testPath, testContent);

      expect(result.success).toBe(true);

      // Verify adapter was called
      expect(mockAdapter.write).toHaveBeenCalledWith(testPath, testContent);
    });

    it('should handle write errors', async () => {
      mocked(mockAdapter.write).mockRejectedValue(new Error('Disk full'));

      const result = await fileService.write('/tmp/test.txt', 'content');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('DISK_FULL');
      }
    });
  });

  describe('delete', () => {
    it('should delete file successfully', async () => {
      const testPath = '/tmp/test.txt';

      mocked(mockAdapter.exists).mockResolvedValue(true);
      mocked(mockAdapter.deleteFile).mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      const result = await fileService.delete(testPath);

      expect(result.success).toBe(true);
      expect(mockAdapter.exists).toHaveBeenCalledWith(testPath);
      expect(mockAdapter.deleteFile).toHaveBeenCalledWith(testPath);
    });

    it('should return error when file does not exist', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(false);

      const result = await fileService.delete('/tmp/nonexistent.txt');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FILE_NOT_FOUND');
      }

      // Should not attempt to delete
      expect(mockAdapter.deleteFile).not.toHaveBeenCalled();
    });

    it('should handle delete command failures', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(true);
      mocked(mockAdapter.deleteFile).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Permission denied',
      });

      const result = await fileService.delete('/tmp/test.txt');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FILE_DELETE_ERROR');
        expect(result.error.details?.exitCode).toBe(1);
      }
    });
  });

  describe('rename', () => {
    it('should rename file successfully', async () => {
      const oldPath = '/tmp/old.txt';
      const newPath = '/tmp/new.txt';

      mocked(mockAdapter.exists).mockResolvedValue(true);
      mocked(mockAdapter.renameFile).mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      const result = await fileService.rename(oldPath, newPath);

      expect(result.success).toBe(true);

      // Should validate both paths
      expect(mockSecurityService.validatePath).toHaveBeenCalledWith(oldPath);
      expect(mockSecurityService.validatePath).toHaveBeenCalledWith(newPath);

      expect(mockAdapter.renameFile).toHaveBeenCalledWith(oldPath, newPath);
    });

    it('should handle rename command failures', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(true);
      mocked(mockAdapter.renameFile).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Target exists',
      });

      const result = await fileService.rename('/tmp/old.txt', '/tmp/new.txt');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('RENAME_ERROR');
      }
    });
  });

  describe('move', () => {
    it('should move file using zero-copy operations', async () => {
      const sourcePath = '/tmp/source.txt';
      const destPath = '/tmp/dest.txt';

      mocked(mockAdapter.exists).mockResolvedValue(true);
      mocked(mockAdapter.move).mockResolvedValue(undefined);

      const result = await fileService.move(sourcePath, destPath);

      expect(result.success).toBe(true);
      expect(mockAdapter.move).toHaveBeenCalledWith(sourcePath, destPath);
    });

    it('should return error when source does not exist', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(false);

      const result = await fileService.move('/tmp/nonexistent.txt', '/tmp/dest.txt');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FILE_NOT_FOUND');
      }
    });
  });

  describe('mkdir', () => {
    it('should create directory successfully', async () => {
      const testPath = '/tmp/newdir';

      mocked(mockAdapter.createDirectory).mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      const result = await fileService.mkdir(testPath);

      expect(result.success).toBe(true);
      // createDirectory is called with args from buildMkdirArgs: ['mkdir', '/tmp/newdir']
      expect(mockAdapter.createDirectory).toHaveBeenCalledWith(['mkdir', testPath]);
    });

    it('should create directory recursively when requested', async () => {
      const testPath = '/tmp/nested/dir';

      mocked(mockAdapter.createDirectory).mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
      });

      const result = await fileService.mkdir(testPath, { recursive: true });

      expect(result.success).toBe(true);
      expect(mockAdapter.createDirectory).toHaveBeenCalledWith(['mkdir', '-p', testPath]);
    });

    it('should handle mkdir command failures', async () => {
      mocked(mockAdapter.createDirectory).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Parent directory not found',
      });

      const result = await fileService.mkdir('/tmp/newdir');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('MKDIR_ERROR');
      }
    });
  });

  describe('exists', () => {
    it('should return true when file exists', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(true);

      const result = await fileService.exists('/tmp/test.txt');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(true);
      }
    });

    it('should return false when file does not exist', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(false);

      const result = await fileService.exists('/tmp/nonexistent.txt');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(false);
      }
    });

    it('should handle exists check errors', async () => {
      mocked(mockAdapter.exists).mockRejectedValue(new Error('Permission denied'));

      const result = await fileService.exists('/tmp/test.txt');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  describe('stat', () => {
    it('should return file statistics successfully', async () => {
      const testPath = '/tmp/test.txt';

      mocked(mockAdapter.exists).mockResolvedValue(true);
      mocked(mockAdapter.getStats).mockResolvedValue({
        exitCode: 0,
        stdout: 'regular file:1024:1672531200:1672531100\n',
        stderr: '',
      });

      const result = await fileService.stat(testPath);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isFile).toBe(true);
        expect(result.data.isDirectory).toBe(false);
        expect(result.data.size).toBe(1024);
        expect(result.data.modified).toBeInstanceOf(Date);
        expect(result.data.created).toBeInstanceOf(Date);
      }
    });

    it('should return error when file does not exist', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(false);

      const result = await fileService.stat('/tmp/nonexistent.txt');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('FILE_NOT_FOUND');
      }
    });

    it('should handle stat command failures', async () => {
      mocked(mockAdapter.exists).mockResolvedValue(true);
      mocked(mockAdapter.getStats).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'stat error',
      });

      const result = await fileService.stat('/tmp/test.txt');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('STAT_ERROR');
      }
    });
  });

});
