import { beforeEach, describe, expect, it, vi } from "bun:test";
import type { SecurityService } from '@sandbox-container/security/security-service.ts';
import { RequestValidator } from "@sandbox-container/validation/request-validator.js";
import type { MkdirRequest } from '@sandbox-container/validation/schemas.ts';

// Mock the SecurityService - use partial mock to avoid private property issues
const mockSecurityService = {
  validatePath: vi.fn(),
  validateCommand: vi.fn(),
  validatePort: vi.fn(),
  validateGitUrl: vi.fn(),
  sanitizePath: vi.fn(),
  isPathInAllowedDirectory: vi.fn(),
  generateSecureSessionId: vi.fn(),
  hashSensitiveData: vi.fn(),
  logSecurityEvent: vi.fn(),
} as unknown as SecurityService;

describe('RequestValidator', () => {
  let requestValidator: RequestValidator;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Set up default successful security validations
    (mockSecurityService.validatePath as any).mockReturnValue({
      isValid: true,
      errors: [],
      data: '/tmp/test'
    });
    (mockSecurityService.validateCommand as any).mockReturnValue({
      isValid: true,
      errors: [],
      data: 'ls -la'
    });
    (mockSecurityService.validatePort as any).mockReturnValue({
      isValid: true,
      errors: [],
      data: 8080
    });
    (mockSecurityService.validateGitUrl as any).mockReturnValue({
      isValid: true,
      errors: [],
      data: 'https://github.com/user/repo.git'
    });

    requestValidator = new RequestValidator(mockSecurityService);
  });

  describe('validateExecuteRequest', () => {
    describe('valid requests', () => {
      it('should validate minimal execute request', async () => {
        const validRequest = {
          command: 'ls -la'
        };

        const result = requestValidator.validateExecuteRequest(validRequest);

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual({
          command: 'ls -la'
        });
        expect(result.errors).toHaveLength(0);

        // Verify security validation was called
        expect(mockSecurityService.validateCommand).toHaveBeenCalledWith('ls -la');
      });

      it('should validate execute request with all fields', async () => {
        const validRequest = {
          command: 'echo "hello"',
          sessionId: 'session-123',
          cwd: '/tmp',
          env: { NODE_ENV: 'test' },
          background: true
        };

        const result = requestValidator.validateExecuteRequest(validRequest);

        expect(result.isValid).toBe(true);
        // Only fields defined in ExecuteRequestSchema are included in result.data
        expect(result.data).toEqual({
          command: 'echo "hello"',
          sessionId: 'session-123',
          background: true
        });
        expect(result.errors).toHaveLength(0);
      });

      it('should validate execute request with streaming', async () => {
        const validRequest = {
          command: 'tail -f /var/log/test.log',
          streaming: true  // This field is not in ExecuteRequestSchema so will be filtered out
        };

        const result = requestValidator.validateExecuteRequest(validRequest);

        expect(result.isValid).toBe(true);
        // streaming field is not in ExecuteRequestSchema, so only command is included
        expect(result.data).toEqual({
          command: 'tail -f /var/log/test.log'
        });
      });
    });

    describe('invalid requests', () => {
      it('should reject request without command', async () => {
        const invalidRequest = {
          sessionId: 'session-123'
        };

        const result = requestValidator.validateExecuteRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.field === 'command')).toBe(true);
      });

      it('should reject request with invalid command type', async () => {
        const invalidRequest = {
          command: 123 // Should be string
        };

        const result = requestValidator.validateExecuteRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'command')).toBe(true);
      });

      it('should reject empty command', async () => {
        const invalidRequest = {
          command: ''
        };

        const result = requestValidator.validateExecuteRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'command')).toBe(true);
      });

      it('should propagate security validation errors', async () => {
        (mockSecurityService.validateCommand as any).mockReturnValue({
          isValid: false,
          errors: [{
            field: 'command',
            message: 'Command contains dangerous pattern',
            code: 'COMMAND_SECURITY_VIOLATION'
          }]
        });

        const validRequest = {
          command: 'rm -rf /'
        };

        const result = requestValidator.validateExecuteRequest(validRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('COMMAND_SECURITY_VIOLATION');
        expect(result.errors[0].message).toContain('dangerous pattern');
      });

      it('should reject invalid background type', async () => {
        const invalidRequest = {
          command: 'ls',
          background: 'true' // Should be boolean
        };

        const result = requestValidator.validateExecuteRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'background')).toBe(true);
      });

      it('should ignore fields not in schema (like env)', async () => {
        const requestWithExtraFields = {
          command: 'ls',
          env: 'invalid', // This field is not in ExecuteRequestSchema so will be ignored
          extraField: 'also ignored'
        };

        const result = requestValidator.validateExecuteRequest(requestWithExtraFields);

        expect(result.isValid).toBe(true); // Validation passes because extra fields are ignored
        expect(result.data).toEqual({
          command: 'ls'
        });
      });
    });
  });

  describe('validateFileRequest', () => {
    describe('read operations', () => {
      it('should validate read file request', async () => {
        const validRequest = {
          path: '/tmp/test.txt',
          encoding: 'utf-8'
        };

        const result = requestValidator.validateFileRequest(validRequest, 'read');

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);
        expect(mockSecurityService.validatePath).toHaveBeenCalledWith('/tmp/test.txt');
      });

      it('should reject read request without path', async () => {
        const invalidRequest = {
          encoding: 'utf-8'
        };

        const result = requestValidator.validateFileRequest(invalidRequest, 'read');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'path')).toBe(true);
      });
    });

    describe('write operations', () => {
      it('should validate write file request', async () => {
        const validRequest = {
          path: '/tmp/output.txt',
          content: 'Hello, World!',
          encoding: 'utf-8'
        };

        const result = requestValidator.validateFileRequest(validRequest, 'write');

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);
        expect(mockSecurityService.validatePath).toHaveBeenCalledWith('/tmp/output.txt');
      });

      it('should reject write request without content', async () => {
        const invalidRequest = {
          path: '/tmp/output.txt'
        };

        const result = requestValidator.validateFileRequest(invalidRequest, 'write');

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'content')).toBe(true);
      });
    });

    describe('delete operations', () => {
      it('should validate delete file request', async () => {
        const validRequest = {
          path: '/tmp/delete-me.txt'
        };

        const result = requestValidator.validateFileRequest(validRequest, 'delete');

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);
        expect(mockSecurityService.validatePath).toHaveBeenCalledWith('/tmp/delete-me.txt');
      });
    });

    describe('rename operations', () => {
      it('should validate rename file request', async () => {
        const validRequest = {
          oldPath: '/tmp/old-name.txt',
          newPath: '/tmp/new-name.txt'
        };

        const result = requestValidator.validateFileRequest(validRequest, 'rename');

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);

        // Should validate both paths
        expect(mockSecurityService.validatePath).toHaveBeenCalledWith('/tmp/old-name.txt');
        expect(mockSecurityService.validatePath).toHaveBeenCalledWith('/tmp/new-name.txt');
      });

      it('should reject rename request with invalid paths', async () => {
        (mockSecurityService.validatePath as any)
          .mockReturnValueOnce({ isValid: true, errors: [] })    // oldPath valid
          .mockReturnValueOnce({                                 // newPath invalid
            isValid: false,
            errors: [{
              field: 'path',
              message: 'Path contains dangerous pattern',
              code: 'PATH_SECURITY_VIOLATION'
            }]
          });

        const validRequest = {
          oldPath: '/tmp/old-name.txt',
          newPath: '/etc/passwd'
        };

        const result = requestValidator.validateFileRequest(validRequest, 'rename');

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('PATH_SECURITY_VIOLATION');
      });
    });

    describe('move operations', () => {
      it('should validate move file request', async () => {
        const validRequest = {
          sourcePath: '/tmp/source.txt',
          destinationPath: '/tmp/destination.txt'
        };

        const result = requestValidator.validateFileRequest(validRequest, 'move');

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);

        // Should validate both paths
        expect(mockSecurityService.validatePath).toHaveBeenCalledWith('/tmp/source.txt');
        expect(mockSecurityService.validatePath).toHaveBeenCalledWith('/tmp/destination.txt');
      });
    });

    describe('mkdir operations', () => {
      it('should validate mkdir request', async () => {
        const validRequest = {
          path: '/tmp/new-directory',
          recursive: true
        };

        const result = requestValidator.validateFileRequest(validRequest, 'mkdir');

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);
        expect(mockSecurityService.validatePath).toHaveBeenCalledWith('/tmp/new-directory');
      });

      it('should validate mkdir request without recursive flag', async () => {
        const validRequest = {
          path: '/tmp/simple-dir'
        };

        const result = requestValidator.validateFileRequest(validRequest, 'mkdir');

        expect(result.isValid).toBe(true);
        expect((result.data as MkdirRequest)?.recursive).toBeUndefined();
      });
    });

    describe('path security validation', () => {
      it('should propagate path security validation errors', async () => {
        (mockSecurityService.validatePath as any).mockReturnValue({
          isValid: false,
          errors: [{
            field: 'path',
            message: 'Path contains directory traversal',
            code: 'PATH_SECURITY_VIOLATION'
          }]
        });

        const invalidRequest = {
          path: '/tmp/../etc/passwd'
        };

        const result = requestValidator.validateFileRequest(invalidRequest, 'read');

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('PATH_SECURITY_VIOLATION');
        expect(result.errors[0].message).toContain('directory traversal');
      });
    });
  });

  describe('validateProcessRequest', () => {
    describe('valid requests', () => {
      it('should validate process start request', async () => {
        const validRequest = {
          command: 'sleep 60',
          background: true,  // Not in StartProcessRequestSchema, will be filtered out
          cwd: '/tmp',       // Not in StartProcessRequestSchema, will be filtered out  
          env: { NODE_ENV: 'production' }  // Not in StartProcessRequestSchema, will be filtered out
        };

        const result = requestValidator.validateProcessRequest(validRequest);

        expect(result.isValid).toBe(true);
        // Only fields defined in StartProcessRequestSchema are included
        expect(result.data).toEqual({
          command: 'sleep 60'
        });
        expect(mockSecurityService.validateCommand).toHaveBeenCalledWith('sleep 60');
      });

      it('should validate minimal process request', async () => {
        const validRequest = {
          command: 'node app.js'
        };

        const result = requestValidator.validateProcessRequest(validRequest);

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);
      });
    });

    describe('invalid requests', () => {
      it('should reject process request without command', async () => {
        const invalidRequest = {
          background: true
        };

        const result = requestValidator.validateProcessRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'command')).toBe(true);
      });

      it('should propagate command security validation errors', async () => {
        (mockSecurityService.validateCommand as any).mockReturnValue({
          isValid: false,
          errors: [{
            field: 'command',
            message: 'Command contains privilege escalation attempt',
            code: 'COMMAND_SECURITY_VIOLATION'
          }]
        });

        const invalidRequest = {
          command: 'sudo rm -rf /'
        };

        const result = requestValidator.validateProcessRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('COMMAND_SECURITY_VIOLATION');
      });
    });
  });

  describe('validatePortRequest', () => {
    describe('valid requests', () => {
      it('should validate port expose request with name', async () => {
        const validRequest = {
          port: 8080,
          name: 'web-server'
        };

        const result = requestValidator.validatePortRequest(validRequest);

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);
        expect(mockSecurityService.validatePort).toHaveBeenCalledWith(8080);
      });

      it('should validate port expose request without name', async () => {
        const validRequest = {
          port: 9000
        };

        const result = requestValidator.validatePortRequest(validRequest);

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);
      });
    });

    describe('invalid requests', () => {
      it('should reject port request without port number', async () => {
        const invalidRequest = {
          name: 'web-server'
        };

        const result = requestValidator.validatePortRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'port')).toBe(true);
      });

      it('should reject port request with invalid port type', async () => {
        const invalidRequest = {
          port: '8080' // Should be number
        };

        const result = requestValidator.validatePortRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'port')).toBe(true);
      });

      it('should propagate port security validation errors', async () => {
        (mockSecurityService.validatePort as any).mockReturnValue({
          isValid: false,
          errors: [{
            field: 'port',
            message: 'Port 3000 is reserved for the container control plane',
            code: 'INVALID_PORT'
          }]
        });

        const invalidRequest = {
          port: 3000  // Port 3000 passes Zod validation (>= 1024) but fails security validation
        };

        const result = requestValidator.validatePortRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('INVALID_PORT');
        expect(result.errors[0].message).toContain('reserved');
      });
    });
  });

  describe('validateGitRequest', () => {
    describe('valid requests', () => {
      it('should validate git checkout request with all fields', async () => {
        const validRequest = {
          repoUrl: 'https://github.com/user/awesome-repo.git',
          branch: 'develop',
          targetDir: '/tmp/project',
          sessionId: 'session-456'
        };

        const result = requestValidator.validateGitRequest(validRequest);

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);
        expect(mockSecurityService.validateGitUrl).toHaveBeenCalledWith(validRequest.repoUrl);
        expect(mockSecurityService.validatePath).toHaveBeenCalledWith(validRequest.targetDir);
      });

      it('should validate minimal git checkout request', async () => {
        const validRequest = {
          repoUrl: 'https://github.com/user/simple-repo.git'
        };

        const result = requestValidator.validateGitRequest(validRequest);

        expect(result.isValid).toBe(true);
        expect(result.data).toEqual(validRequest);
        expect(mockSecurityService.validateGitUrl).toHaveBeenCalledWith(validRequest.repoUrl);
        // Should not call validatePath since targetDir is not provided
        expect(mockSecurityService.validatePath).not.toHaveBeenCalled();
      });

      it('should validate git request without targetDir', async () => {
        const validRequest = {
          repoUrl: 'https://github.com/user/repo.git',
          branch: 'main'
        };

        const result = requestValidator.validateGitRequest(validRequest);

        expect(result.isValid).toBe(true);
        expect(result.data?.targetDir).toBeUndefined();
      });
    });

    describe('invalid requests', () => {
      it('should reject git request without repoUrl', async () => {
        const invalidRequest = {
          branch: 'main'
        };

        const result = requestValidator.validateGitRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'repoUrl')).toBe(true);
      });

      it('should reject git request with invalid repoUrl type', async () => {
        const invalidRequest = {
          repoUrl: 123 // Should be string
        };

        const result = requestValidator.validateGitRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'repoUrl')).toBe(true);
      });

      it('should propagate Git URL security validation errors', async () => {
        (mockSecurityService.validateGitUrl as any).mockReturnValue({
          isValid: false,
          errors: [{
            field: 'gitUrl',
            message: 'Git URL must be from a trusted provider',
            code: 'GIT_URL_SECURITY_VIOLATION'
          }]
        });

        const invalidRequest = {
          repoUrl: 'https://malicious.com/repo.git'
        };

        const result = requestValidator.validateGitRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('GIT_URL_SECURITY_VIOLATION');
        expect(result.errors[0].message).toContain('trusted provider');
      });

      it('should propagate target directory validation errors', async () => {
        (mockSecurityService.validatePath as any).mockReturnValue({
          isValid: false,
          errors: [{
            field: 'path',
            message: 'Path outside sandbox',
            code: 'PATH_SECURITY_VIOLATION'
          }]
        });

        const invalidRequest = {
          repoUrl: 'https://github.com/user/repo.git',
          targetDir: '/etc/malicious'
        };

        const result = requestValidator.validateGitRequest(invalidRequest);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('PATH_SECURITY_VIOLATION');
        expect(result.errors[0].message).toContain('outside sandbox');
      });
    });
  });

  describe('error handling', () => {
    it('should handle invalid inputs and convert Zod errors', async () => {
      // Null/undefined
      expect(requestValidator.validateExecuteRequest(null).isValid).toBe(false);
      expect(requestValidator.validateExecuteRequest(undefined).isValid).toBe(false);

      // Non-objects
      expect(requestValidator.validateExecuteRequest('invalid').isValid).toBe(false);
      expect(requestValidator.validateExecuteRequest(123).isValid).toBe(false);

      // Invalid types - verify error structure
      const invalidRequest = { command: 123, background: 'not-boolean' };
      const result = requestValidator.validateExecuteRequest(invalidRequest);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      for (const error of result.errors) {
        expect(error).toHaveProperty('field');
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('code');
      }
    });
  });
});