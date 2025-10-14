import type {
  FileNotFoundContext,
  FileSystemContext,
  ValidationFailedContext,
} from '@repo/shared/errors';
import { ErrorCode, Operation } from '@repo/shared/errors';
import type {
  FileStats,
  Logger,
  MkdirOptions,
  ReadOptions,
  ServiceResult,
  WriteOptions
} from '../core/types';
import { FileManager } from '../managers/file-manager';
import type { SessionManager } from './session-manager';

export interface SecurityService {
  validatePath(path: string): { isValid: boolean; errors: string[] };
}

// File system operations interface with session support
export interface FileSystemOperations {
  read(path: string, options?: ReadOptions, sessionId?: string): Promise<ServiceResult<string>>;
  write(path: string, content: string, options?: WriteOptions, sessionId?: string): Promise<ServiceResult<void>>;
  delete(path: string, sessionId?: string): Promise<ServiceResult<void>>;
  rename(oldPath: string, newPath: string, sessionId?: string): Promise<ServiceResult<void>>;
  move(sourcePath: string, destinationPath: string, sessionId?: string): Promise<ServiceResult<void>>;
  mkdir(path: string, options?: MkdirOptions, sessionId?: string): Promise<ServiceResult<void>>;
  exists(path: string, sessionId?: string): Promise<ServiceResult<boolean>>;
  stat(path: string, sessionId?: string): Promise<ServiceResult<FileStats>>;
}

export class FileService implements FileSystemOperations {
  private manager: FileManager;

  constructor(
    private security: SecurityService,
    private logger: Logger,
    private sessionManager: SessionManager
  ) {
    this.manager = new FileManager();
  }

  /**
   * Escape path for safe shell usage
   * Uses single quotes to prevent variable expansion and command substitution
   */
  private escapePath(path: string): string {
    // Single quotes prevent all expansion ($VAR, `cmd`, etc.)
    // To include a literal single quote, we end the quoted string, add an escaped quote, and start a new quoted string
    // Example: path="it's" becomes 'it'\''s'
    return `'${path.replace(/'/g, "'\\''")}'`;
  }

  async read(path: string, options: ReadOptions = {}, sessionId = 'default'): Promise<ServiceResult<string>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Invalid path format for '${path}': ${validation.errors.join(', ')}`,
            code: ErrorCode.VALIDATION_FAILED,
            details: {
              validationErrors: validation.errors.map(e => ({ field: 'path', message: e, code: 'INVALID_PATH' }))
            } satisfies ValidationFailedContext
          }
        };
      }

      this.logger.info('Reading file', { path, encoding: options.encoding });

      // 2. Check if file exists using session-aware check
      const existsResult = await this.exists(path, sessionId);
      if (!existsResult.success) {
        return existsResult as ServiceResult<string>;
      }

      if (!existsResult.data) {
        return {
          success: false,
          error: {
            message: `File not found: ${path}`,
            code: ErrorCode.FILE_NOT_FOUND,
            details: {
              path,
              operation: Operation.FILE_READ
            } satisfies FileNotFoundContext
          }
        };
      }

      // 3. Read file content using SessionManager with base64 encoding
      // Base64 ensures binary files (images, PDFs, etc.) are read correctly
      const escapedPath = this.escapePath(path);
      const command = `base64 < ${escapedPath}`;

      const execResult = await this.sessionManager.executeInSession(sessionId, command);

      if (!execResult.success) {
        return execResult as ServiceResult<string>;
      }

      const result = execResult.data;

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `Failed to read file '${path}': ${result.stderr || `exit code ${result.exitCode}`}`,
            code: ErrorCode.FILESYSTEM_ERROR,
            details: {
              path,
              operation: Operation.FILE_READ,
              exitCode: result.exitCode,
              stderr: result.stderr
            } satisfies FileSystemContext
          }
        };
      }

      // Decode base64 to get original content
      const base64Content = result.stdout.trim();
      const content = Buffer.from(base64Content, 'base64').toString('utf-8');

      this.logger.info('File read successfully', {
        path,
        sizeBytes: content.length
      });

      return {
        success: true,
        data: content
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to read file', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: `Failed to read file '${path}': ${errorMessage}`,
          code: ErrorCode.FILESYSTEM_ERROR,
          details: {
            path,
            operation: Operation.FILE_READ,
            stderr: errorMessage
          } satisfies FileSystemContext
        }
      };
    }
  }

  async write(path: string, content: string, options: WriteOptions = {}, sessionId = 'default'): Promise<ServiceResult<void>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Invalid path format for '${path}': ${validation.errors.join(', ')}`,
            code: ErrorCode.VALIDATION_FAILED,
            details: {
              validationErrors: validation.errors.map(e => ({ field: 'path', message: e, code: 'INVALID_PATH' }))
            } satisfies ValidationFailedContext
          }
        };
      }

      this.logger.info('Writing file', {
        path,
        sizeBytes: content.length,
        encoding: options.encoding
      });

      // 2. Write file using SessionManager with base64 encoding
      // Base64 ensures binary files (images, PDFs, etc.) are written correctly
      // and avoids heredoc EOF collision issues
      const escapedPath = this.escapePath(path);
      const base64Content = Buffer.from(content, 'utf-8').toString('base64');
      const command = `echo '${base64Content}' | base64 -d > ${escapedPath}`;

      const execResult = await this.sessionManager.executeInSession(sessionId, command);

      if (!execResult.success) {
        return execResult as ServiceResult<void>;
      }

      const result = execResult.data;

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `Failed to write file '${path}': ${result.stderr || `exit code ${result.exitCode}`}`,
            code: ErrorCode.FILESYSTEM_ERROR,
            details: {
              path,
              operation: Operation.FILE_WRITE,
              exitCode: result.exitCode,
              stderr: result.stderr
            } satisfies FileSystemContext
          }
        };
      }

      this.logger.info('File written successfully', {
        path,
        sizeBytes: content.length
      });

      return {
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to write file', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: `Failed to write file '${path}': ${errorMessage}`,
          code: ErrorCode.FILESYSTEM_ERROR,
          details: {
            path,
            operation: Operation.FILE_WRITE,
            stderr: errorMessage
          } satisfies FileSystemContext
        }
      };
    }
  }

  async delete(path: string, sessionId = 'default'): Promise<ServiceResult<void>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Invalid path format for '${path}': ${validation.errors.join(', ')}`,
            code: ErrorCode.VALIDATION_FAILED,
            details: {
              validationErrors: validation.errors.map(e => ({ field: 'path', message: e, code: 'INVALID_PATH' }))
            } satisfies ValidationFailedContext
          }
        };
      }

      this.logger.info('Deleting file', { path });

      // 2. Check if file exists using session-aware check
      const existsResult = await this.exists(path, sessionId);
      if (!existsResult.success) {
        return existsResult as ServiceResult<void>;
      }

      if (!existsResult.data) {
        return {
          success: false,
          error: {
            message: `File not found: ${path}`,
            code: ErrorCode.FILE_NOT_FOUND,
            details: {
              path,
              operation: Operation.FILE_DELETE
            } satisfies FileNotFoundContext
          }
        };
      }

      // 3. Check if path is a directory (deleteFile only works on files)
      const statResult = await this.stat(path, sessionId);
      if (statResult.success && statResult.data.isDirectory) {
        return {
          success: false,
          error: {
            message: `Cannot delete directory with deleteFile() at '${path}'. Use exec('rm -rf <path>') instead.`,
            code: ErrorCode.IS_DIRECTORY,
            details: {
              path,
              operation: Operation.FILE_DELETE
            } satisfies FileSystemContext
          }
        };
      }

      // 4. Delete file using SessionManager with rm command
      const escapedPath = this.escapePath(path);
      const command = `rm ${escapedPath}`;

      const execResult = await this.sessionManager.executeInSession(sessionId, command);

      if (!execResult.success) {
        return execResult as ServiceResult<void>;
      }

      const result = execResult.data;

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `Failed to delete file '${path}': ${result.stderr || `exit code ${result.exitCode}`}`,
            code: ErrorCode.FILESYSTEM_ERROR,
            details: {
              path,
              operation: Operation.FILE_DELETE,
              exitCode: result.exitCode,
              stderr: result.stderr
            } satisfies FileSystemContext
          }
        };
      }

      this.logger.info('File deleted successfully', { path });

      return {
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to delete file', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: `Failed to delete file '${path}': ${errorMessage}`,
          code: ErrorCode.FILESYSTEM_ERROR,
          details: {
            path,
            operation: Operation.FILE_DELETE,
            stderr: errorMessage
          } satisfies FileSystemContext
        }
      };
    }
  }

  async rename(oldPath: string, newPath: string, sessionId = 'default'): Promise<ServiceResult<void>> {
    try {
      // 1. Validate both paths for security
      const oldValidation = this.security.validatePath(oldPath);
      const newValidation = this.security.validatePath(newPath);

      if (!oldValidation.isValid || !newValidation.isValid) {
        const errors = [...oldValidation.errors, ...newValidation.errors];
        return {
          success: false,
          error: {
            message: `Security validation failed: ${errors.join(', ')}`,
            code: 'SECURITY_VALIDATION_FAILED',
            details: { oldPath, newPath, errors }
          }
        };
      }

      this.logger.info('Renaming file', { oldPath, newPath });

      // 2. Check if source file exists using session-aware check
      const existsResult = await this.exists(oldPath, sessionId);
      if (!existsResult.success) {
        return existsResult as ServiceResult<void>;
      }

      if (!existsResult.data) {
        return {
          success: false,
          error: {
            message: `Source file not found: ${oldPath}`,
            code: ErrorCode.FILE_NOT_FOUND,
            details: {
              path: oldPath,
              operation: Operation.FILE_RENAME
            } satisfies FileNotFoundContext
          }
        };
      }

      // 3. Rename file using SessionManager with mv command
      const escapedOldPath = this.escapePath(oldPath);
      const escapedNewPath = this.escapePath(newPath);
      const command = `mv ${escapedOldPath} ${escapedNewPath}`;

      const execResult = await this.sessionManager.executeInSession(sessionId, command);

      if (!execResult.success) {
        return execResult as ServiceResult<void>;
      }

      const result = execResult.data;

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `Rename operation failed with exit code ${result.exitCode}`,
            code: ErrorCode.FILESYSTEM_ERROR,
            details: { oldPath, newPath, exitCode: result.exitCode, stderr: result.stderr }
          }
        };
      }

      this.logger.info('File renamed successfully', { oldPath, newPath });

      return {
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to rename file', error instanceof Error ? error : undefined, { oldPath, newPath });

      return {
        success: false,
        error: {
          message: `Failed to rename file from '${oldPath}' to '${newPath}': ${errorMessage}`,
          code: ErrorCode.FILESYSTEM_ERROR,
          details: {
            path: oldPath,
            operation: Operation.FILE_RENAME,
            stderr: errorMessage
          } satisfies FileSystemContext
        }
      };
    }
  }

  async move(sourcePath: string, destinationPath: string, sessionId = 'default'): Promise<ServiceResult<void>> {
    try {
      // 1. Validate both paths for security
      const sourceValidation = this.security.validatePath(sourcePath);
      const destValidation = this.security.validatePath(destinationPath);

      if (!sourceValidation.isValid || !destValidation.isValid) {
        const errors = [...sourceValidation.errors, ...destValidation.errors];
        return {
          success: false,
          error: {
            message: `Security validation failed: ${errors.join(', ')}`,
            code: 'SECURITY_VALIDATION_FAILED',
            details: { sourcePath, destinationPath, errors }
          }
        };
      }

      this.logger.info('Moving file', { sourcePath, destinationPath });

      // 2. Check if source exists using session-aware check
      const existsResult = await this.exists(sourcePath, sessionId);
      if (!existsResult.success) {
        return existsResult as ServiceResult<void>;
      }

      if (!existsResult.data) {
        return {
          success: false,
          error: {
            message: `Source file not found: ${sourcePath}`,
            code: ErrorCode.FILE_NOT_FOUND,
            details: {
              path: sourcePath,
              operation: Operation.FILE_MOVE
            } satisfies FileNotFoundContext
          }
        };
      }

      // 3. Move file using SessionManager with mv command
      // mv is atomic on same filesystem, automatically handles cross-filesystem moves
      const escapedSource = this.escapePath(sourcePath);
      const escapedDest = this.escapePath(destinationPath);
      const command = `mv ${escapedSource} ${escapedDest}`;

      const execResult = await this.sessionManager.executeInSession(sessionId, command);

      if (!execResult.success) {
        return execResult as ServiceResult<void>;
      }

      const result = execResult.data;

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `Move operation failed with exit code ${result.exitCode}`,
            code: ErrorCode.FILESYSTEM_ERROR,
            details: { sourcePath, destinationPath, exitCode: result.exitCode, stderr: result.stderr }
          }
        };
      }

      this.logger.info('File moved successfully', { sourcePath, destinationPath });

      return {
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to move file', error instanceof Error ? error : undefined, { sourcePath, destinationPath });

      return {
        success: false,
        error: {
          message: `Failed to move file from '${sourcePath}' to '${destinationPath}': ${errorMessage}`,
          code: ErrorCode.FILESYSTEM_ERROR,
          details: {
            path: sourcePath,
            operation: Operation.FILE_MOVE,
            stderr: errorMessage
          } satisfies FileSystemContext
        }
      };
    }
  }

  async mkdir(path: string, options: MkdirOptions = {}, sessionId = 'default'): Promise<ServiceResult<void>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Invalid path format for '${path}': ${validation.errors.join(', ')}`,
            code: ErrorCode.VALIDATION_FAILED,
            details: {
              validationErrors: validation.errors.map(e => ({ field: 'path', message: e, code: 'INVALID_PATH' }))
            } satisfies ValidationFailedContext
          }
        };
      }

      this.logger.info('Creating directory', { path, recursive: options.recursive });

      // 2. Build mkdir command args (via manager)
      const args = this.manager.buildMkdirArgs(path, options);

      // 3. Build command string from args (skip 'mkdir' at index 0)
      const escapedPath = this.escapePath(path);
      let command = 'mkdir';
      if (options.recursive) {
        command += ' -p';
      }
      command += ` ${escapedPath}`;

      // 4. Create directory using SessionManager
      const execResult = await this.sessionManager.executeInSession(sessionId, command);

      if (!execResult.success) {
        return execResult as ServiceResult<void>;
      }

      const result = execResult.data;

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `mkdir operation failed with exit code ${result.exitCode}`,
            code: ErrorCode.FILESYSTEM_ERROR,
            details: { path, options, exitCode: result.exitCode, stderr: result.stderr }
          }
        };
      }

      this.logger.info('Directory created successfully', { path });

      return {
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to create directory', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: `Failed to create directory '${path}': ${errorMessage}`,
          code: ErrorCode.FILESYSTEM_ERROR,
          details: {
            path,
            operation: Operation.DIRECTORY_CREATE,
            stderr: errorMessage
          } satisfies FileSystemContext
        }
      };
    }
  }

  async exists(path: string, sessionId = 'default'): Promise<ServiceResult<boolean>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Invalid path format for '${path}': ${validation.errors.join(', ')}`,
            code: ErrorCode.VALIDATION_FAILED,
            details: {
              validationErrors: validation.errors.map(e => ({ field: 'path', message: e, code: 'INVALID_PATH' }))
            } satisfies ValidationFailedContext
          }
        };
      }

      // 2. Check if file/directory exists using SessionManager
      const escapedPath = this.escapePath(path);
      const command = `test -e ${escapedPath}`;

      const execResult = await this.sessionManager.executeInSession(sessionId, command);

      if (!execResult.success) {
        // If execution fails, treat as non-existent
        return {
          success: true,
          data: false
        };
      }

      // Exit code 0 means file exists, non-zero means it doesn't
      const exists = execResult.data.exitCode === 0;

      return {
        success: true,
        data: exists
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn('Error checking file existence', { path, error: errorMessage });

      return {
        success: false,
        error: {
          message: `Failed to check file existence for '${path}': ${errorMessage}`,
          code: ErrorCode.FILESYSTEM_ERROR,
          details: {
            path,
            operation: Operation.FILE_STAT,
            stderr: errorMessage
          } satisfies FileSystemContext
        }
      };
    }
  }

  async stat(path: string, sessionId = 'default'): Promise<ServiceResult<FileStats>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Invalid path format for '${path}': ${validation.errors.join(', ')}`,
            code: ErrorCode.VALIDATION_FAILED,
            details: {
              validationErrors: validation.errors.map(e => ({ field: 'path', message: e, code: 'INVALID_PATH' }))
            } satisfies ValidationFailedContext
          }
        };
      }

      // 2. Check if file exists using session-aware check
      const existsResult = await this.exists(path, sessionId);
      if (!existsResult.success) {
        return existsResult as ServiceResult<FileStats>;
      }

      if (!existsResult.data) {
        return {
          success: false,
          error: {
            message: `Path not found: ${path}`,
            code: ErrorCode.FILE_NOT_FOUND,
            details: {
              path,
              operation: Operation.FILE_STAT
            } satisfies FileNotFoundContext
          }
        };
      }

      // 3. Build stat command args (via manager)
      const statCmd = this.manager.buildStatArgs(path);

      // 4. Build command string (stat with format argument)
      const escapedPath = this.escapePath(path);
      const command = `stat ${statCmd.args[0]} ${statCmd.args[1]} ${escapedPath}`;

      // 5. Get file stats using SessionManager
      const execResult = await this.sessionManager.executeInSession(sessionId, command);

      if (!execResult.success) {
        return execResult as ServiceResult<FileStats>;
      }

      const result = execResult.data;

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `stat operation failed with exit code ${result.exitCode}`,
            code: ErrorCode.FILESYSTEM_ERROR,
            details: { path, exitCode: result.exitCode, stderr: result.stderr }
          }
        };
      }

      // 6. Parse stat output (via manager)
      const stats = this.manager.parseStatOutput(result.stdout);

      // 7. Validate stats (via manager)
      const statsValidation = this.manager.validateStats(stats);
      if (!statsValidation.valid) {
        this.logger.warn('Stats validation warnings', { path, errors: statsValidation.errors });
      }

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to get file stats', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: `Failed to get file stats for '${path}': ${errorMessage}`,
          code: ErrorCode.FILESYSTEM_ERROR,
          details: {
            path,
            operation: Operation.FILE_STAT,
            stderr: errorMessage
          } satisfies FileSystemContext
        }
      };
    }
  }

  // Convenience methods with ServiceResult wrapper for higher-level operations

  async readFile(path: string, options?: ReadOptions, sessionId?: string): Promise<ServiceResult<string>> {
    return await this.read(path, options, sessionId);
  }

  async writeFile(path: string, content: string, options?: WriteOptions, sessionId?: string): Promise<ServiceResult<void>> {
    return await this.write(path, content, options, sessionId);
  }

  async deleteFile(path: string, sessionId?: string): Promise<ServiceResult<void>> {
    return await this.delete(path, sessionId);
  }

  async renameFile(oldPath: string, newPath: string, sessionId?: string): Promise<ServiceResult<void>> {
    return await this.rename(oldPath, newPath, sessionId);
  }

  async moveFile(sourcePath: string, destinationPath: string, sessionId?: string): Promise<ServiceResult<void>> {
    return await this.move(sourcePath, destinationPath, sessionId);
  }

  async createDirectory(path: string, options?: MkdirOptions, sessionId?: string): Promise<ServiceResult<void>> {
    return await this.mkdir(path, options, sessionId);
  }

  async getFileStats(path: string, sessionId?: string): Promise<ServiceResult<FileStats>> {
    return await this.stat(path, sessionId);
  }
}