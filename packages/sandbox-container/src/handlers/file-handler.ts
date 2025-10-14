import type {
  DeleteFileResult,
  MkdirResult,
  MoveFileResult,
  ReadFileResult,
  RenameFileResult,
  WriteFileResult,
} from '@repo/shared';
import { ErrorCode } from '@repo/shared/errors';

import type {
  DeleteFileRequest,
  Logger,
  MkdirRequest,
  MoveFileRequest,
  ReadFileRequest,
  RenameFileRequest,
  RequestContext,
  WriteFileRequest
} from '../core/types';
import type { FileService } from '../services/file-service';
import { BaseHandler } from './base-handler';

export class FileHandler extends BaseHandler<Request, Response> {
  constructor(
    private fileService: FileService,
    logger: Logger
  ) {
    super(logger);
  }

  async handle(request: Request, context: RequestContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    switch (pathname) {
      case '/api/read':
        return await this.handleRead(request, context);
      case '/api/write':
        return await this.handleWrite(request, context);
      case '/api/delete':
        return await this.handleDelete(request, context);
      case '/api/rename':
        return await this.handleRename(request, context);
      case '/api/move':
        return await this.handleMove(request, context);
      case '/api/mkdir':
        return await this.handleMkdir(request, context);
      default:
        return this.createErrorResponse({
          message: 'Invalid file endpoint',
          code: ErrorCode.UNKNOWN_ERROR,
        }, context);
    }
  }

  private async handleRead(request: Request, context: RequestContext): Promise<Response> {
    const body = await this.parseRequestBody<ReadFileRequest>(request);

    this.logger.info('Reading file', {
      requestId: context.requestId,
      path: body.path,
      encoding: body.encoding
    });

    const result = await this.fileService.readFile(body.path, {
      encoding: body.encoding || 'utf-8',
    });

    if (result.success) {
      this.logger.info('File read successfully', {
        requestId: context.requestId,
        path: body.path,
        sizeBytes: result.data.length,
      });

      const response: ReadFileResult = {
        success: true,
        path: body.path,
        content: result.data,
        timestamp: new Date().toISOString(),
      };

      return this.createTypedResponse(response, context);
    } else {
      this.logger.error('File read failed', undefined, {
        requestId: context.requestId,
        path: body.path,
        errorCode: result.error.code,
        errorMessage: result.error.message,
      });

      return this.createErrorResponse(result.error, context);
    }
  }

  private async handleWrite(request: Request, context: RequestContext): Promise<Response> {
    const body = await this.parseRequestBody<WriteFileRequest>(request);

    this.logger.info('Writing file', {
      requestId: context.requestId,
      path: body.path,
      sizeBytes: body.content.length,
      encoding: body.encoding
    });

    const result = await this.fileService.writeFile(body.path, body.content, {
      encoding: body.encoding || 'utf-8',
    });

    if (result.success) {
      this.logger.info('File written successfully', {
        requestId: context.requestId,
        path: body.path,
        sizeBytes: body.content.length,
      });

      const response: WriteFileResult = {
        success: true,
        path: body.path,
        timestamp: new Date().toISOString(),
      };

      return this.createTypedResponse(response, context);
    } else {
      this.logger.error('File write failed', undefined, {
        requestId: context.requestId,
        path: body.path,
        errorCode: result.error.code,
        errorMessage: result.error.message,
      });

      return this.createErrorResponse(result.error, context);
    }
  }

  private async handleDelete(request: Request, context: RequestContext): Promise<Response> {
    const body = await this.parseRequestBody<DeleteFileRequest>(request);

    this.logger.info('Deleting file', {
      requestId: context.requestId,
      path: body.path
    });

    const result = await this.fileService.deleteFile(body.path);

    if (result.success) {
      this.logger.info('File deleted successfully', {
        requestId: context.requestId,
        path: body.path,
      });

      const response: DeleteFileResult = {
        success: true,
        path: body.path,
        timestamp: new Date().toISOString(),
      };

      return this.createTypedResponse(response, context);
    } else {
      this.logger.error('File delete failed', undefined, {
        requestId: context.requestId,
        path: body.path,
        errorCode: result.error.code,
        errorMessage: result.error.message,
      });

      return this.createErrorResponse(result.error, context);
    }
  }

  private async handleRename(request: Request, context: RequestContext): Promise<Response> {
    const body = await this.parseRequestBody<RenameFileRequest>(request);

    this.logger.info('Renaming file', {
      requestId: context.requestId,
      oldPath: body.oldPath,
      newPath: body.newPath
    });

    const result = await this.fileService.renameFile(body.oldPath, body.newPath);

    if (result.success) {
      this.logger.info('File renamed successfully', {
        requestId: context.requestId,
        oldPath: body.oldPath,
        newPath: body.newPath,
      });

      const response: RenameFileResult = {
        success: true,
        path: body.oldPath,
        newPath: body.newPath,
        timestamp: new Date().toISOString(),
      };

      return this.createTypedResponse(response, context);
    } else {
      this.logger.error('File rename failed', undefined, {
        requestId: context.requestId,
        oldPath: body.oldPath,
        newPath: body.newPath,
        errorCode: result.error.code,
        errorMessage: result.error.message,
      });

      return this.createErrorResponse(result.error, context);
    }
  }

  private async handleMove(request: Request, context: RequestContext): Promise<Response> {
    const body = await this.parseRequestBody<MoveFileRequest>(request);

    this.logger.info('Moving file', {
      requestId: context.requestId,
      sourcePath: body.sourcePath,
      destinationPath: body.destinationPath
    });

    const result = await this.fileService.moveFile(body.sourcePath, body.destinationPath);

    if (result.success) {
      this.logger.info('File moved successfully', {
        requestId: context.requestId,
        sourcePath: body.sourcePath,
        destinationPath: body.destinationPath,
      });

      const response: MoveFileResult = {
        success: true,
        path: body.sourcePath,
        newPath: body.destinationPath,
        timestamp: new Date().toISOString(),
      };

      return this.createTypedResponse(response, context);
    } else {
      this.logger.error('File move failed', undefined, {
        requestId: context.requestId,
        sourcePath: body.sourcePath,
        destinationPath: body.destinationPath,
        errorCode: result.error.code,
        errorMessage: result.error.message,
      });

      return this.createErrorResponse(result.error, context);
    }
  }

  private async handleMkdir(request: Request, context: RequestContext): Promise<Response> {
    const body = await this.parseRequestBody<MkdirRequest>(request);

    this.logger.info('Creating directory', {
      requestId: context.requestId,
      path: body.path,
      recursive: body.recursive
    });

    const result = await this.fileService.createDirectory(body.path, {
      recursive: body.recursive,
    });

    if (result.success) {
      this.logger.info('Directory created successfully', {
        requestId: context.requestId,
        path: body.path,
        recursive: body.recursive,
      });

      const response: MkdirResult = {
        success: true,
        path: body.path,
        recursive: body.recursive ?? false,
        timestamp: new Date().toISOString(),
      };

      return this.createTypedResponse(response, context);
    } else {
      this.logger.error('Directory creation failed', undefined, {
        requestId: context.requestId,
        path: body.path,
        recursive: body.recursive,
        errorCode: result.error.code,
        errorMessage: result.error.message,
      });

      return this.createErrorResponse(result.error, context);
    }
  }
}