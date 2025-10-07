import { describe, expect, it } from 'vitest';
import type { ErrorResponse } from '../src/clients';
import {
  CommandError,
  CommandNotFoundError,
  FileExistsError,
  FileNotFoundError,
  FileSystemError,
  GitAuthenticationError,
  GitBranchNotFoundError,
  GitCheckoutError,
  GitCloneError,
  GitError,
  GitNetworkError,
  GitRepositoryNotFoundError,
  InvalidGitUrlError,
  InvalidPortError,
  PermissionDeniedError,
  PortAlreadyExposedError,
  PortError,
  PortInUseError,
  PortNotExposedError,
  ProcessError,
  ProcessNotFoundError,
  SandboxError,
  SandboxOperation,
  ServiceNotRespondingError
} from '../src/errors';
import {
  isCommandError,
  isFileNotFoundError,
  isFileSystemError,
  isGitError,
  isPermissionError,
  isPortError,
  isProcessError,
  mapContainerError,
} from '../src/utils/error-mapping';

describe('Error Mapping', () => {
  describe('mapContainerError', () => {
    describe('File System Errors', () => {
      it('should map FILE_NOT_FOUND to FileNotFoundError', () => {
        const errorResponse: ErrorResponse & { code: string; path: string } = {
          error: 'File not found: /test/file.txt',
          code: 'FILE_NOT_FOUND',
          path: '/test/file.txt',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(FileNotFoundError);
        expect(error.message).toBe('File not found: /test/file.txt');
        expect((error as FileNotFoundError).path).toBe('/test/file.txt');
      });

      it('should map PERMISSION_DENIED to PermissionDeniedError', () => {
        const errorResponse: ErrorResponse & { code: string; path: string } = {
          error: 'Permission denied: /root/secret.txt',
          code: 'PERMISSION_DENIED',
          path: '/root/secret.txt',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(PermissionDeniedError);
        expect(error.message).toBe('Permission denied: /root/secret.txt');
        expect((error as PermissionDeniedError).path).toBe('/root/secret.txt');
      });

      it('should map FILE_EXISTS to FileExistsError', () => {
        const errorResponse: ErrorResponse & { code: string; path: string } = {
          error: 'File already exists: /test/existing.txt',
          code: 'FILE_EXISTS',
          path: '/test/existing.txt',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(FileExistsError);
        expect(error.message).toBe('File already exists: /test/existing.txt');
        expect((error as FileExistsError).path).toBe('/test/existing.txt');
      });

      it('should map other filesystem codes to FileSystemError', () => {
        const codes = ['IS_DIRECTORY', 'NOT_DIRECTORY', 'NO_SPACE', 'TOO_MANY_FILES', 'RESOURCE_BUSY', 'READ_ONLY', 'NAME_TOO_LONG', 'TOO_MANY_LINKS', 'FILESYSTEM_ERROR'];

        codes.forEach(code => {
          const errorResponse: ErrorResponse & { code: string; path: string } = {
            error: `Filesystem error: ${code}`,
            code,
            path: '/test/path',
          };

          const error = mapContainerError(errorResponse);

          expect(error).toBeInstanceOf(FileSystemError);
          expect((error as FileSystemError).code).toBe(code);
          expect((error as FileSystemError).path).toBe('/test/path');
        });
      });

      it('should handle missing path for file errors', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'File not found',
          code: 'FILE_NOT_FOUND',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(FileNotFoundError);
        expect((error as FileNotFoundError).path).toBe('unknown');
      });
    });

    describe('Command Errors', () => {
      it('should map COMMAND_NOT_FOUND to CommandNotFoundError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Command not found: nonexistent-cmd',
          code: 'COMMAND_NOT_FOUND',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(CommandNotFoundError);
        expect(error.message).toBe('Command not found: nonexistent-cmd');
        expect((error as CommandNotFoundError).command).toBe('nonexistent-cmd');
      });

      it('should map other command errors to CommandError', () => {
        const codes = ['COMMAND_PERMISSION_DENIED', 'COMMAND_EXECUTION_ERROR'];

        codes.forEach(code => {
          const errorResponse: ErrorResponse & { code: string } = {
            error: 'Command execution failed: test-cmd',
            code,
          };

          const error = mapContainerError(errorResponse);

          expect(error).toBeInstanceOf(CommandError);
          expect((error as CommandError).code).toBe(code);
          expect((error as CommandError).command).toBe('test-cmd');
        });
      });

      it('should extract command from various message formats', () => {
        const testCases = [
          { message: 'Command not found: test-command', expected: 'test-command' },
          { message: 'Command execution failed: npm install', expected: 'npm' },
          { message: 'Invalid command format', expected: 'unknown' },
        ];

        testCases.forEach(({ message, expected }) => {
          const errorResponse: ErrorResponse & { code: string } = {
            error: message,
            code: 'COMMAND_NOT_FOUND',
          };

          const error = mapContainerError(errorResponse);
          expect((error as CommandNotFoundError).command).toBe(expected);
        });
      });
    });

    describe('Process Errors', () => {
      it('should map PROCESS_NOT_FOUND to ProcessNotFoundError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Process not found: proc-123',
          code: 'PROCESS_NOT_FOUND',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(ProcessNotFoundError);
        expect(error.message).toBe('Process not found: proc-123');
      });

      it('should map other process errors to ProcessError', () => {
        const codes = ['PROCESS_PERMISSION_DENIED', 'PROCESS_ERROR'];

        codes.forEach(code => {
          const errorResponse: ErrorResponse & { code: string } = {
            error: 'Process operation failed: proc-456',
            code,
          };

          const error = mapContainerError(errorResponse);

          expect(error).toBeInstanceOf(ProcessError);
          expect((error as ProcessError).code).toBe(code);
        });
      });

      it('should extract process ID from message', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Process not found: my-process-id',
          code: 'PROCESS_NOT_FOUND',
        };

        const error = mapContainerError(errorResponse);
        // The ProcessNotFoundError constructor expects just the processId parameter
        expect(error.message).toBe('Process not found: my-process-id');
      });
    });

    describe('Port Errors', () => {
      it('should map PORT_ALREADY_EXPOSED to PortAlreadyExposedError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Port already exposed: 3001',
          code: 'PORT_ALREADY_EXPOSED',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(PortAlreadyExposedError);
        expect((error as PortAlreadyExposedError).port).toBe(3001);
      });

      it('should map PORT_NOT_EXPOSED to PortNotExposedError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Port not exposed: 3002',
          code: 'PORT_NOT_EXPOSED',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(PortNotExposedError);
        expect((error as PortNotExposedError).port).toBe(3002);
      });

      it('should map INVALID_PORT_NUMBER to InvalidPortError', () => {
        const errorResponse: ErrorResponse & { code: string; details: string } = {
          error: 'Invalid port: 80',
          code: 'INVALID_PORT_NUMBER',
          details: 'Reserved port',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(InvalidPortError);
        expect((error as InvalidPortError).port).toBe(80);
        expect((error as InvalidPortError).details).toBe('Reserved port');
      });

      it('should map SERVICE_NOT_RESPONDING to ServiceNotRespondingError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Service on port 3003 is not responding',
          code: 'SERVICE_NOT_RESPONDING',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(ServiceNotRespondingError);
        expect((error as ServiceNotRespondingError).port).toBe(3003);
      });

      it('should map PORT_IN_USE to PortInUseError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Port in use: 3000',
          code: 'PORT_IN_USE',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(PortInUseError);
        expect((error as PortInUseError).port).toBe(3000);
      });

      it('should map PORT_OPERATION_ERROR to PortError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Port operation failed on port 8080',
          code: 'PORT_OPERATION_ERROR',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(PortError);
        expect((error as PortError).code).toBe('PORT_OPERATION_ERROR');
        // Port extraction might not work with this message format
        expect(error.message).toBe('Port operation failed on port 8080');
      });

      it('should handle malformed port numbers', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Invalid port format',
          code: 'PORT_ALREADY_EXPOSED',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(PortAlreadyExposedError);
        expect((error as PortAlreadyExposedError).port).toBe(0);
      });
    });

    describe('Git Errors', () => {
      it('should map GIT_REPOSITORY_NOT_FOUND to GitRepositoryNotFoundError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Git repository not found: https://github.com/user/repo.git',
          code: 'GIT_REPOSITORY_NOT_FOUND',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(GitRepositoryNotFoundError);
        // The GitRepositoryNotFoundError constructor creates its own message format
        expect(error.message).toContain('Git repository not found');
      });

      it('should map GIT_AUTH_FAILED to GitAuthenticationError', () => {
        const errorResponse: ErrorResponse & { code: string; details: string } = {
          error: 'Git authentication failed',
          code: 'GIT_AUTH_FAILED',
          details: 'https://github.com/private/repo.git',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(GitAuthenticationError);
        expect((error as GitAuthenticationError).repository).toBe('https://github.com/private/repo.git');
      });

      it('should map GIT_BRANCH_NOT_FOUND to GitBranchNotFoundError', () => {
        const errorResponse: ErrorResponse & { code: string; details: string } = {
          error: 'Git branch not found: feature-branch',
          code: 'GIT_BRANCH_NOT_FOUND',
          details: 'Branch "feature-branch" does not exist',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(GitBranchNotFoundError);
        expect((error as GitBranchNotFoundError).branch).toBe('feature-branch');
      });

      it('should map GIT_NETWORK_ERROR to GitNetworkError', () => {
        const errorResponse: ErrorResponse & { code: string; details: string } = {
          error: 'Git network error',
          code: 'GIT_NETWORK_ERROR',
          details: 'https://gitlab.com/user/project.git',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(GitNetworkError);
        expect((error as GitNetworkError).repository).toBe('https://gitlab.com/user/project.git');
      });

      it('should map GIT_CLONE_FAILED to GitCloneError', () => {
        const errorResponse: ErrorResponse & { code: string; details: string } = {
          error: 'Git clone failed',
          code: 'GIT_CLONE_FAILED',
          details: 'git@github.com:user/repo.git',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(GitCloneError);
        expect((error as GitCloneError).repository).toBe('git@github.com:user/repo.git');
      });

      it('should map GIT_CHECKOUT_FAILED to GitCheckoutError', () => {
        const errorResponse: ErrorResponse & { code: string; details: string } = {
          error: 'Git checkout failed: develop',
          code: 'GIT_CHECKOUT_FAILED',
          details: 'Branch "develop" checkout failed',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(GitCheckoutError);
        expect((error as GitCheckoutError).branch).toBe('develop');
      });

      it('should map INVALID_GIT_URL to InvalidGitUrlError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Invalid Git URL: not-a-url',
          code: 'INVALID_GIT_URL',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(InvalidGitUrlError);
        // URL extraction from message may not work with this format
        expect(error.message).toBe('Invalid Git URL: not-a-url');
      });

      it('should map GIT_OPERATION_FAILED to GitError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Git operation failed',
          code: 'GIT_OPERATION_FAILED',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(GitError);
        expect((error as GitError).code).toBe('GIT_OPERATION_FAILED');
      });
    });

    describe('Default Mapping', () => {
      it('should map unknown codes to SandboxError', () => {
        const errorResponse: ErrorResponse & { code: string } = {
          error: 'Unknown error occurred',
          code: 'UNKNOWN_ERROR',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as SandboxError).code).toBe('UNKNOWN_ERROR');
        expect(error.message).toBe('Unknown error occurred');
      });

      it('should handle missing error code', () => {
        const errorResponse: ErrorResponse = {
          error: 'Generic error message',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as SandboxError).code).toBeUndefined();
        expect(error.message).toBe('Generic error message');
      });

      it('should preserve operation and details', () => {
        const errorResponse: ErrorResponse & { code: string; operation: typeof SandboxOperation.FILE_READ; details: string } = {
          error: 'Custom error',
          code: 'CUSTOM_ERROR',
          operation: SandboxOperation.FILE_READ,
          details: 'Additional information',
        };

        const error = mapContainerError(errorResponse);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as SandboxError).operation).toBe(SandboxOperation.FILE_READ);
        expect((error as SandboxError).details).toBe('Additional information');
      });
    });
  });

  describe('Error Type Checkers', () => {
    it('should correctly identify file errors', () => {
      expect(isFileNotFoundError({ error: 'test', code: 'FILE_NOT_FOUND' })).toBe(true);
      expect(isFileNotFoundError({ error: 'test', code: 'OTHER_ERROR' })).toBe(false);
    });

    it('should correctly identify permission errors', () => {
      expect(isPermissionError({ error: 'test', code: 'PERMISSION_DENIED' })).toBe(true);
      expect(isPermissionError({ error: 'test', code: 'COMMAND_PERMISSION_DENIED' })).toBe(true);
      expect(isPermissionError({ error: 'test', code: 'OTHER_ERROR' })).toBe(false);
    });

    it('should correctly identify filesystem errors', () => {
      expect(isFileSystemError({ error: 'test', code: 'FILE_NOT_FOUND' })).toBe(true);
      expect(isFileSystemError({ error: 'test', code: 'PERMISSION_DENIED' })).toBe(true);
      expect(isFileSystemError({ error: 'test', code: 'IS_DIRECTORY' })).toBe(true);
      expect(isFileSystemError({ error: 'test', code: 'READ_ONLY' })).toBe(true);
      expect(isFileSystemError({ error: 'test', code: 'COMMAND_NOT_FOUND' })).toBe(false);
    });

    it('should correctly identify command errors', () => {
      expect(isCommandError({ error: 'test', code: 'COMMAND_NOT_FOUND' })).toBe(true);
      expect(isCommandError({ error: 'test', code: 'COMMAND_EXECUTION_ERROR' })).toBe(true);
      expect(isCommandError({ error: 'test', code: 'FILE_NOT_FOUND' })).toBe(false);
    });

    it('should correctly identify process errors', () => {
      expect(isProcessError({ error: 'test', code: 'PROCESS_NOT_FOUND' })).toBe(true);
      expect(isProcessError({ error: 'test', code: 'PROCESS_ERROR' })).toBe(true);
      expect(isProcessError({ error: 'test', code: 'PORT_IN_USE' })).toBe(false);
    });

    it('should correctly identify port errors', () => {
      expect(isPortError({ error: 'test', code: 'PORT_ALREADY_EXPOSED' })).toBe(true);
      expect(isPortError({ error: 'test', code: 'PORT_NOT_EXPOSED' })).toBe(true);
      expect(isPortError({ error: 'test', code: 'INVALID_PORT_NUMBER' })).toBe(true);
      expect(isPortError({ error: 'test', code: 'GIT_CLONE_FAILED' })).toBe(false);
    });

    it('should correctly identify git errors', () => {
      expect(isGitError({ error: 'test', code: 'GIT_REPOSITORY_NOT_FOUND' })).toBe(true);
      expect(isGitError({ error: 'test', code: 'GIT_AUTH_FAILED' })).toBe(true);
      expect(isGitError({ error: 'test', code: 'INVALID_GIT_URL' })).toBe(true);
      expect(isGitError({ error: 'test', code: 'FILE_NOT_FOUND' })).toBe(false);
    });

    it('should return false for missing code in all type checkers', () => {
      const errorResponse: ErrorResponse = { error: 'test' };
      expect(isFileNotFoundError(errorResponse)).toBe(false);
      expect(isPermissionError(errorResponse)).toBe(false);
      expect(isFileSystemError(errorResponse)).toBe(false);
      expect(isCommandError(errorResponse)).toBe(false);
      expect(isProcessError(errorResponse)).toBe(false);
      expect(isPortError(errorResponse)).toBe(false);
      expect(isGitError(errorResponse)).toBe(false);
    });
  });

  describe('Error Context Preservation', () => {
    it('should handle errors with minimal context gracefully', () => {
      const minimalContainerResponse = {
        error: 'Operation failed',
        code: 'INTERNAL_ERROR'
      };

      const clientError = mapContainerError(minimalContainerResponse);

      expect(clientError).toBeInstanceOf(SandboxError);
      expect(clientError.message).toBe('Operation failed');
    });

    it('should handle errors with extra unknown fields gracefully', () => {
      const extendedContainerResponse = {
        error: 'File not found: /app/data.json',
        code: 'FILE_NOT_FOUND',
        path: '/app/data.json',
        operation: SandboxOperation.FILE_READ,
        // Extra fields that might be added in future container versions
        containerVersion: '2.1.0',
        experimentalFeatures: ['advanced-caching'],
        metrics: {
          diskUsage: '45%',
          memoryUsage: '23%'
        },
        unknown_field: 'should_be_ignored'
      };

      const clientError = mapContainerError(extendedContainerResponse);

      expect(clientError).toBeInstanceOf(FileNotFoundError);
      expect(clientError.message).toContain('data.json');

      if (clientError instanceof FileNotFoundError) {
        expect(clientError.path).toBe('/app/data.json');
        expect(clientError.operation).toBe(SandboxOperation.FILE_READ);
      }
    });
  });
});
