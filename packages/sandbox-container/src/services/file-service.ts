// Bun-optimized File System Service
import type {
  FileStats,
  Logger,
  MkdirOptions,
  ReadOptions,
  ServiceResult,
  WriteOptions
} from '../core/types';
import { FileManager } from '../managers/file-manager';
import { BunFileAdapter } from '../adapters/bun-file-adapter';

export interface SecurityService {
  validatePath(path: string): { isValid: boolean; errors: string[] };
  sanitizePath(path: string): string;
}

// File system operations interface
export interface FileSystemOperations {
  read(path: string, options?: ReadOptions): Promise<ServiceResult<string>>;
  write(path: string, content: string, options?: WriteOptions): Promise<ServiceResult<void>>;
  delete(path: string): Promise<ServiceResult<void>>;
  rename(oldPath: string, newPath: string): Promise<ServiceResult<void>>;
  move(sourcePath: string, destinationPath: string): Promise<ServiceResult<void>>;
  mkdir(path: string, options?: MkdirOptions): Promise<ServiceResult<void>>;
  exists(path: string): Promise<ServiceResult<boolean>>;
  stat(path: string): Promise<ServiceResult<FileStats>>;
}

export class FileService implements FileSystemOperations {
  private manager: FileManager;
  private adapter: BunFileAdapter;

  constructor(
    private security: SecurityService,
    private logger: Logger,
    adapter?: BunFileAdapter  // Injectable for testing
  ) {
    this.manager = new FileManager();
    this.adapter = adapter || new BunFileAdapter();
  }

  async read(path: string, options: ReadOptions = {}): Promise<ServiceResult<string>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Security validation failed: ${validation.errors.join(', ')}`,
            code: 'SECURITY_VALIDATION_FAILED',
            details: { path, errors: validation.errors }
          }
        };
      }

      this.logger.info('Reading file', { path, encoding: options.encoding });

      // 2. Check if file exists (via adapter)
      const exists = await this.adapter.exists(path);
      if (!exists) {
        return {
          success: false,
          error: {
            message: `File not found: ${path}`,
            code: 'FILE_NOT_FOUND',
            details: { path }
          }
        };
      }

      // 3. Read file content (via adapter)
      const result = await this.adapter.read(path);

      this.logger.info('File read successfully', {
        path,
        sizeBytes: result.size
      });

      return {
        success: true,
        data: result.content
      };
    } catch (error) {
      const errorCode = this.manager.determineErrorCode('read', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to read file', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: this.manager.createErrorMessage('read', path, errorMessage),
          code: errorCode,
          details: { path, originalError: errorMessage }
        }
      };
    }
  }

  async write(path: string, content: string, options: WriteOptions = {}): Promise<ServiceResult<void>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Security validation failed: ${validation.errors.join(', ')}`,
            code: 'SECURITY_VALIDATION_FAILED',
            details: { path, errors: validation.errors }
          }
        };
      }

      this.logger.info('Writing file', {
        path,
        sizeBytes: content.length,
        encoding: options.encoding
      });

      // 2. Write file (via adapter)
      await this.adapter.write(path, content);

      this.logger.info('File written successfully', {
        path,
        sizeBytes: content.length
      });

      return {
        success: true
      };
    } catch (error) {
      const errorCode = this.manager.determineErrorCode('write', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to write file', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: this.manager.createErrorMessage('write', path, errorMessage),
          code: errorCode,
          details: { path, originalError: errorMessage }
        }
      };
    }
  }

  async delete(path: string): Promise<ServiceResult<void>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Security validation failed: ${validation.errors.join(', ')}`,
            code: 'SECURITY_VALIDATION_FAILED',
            details: { path, errors: validation.errors }
          }
        };
      }

      this.logger.info('Deleting file', { path });

      // 2. Check if file exists (via adapter)
      const exists = await this.adapter.exists(path);
      if (!exists) {
        return {
          success: false,
          error: {
            message: `File not found: ${path}`,
            code: 'FILE_NOT_FOUND',
            details: { path }
          }
        };
      }

      // 3. Delete file (via adapter)
      const result = await this.adapter.deleteFile(path);

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `Delete operation failed with exit code ${result.exitCode}`,
            code: 'FILE_DELETE_ERROR',
            details: { path, exitCode: result.exitCode, stderr: result.stderr }
          }
        };
      }

      this.logger.info('File deleted successfully', { path });

      return {
        success: true
      };
    } catch (error) {
      const errorCode = this.manager.determineErrorCode('delete', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to delete file', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: this.manager.createErrorMessage('delete', path, errorMessage),
          code: errorCode,
          details: { path, originalError: errorMessage }
        }
      };
    }
  }

  async rename(oldPath: string, newPath: string): Promise<ServiceResult<void>> {
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

      // 2. Check if source file exists (via adapter)
      const exists = await this.adapter.exists(oldPath);
      if (!exists) {
        return {
          success: false,
          error: {
            message: `Source file not found: ${oldPath}`,
            code: 'FILE_NOT_FOUND',
            details: { oldPath, newPath }
          }
        };
      }

      // 3. Rename file (via adapter)
      const result = await this.adapter.renameFile(oldPath, newPath);

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `Rename operation failed with exit code ${result.exitCode}`,
            code: 'RENAME_ERROR',
            details: { oldPath, newPath, exitCode: result.exitCode, stderr: result.stderr }
          }
        };
      }

      this.logger.info('File renamed successfully', { oldPath, newPath });

      return {
        success: true
      };
    } catch (error) {
      const errorCode = this.manager.determineErrorCode('rename', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to rename file', error instanceof Error ? error : undefined, { oldPath, newPath });

      return {
        success: false,
        error: {
          message: this.manager.createErrorMessage('rename', oldPath, errorMessage),
          code: errorCode,
          details: { oldPath, newPath, originalError: errorMessage }
        }
      };
    }
  }

  async move(sourcePath: string, destinationPath: string): Promise<ServiceResult<void>> {
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

      // 2. Check if source exists (via adapter)
      const exists = await this.adapter.exists(sourcePath);
      if (!exists) {
        return {
          success: false,
          error: {
            message: `Source file not found: ${sourcePath}`,
            code: 'FILE_NOT_FOUND',
            details: { sourcePath, destinationPath }
          }
        };
      }

      // 3. Move file using zero-copy operations (via adapter)
      await this.adapter.move(sourcePath, destinationPath);

      this.logger.info('File moved successfully', { sourcePath, destinationPath });

      return {
        success: true
      };
    } catch (error) {
      const errorCode = this.manager.determineErrorCode('move', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to move file', error instanceof Error ? error : undefined, { sourcePath, destinationPath });

      return {
        success: false,
        error: {
          message: this.manager.createErrorMessage('move', sourcePath, errorMessage),
          code: errorCode,
          details: { sourcePath, destinationPath, originalError: errorMessage }
        }
      };
    }
  }

  async mkdir(path: string, options: MkdirOptions = {}): Promise<ServiceResult<void>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Security validation failed: ${validation.errors.join(', ')}`,
            code: 'SECURITY_VALIDATION_FAILED',
            details: { path, errors: validation.errors }
          }
        };
      }

      this.logger.info('Creating directory', { path, recursive: options.recursive });

      // 2. Build mkdir command args (via manager)
      const args = this.manager.buildMkdirArgs(path, options);

      // 3. Create directory (via adapter)
      const result = await this.adapter.createDirectory(args);

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `mkdir operation failed with exit code ${result.exitCode}`,
            code: 'MKDIR_ERROR',
            details: { path, options, exitCode: result.exitCode, stderr: result.stderr }
          }
        };
      }

      this.logger.info('Directory created successfully', { path });

      return {
        success: true
      };
    } catch (error) {
      const errorCode = this.manager.determineErrorCode('mkdir', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to create directory', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: this.manager.createErrorMessage('mkdir', path, errorMessage),
          code: errorCode,
          details: { path, options, originalError: errorMessage }
        }
      };
    }
  }

  async exists(path: string): Promise<ServiceResult<boolean>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Security validation failed: ${validation.errors.join(', ')}`,
            code: 'SECURITY_VALIDATION_FAILED',
            details: { path, errors: validation.errors }
          }
        };
      }

      // 2. Check if file/directory exists (via adapter)
      const exists = await this.adapter.exists(path);

      return {
        success: true,
        data: exists
      };
    } catch (error) {
      const errorCode = this.manager.determineErrorCode('exists', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn('Error checking file existence', { path, error: errorMessage });

      return {
        success: false,
        error: {
          message: this.manager.createErrorMessage('exists', path, errorMessage),
          code: errorCode,
          details: { path, originalError: errorMessage }
        }
      };
    }
  }

  async stat(path: string): Promise<ServiceResult<FileStats>> {
    try {
      // 1. Validate path for security
      const validation = this.security.validatePath(path);
      if (!validation.isValid) {
        return {
          success: false,
          error: {
            message: `Security validation failed: ${validation.errors.join(', ')}`,
            code: 'SECURITY_VALIDATION_FAILED',
            details: { path, errors: validation.errors }
          }
        };
      }

      // 2. Check if file exists (via adapter)
      const exists = await this.adapter.exists(path);
      if (!exists) {
        return {
          success: false,
          error: {
            message: `Path not found: ${path}`,
            code: 'FILE_NOT_FOUND',
            details: { path }
          }
        };
      }

      // 3. Build stat command args (via manager)
      const statCmd = this.manager.buildStatArgs(path);

      // 4. Get file stats (via adapter)
      const result = await this.adapter.getStats(path, statCmd.args[1]);

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: {
            message: `stat operation failed with exit code ${result.exitCode}`,
            code: 'STAT_ERROR',
            details: { path, exitCode: result.exitCode, stderr: result.stderr }
          }
        };
      }

      // 5. Parse stat output (via manager)
      const stats = this.manager.parseStatOutput(result.stdout);

      // 6. Validate stats (via manager)
      const statsValidation = this.manager.validateStats(stats);
      if (!statsValidation.valid) {
        this.logger.warn('Stats validation warnings', { path, errors: statsValidation.errors });
      }

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      const errorCode = this.manager.determineErrorCode('stat', error as Error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to get file stats', error instanceof Error ? error : undefined, { path });

      return {
        success: false,
        error: {
          message: this.manager.createErrorMessage('stat', path, errorMessage),
          code: errorCode,
          details: { path, originalError: errorMessage }
        }
      };
    }
  }

  // Convenience methods with ServiceResult wrapper for higher-level operations

  async readFile(path: string, options?: ReadOptions): Promise<ServiceResult<string>> {
    return await this.read(path, options);
  }

  async writeFile(path: string, content: string, options?: WriteOptions): Promise<ServiceResult<void>> {
    return await this.write(path, content, options);
  }

  async deleteFile(path: string): Promise<ServiceResult<void>> {
    return await this.delete(path);
  }

  async renameFile(oldPath: string, newPath: string): Promise<ServiceResult<void>> {
    return await this.rename(oldPath, newPath);
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<ServiceResult<void>> {
    return await this.move(sourcePath, destinationPath);
  }

  async createDirectory(path: string, options?: MkdirOptions): Promise<ServiceResult<void>> {
    return await this.mkdir(path, options);
  }

  async getFileStats(path: string): Promise<ServiceResult<FileStats>> {
    return await this.stat(path);
  }
}