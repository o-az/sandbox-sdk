/**
 * BunFileAdapter - Infrastructure Wrapper for File Operations
 *
 * Thin wrapper around Bun's native file APIs.
 * This class handles all I/O operations and Bun-specific functionality.
 *
 * Responsibilities:
 * - Reading files using Bun.file()
 * - Writing files using Bun.write()
 * - Checking file existence
 * - Executing file system commands (rm, mv, mkdir, stat)
 */

import type { BunFile } from 'bun';
import { BunProcessAdapter, type ExecutionResult } from './bun-process-adapter';

export interface FileContent {
  content: string;
  size: number;
}

export interface FileExistsResult {
  exists: boolean;
}

/**
 * BunFileAdapter wraps Bun's file APIs for testability.
 * All methods are thin wrappers with minimal logic.
 */
export class BunFileAdapter {
  private processAdapter: BunProcessAdapter;

  constructor(processAdapter?: BunProcessAdapter) {
    this.processAdapter = processAdapter || new BunProcessAdapter();
  }

  /**
   * Get a Bun file handle for the given path
   */
  getFile(path: string): BunFile {
    return Bun.file(path);
  }

  /**
   * Check if a file or directory exists at the given path
   * Note: Bun.file().exists() only works for files, so we use a shell command for reliability
   */
  async exists(path: string): Promise<boolean> {
    // Use test command which works for both files and directories
    const result = await this.processAdapter.execute('test', ['-e', path]);
    return result.exitCode === 0;
  }

  /**
   * Read a file's entire text content
   * Uses Bun's optimized file reading (3-5x faster than Node.js fs)
   */
  async readText(path: string): Promise<string> {
    const file = this.getFile(path);
    return await file.text();
  }

  /**
   * Read a file and return both content and size
   */
  async read(path: string): Promise<FileContent> {
    const file = this.getFile(path);
    const content = await file.text();
    return {
      content,
      size: content.length,
    };
  }

  /**
   * Write content to a file
   * Uses Bun's optimized zero-copy write operations
   */
  async write(path: string, content: string | BunFile): Promise<void> {
    await Bun.write(path, content);
  }

  /**
   * Delete a file using rm command
   */
  async deleteFile(path: string): Promise<ExecutionResult> {
    // File-only deletion - directories must be deleted via exec('rm -rf')
    return await this.processAdapter.execute('rm', [path]);
  }

  /**
   * Rename a file using mv command
   */
  async renameFile(oldPath: string, newPath: string): Promise<ExecutionResult> {
    return await this.processAdapter.execute('mv', [oldPath, newPath]);
  }

  /**
   * Create a directory using mkdir command
   */
  async createDirectory(args: string[]): Promise<ExecutionResult> {
    return await this.processAdapter.execute('mkdir', args.slice(1)); // Skip 'mkdir' itself
  }

  /**
   * Get file statistics using stat command
   * Returns raw stat output in format: type:size:modified:created
   * Handles both GNU stat (Linux) and BSD stat (macOS)
   */
  async getStats(path: string, format: string): Promise<ExecutionResult> {
    // Detect OS to use correct stat flags
    // macOS uses BSD stat (-f), Linux uses GNU stat (-c)
    const isMacOS = process.platform === 'darwin';

    if (isMacOS) {
      // BSD stat format for macOS
      // %HT = file type, %z = size, %m = modified, %B = created (birth time)
      return await this.processAdapter.execute('stat', ['-f', '%HT:%z:%m:%B', path]);
    } else {
      // GNU stat format for Linux
      // format should be something like '%F:%s:%Y:%W'
      return await this.processAdapter.execute('stat', ['-c', format, path]);
    }
  }

  /**
   * Copy file content (for move operations within Bun)
   */
  async copy(sourcePath: string, destPath: string): Promise<void> {
    const sourceFile = this.getFile(sourcePath);
    await this.write(destPath, sourceFile);
  }

  /**
   * Move file: copy then delete
   * Used when move across filesystems is needed
   */
  async move(sourcePath: string, destPath: string): Promise<void> {
    await this.copy(sourcePath, destPath);
    await this.deleteFile(sourcePath);
  }

  /**
   * Get file size without reading entire content
   */
  async getSize(path: string): Promise<number> {
    const file = this.getFile(path);
    return file.size;
  }

  /**
   * Get file type (mime type)
   */
  getFileType(path: string): string {
    const file = this.getFile(path);
    return file.type;
  }
}
