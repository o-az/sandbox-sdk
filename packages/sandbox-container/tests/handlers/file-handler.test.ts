import { beforeEach, describe, expect, it, vi } from "bun:test";
import type { Logger, MkdirResponse, MoveFileResponse, ReadFileResponse, RenameFileResponse, RequestContext, ValidatedRequestContext } from '@sandbox-container/core/types';
import { FileHandler } from "@sandbox-container/handlers/file-handler";
import type { FileService } from '@sandbox-container/services/file-service';
import type { ContainerErrorResponse } from '@sandbox-container/utils/error-mapping';

// Mock the dependencies - use partial mock to avoid missing properties
const mockFileService = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  renameFile: vi.fn(),
  moveFile: vi.fn(),
  createDirectory: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  delete: vi.fn(),
  rename: vi.fn(),
  move: vi.fn(),
  mkdir: vi.fn(),
  exists: vi.fn(),
  stat: vi.fn(),
  getFileStats: vi.fn(),
  // Remove private properties to avoid type conflicts
} as unknown as FileService;

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// Mock request context
const mockContext: RequestContext = {
  requestId: 'req-123',
  timestamp: new Date(),
  corsHeaders: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  },
  sessionId: 'session-456',
};

// Helper to create validated context
const createValidatedContext = <T>(data: T): ValidatedRequestContext<T> => ({
  ...mockContext,
  validatedData: data
});

describe('FileHandler', () => {
  let fileHandler: FileHandler;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    fileHandler = new FileHandler(mockFileService, mockLogger);
  });

  describe('handleRead - POST /api/read', () => {
    it('should read file successfully', async () => {
      const readFileData = {
        path: '/tmp/test.txt',
        encoding: 'utf-8'
      };
      const fileContent = 'Hello, World!';

      const validatedContext = createValidatedContext(readFileData);
      (mockFileService.readFile as any).mockResolvedValue({
        success: true,
        data: fileContent
      });

      const request = new Request('http://localhost:3000/api/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as ReadFileResponse;
      expect(responseData.success).toBe(true);
      expect(responseData.data).toBe(fileContent);
      expect(responseData.timestamp).toBeDefined();

      // Verify service was called correctly
      expect(mockFileService.readFile).toHaveBeenCalledWith('/tmp/test.txt', {
        encoding: 'utf-8'
      });
    });

    it('should use default encoding when not specified', async () => {
      const readFileData = {
        path: '/tmp/test.txt'
        // encoding not specified
      };

      const validatedContext = createValidatedContext(readFileData);
      (mockFileService.readFile as any).mockResolvedValue({
        success: true,
        data: 'file content'
      });

      const request = new Request('http://localhost:3000/api/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as ReadFileResponse;
      expect(responseData.success).toBe(true);
      expect(responseData.timestamp).toBeDefined();

      expect(mockFileService.readFile).toHaveBeenCalledWith('/tmp/test.txt', {
        encoding: 'utf-8'
      });
    });

    it('should handle file read errors', async () => {
      const readFileData = { path: '/tmp/nonexistent.txt' };
      const validatedContext = createValidatedContext(readFileData);

      (mockFileService.readFile as any).mockResolvedValue({
        success: false,
        error: {
          message: 'File not found',
          code: 'FILE_NOT_FOUND',
          details: { path: '/tmp/nonexistent.txt' }
        }
      });

      const request = new Request('http://localhost:3000/api/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(404);
      const responseData = await response.json() as ContainerErrorResponse;
      expect(responseData.code).toBe('FILE_NOT_FOUND');
      expect(responseData.message).toBe('File not found');
      expect(responseData.httpStatus).toBe(404);
      expect(responseData.timestamp).toBeDefined();
    });
  });

  describe('handleWrite - POST /api/write', () => {
    it('should write file successfully', async () => {
      const writeFileData = {
        path: '/tmp/output.txt',
        content: 'Hello, File!',
        encoding: 'utf-8'
      };

      const validatedContext = createValidatedContext(writeFileData);
      (mockFileService.writeFile as any).mockResolvedValue({
        success: true
      });

      const request = new Request('http://localhost:3000/api/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(writeFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as ReadFileResponse;
      expect(responseData.success).toBe(true);
      expect(responseData.timestamp).toBeDefined();

      // Verify service was called correctly
      expect(mockFileService.writeFile).toHaveBeenCalledWith('/tmp/output.txt', 'Hello, File!', {
        encoding: 'utf-8'
      });
    });

    it('should handle file write errors', async () => {
      const writeFileData = {
        path: '/readonly/file.txt',
        content: 'content'
      };
      const validatedContext = createValidatedContext(writeFileData);

      (mockFileService.writeFile as any).mockResolvedValue({
        success: false,
        error: {
          message: 'Permission denied',
          code: 'PERMISSION_DENIED',
          details: { path: '/readonly/file.txt' }
        }
      });

      const request = new Request('http://localhost:3000/api/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(writeFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(403);
      const responseData = await response.json() as ContainerErrorResponse;
      expect(responseData.code).toBe('PERMISSION_DENIED');
      expect(responseData.message).toBe('Permission denied');
      expect(responseData.httpStatus).toBe(403);
      expect(responseData.timestamp).toBeDefined();
    });
  });

  describe('handleDelete - POST /api/delete', () => {
    it('should delete file successfully', async () => {
      const deleteFileData = {
        path: '/tmp/delete-me.txt'
      };

      const validatedContext = createValidatedContext(deleteFileData);
      (mockFileService.deleteFile as any).mockResolvedValue({
        success: true
      });

      const request = new Request('http://localhost:3000/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deleteFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as ReadFileResponse;
      expect(responseData.success).toBe(true);
      expect(responseData.timestamp).toBeDefined();

      expect(mockFileService.deleteFile).toHaveBeenCalledWith('/tmp/delete-me.txt');
    });

    it('should handle file delete errors', async () => {
      const deleteFileData = { path: '/tmp/nonexistent.txt' };
      const validatedContext = createValidatedContext(deleteFileData);

      (mockFileService.deleteFile as any).mockResolvedValue({
        success: false,
        error: {
          message: 'File not found',
          code: 'FILE_NOT_FOUND'
        }
      });

      const request = new Request('http://localhost:3000/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deleteFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(404);
      const responseData = await response.json() as ContainerErrorResponse;
      expect(responseData.code).toBe('FILE_NOT_FOUND');
      expect(responseData.message).toBe('File not found');
      expect(responseData.httpStatus).toBe(404);
      expect(responseData.timestamp).toBeDefined();
    });
  });

  describe('handleRename - POST /api/rename', () => {
    it('should rename file successfully', async () => {
      const renameFileData = {
        oldPath: '/tmp/old-name.txt',
        newPath: '/tmp/new-name.txt'
      };

      const validatedContext = createValidatedContext(renameFileData);
      (mockFileService.renameFile as any).mockResolvedValue({
        success: true
      });

      const request = new Request('http://localhost:3000/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renameFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as RenameFileResponse;
      expect(responseData.success).toBe(true);
      expect(responseData.timestamp).toBeDefined();

      expect(mockFileService.renameFile).toHaveBeenCalledWith('/tmp/old-name.txt', '/tmp/new-name.txt');
    });

    it('should handle file rename errors', async () => {
      const renameFileData = {
        oldPath: '/tmp/nonexistent.txt',
        newPath: '/tmp/renamed.txt'
      };
      const validatedContext = createValidatedContext(renameFileData);

      (mockFileService.renameFile as any).mockResolvedValue({
        success: false,
        error: {
          message: 'Source file not found',
          code: 'FILE_NOT_FOUND'
        }
      });

      const request = new Request('http://localhost:3000/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renameFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(404);
      const responseData = await response.json() as ContainerErrorResponse;
      expect(responseData.code).toBe('FILE_NOT_FOUND');
      expect(responseData.message).toBe('Source file not found');
      expect(responseData.httpStatus).toBe(404);
      expect(responseData.timestamp).toBeDefined();
    });
  });

  describe('handleMove - POST /api/move', () => {
    it('should move file successfully', async () => {
      const moveFileData = {
        sourcePath: '/tmp/source.txt',
        destinationPath: '/tmp/destination.txt'
      };

      const validatedContext = createValidatedContext(moveFileData);
      (mockFileService.moveFile as any).mockResolvedValue({
        success: true
      });

      const request = new Request('http://localhost:3000/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(moveFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as MoveFileResponse;
      expect(responseData.success).toBe(true);
      expect(responseData.timestamp).toBeDefined();

      expect(mockFileService.moveFile).toHaveBeenCalledWith('/tmp/source.txt', '/tmp/destination.txt');
    });

    it('should handle file move errors', async () => {
      const moveFileData = {
        sourcePath: '/tmp/source.txt',
        destinationPath: '/readonly/destination.txt'
      };
      const validatedContext = createValidatedContext(moveFileData);

      (mockFileService.moveFile as any).mockResolvedValue({
        success: false,
        error: {
          message: 'Permission denied on destination',
          code: 'PERMISSION_DENIED'
        }
      });

      const request = new Request('http://localhost:3000/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(moveFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(403);
      const responseData = await response.json() as ContainerErrorResponse;
      expect(responseData.code).toBe('PERMISSION_DENIED');
      expect(responseData.message).toBe('Permission denied on destination');
      expect(responseData.httpStatus).toBe(403);
      expect(responseData.timestamp).toBeDefined();
    });
  });

  describe('handleMkdir - POST /api/mkdir', () => {
    it('should create directory successfully', async () => {
      const mkdirData = {
        path: '/tmp/new-directory',
        recursive: true
      };

      const validatedContext = createValidatedContext(mkdirData);
      (mockFileService.createDirectory as any).mockResolvedValue({
        success: true
      });

      const request = new Request('http://localhost:3000/api/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mkdirData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as MkdirResponse;
      expect(responseData.success).toBe(true);
      expect(responseData.timestamp).toBeDefined();

      expect(mockFileService.createDirectory).toHaveBeenCalledWith('/tmp/new-directory', {
        recursive: true
      });
    });

    it('should create directory without recursive option', async () => {
      const mkdirData = {
        path: '/tmp/simple-dir'
        // recursive not specified
      };

      const validatedContext = createValidatedContext(mkdirData);
      (mockFileService.createDirectory as any).mockResolvedValue({
        success: true
      });

      const request = new Request('http://localhost:3000/api/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mkdirData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(200);
      const responseData = await response.json() as MkdirResponse;
      expect(responseData.success).toBe(true);
      expect(responseData.timestamp).toBeDefined();

      expect(mockFileService.createDirectory).toHaveBeenCalledWith('/tmp/simple-dir', {
        recursive: undefined
      });
    });

    it('should handle directory creation errors', async () => {
      const mkdirData = {
        path: '/readonly/new-dir',
        recursive: false
      };
      const validatedContext = createValidatedContext(mkdirData);

      (mockFileService.createDirectory as any).mockResolvedValue({
        success: false,
        error: {
          message: 'Permission denied',
          code: 'PERMISSION_DENIED'
        }
      });

      const request = new Request('http://localhost:3000/api/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mkdirData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.status).toBe(403);
      const responseData = await response.json() as ContainerErrorResponse;
      expect(responseData.code).toBe('PERMISSION_DENIED');
      expect(responseData.message).toBe('Permission denied');
      expect(responseData.httpStatus).toBe(403);
      expect(responseData.timestamp).toBeDefined();
    });
  });

  describe('route handling', () => {
    it('should return 500 for invalid endpoints', async () => {
      const request = new Request('http://localhost:3000/api/invalid-operation', {
        method: 'POST'
      });

      const response = await fileHandler.handle(request, mockContext);

      expect(response.status).toBe(500);
      const responseData = await response.json() as ContainerErrorResponse;
      expect(responseData.code).toBe('UNKNOWN_ERROR');
      expect(responseData.message).toContain('Invalid file endpoint');
      expect(responseData.httpStatus).toBe(500);
      expect(responseData.timestamp).toBeDefined();
    });

    it('should handle root path correctly', async () => {
      const request = new Request('http://localhost:3000/', {
        method: 'GET'
      });

      const response = await fileHandler.handle(request, mockContext);

      expect(response.status).toBe(500);
      const responseData = await response.json() as ContainerErrorResponse;
      expect(responseData.code).toBe('UNKNOWN_ERROR');
      expect(responseData.message).toContain('Invalid file endpoint');
      expect(responseData.httpStatus).toBe(500);
      expect(responseData.timestamp).toBeDefined();
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in all successful responses', async () => {
      const readFileData = { path: '/tmp/test.txt' };
      const validatedContext = createValidatedContext(readFileData);

      (mockFileService.readFile as any).mockResolvedValue({
        success: true,
        data: 'file content'
      });

      const request = new Request('http://localhost:3000/api/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readFileData)
      });

      const response = await fileHandler.handle(request, validatedContext);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    });

    it('should include CORS headers in error responses', async () => {
      const request = new Request('http://localhost:3000/api/invalid', {
        method: 'POST'
      });

      const response = await fileHandler.handle(request, mockContext);

      expect(response.status).toBe(500);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('response format consistency', () => {
    it('should have consistent response format across all operations', async () => {
      // Test all operations return consistent fields
      const operations = [
        {
          endpoint: '/api/read',
          data: { path: '/tmp/test.txt' },
          mockResponse: { success: true, data: 'content' },
          expectedFields: ['success', 'data', 'timestamp']
        },
        {
          endpoint: '/api/write',
          data: { path: '/tmp/test.txt', content: 'data' },
          mockResponse: { success: true },
          expectedFields: ['success', 'timestamp']
        },
        {
          endpoint: '/api/delete',
          data: { path: '/tmp/test.txt' },
          mockResponse: { success: true },
          expectedFields: ['success', 'timestamp']
        }
      ];

      for (const operation of operations) {
        // Reset mocks
        vi.clearAllMocks();
        const validatedContext = createValidatedContext(operation.data);

        // Mock appropriate service method
        if (operation.endpoint === '/api/read') {
          (mockFileService.readFile as any).mockResolvedValue(operation.mockResponse);
        } else if (operation.endpoint === '/api/write') {
          (mockFileService.writeFile as any).mockResolvedValue(operation.mockResponse);
        } else if (operation.endpoint === '/api/delete') {
          (mockFileService.deleteFile as any).mockResolvedValue(operation.mockResponse);
        }

        const request = new Request(`http://localhost:3000${operation.endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation.data)
        });

        const response = await fileHandler.handle(request, validatedContext);
        const responseData = await response.json() as ReadFileResponse;

        // Check that all expected fields are present
        for (const field of operation.expectedFields) {
          expect(responseData).toHaveProperty(field);
        }

        // Check common fields
        expect(responseData.success).toBe(true);
        expect(responseData.timestamp).toBeDefined();
      }
    });
  });
});
