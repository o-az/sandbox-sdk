/**
 * Error adapter that converts ErrorResponse to appropriate Error class
 *
 * Simple switch statement - we trust the container sends correct context
 * No validation overhead since we control both sides
 */

import type { 
  CodeExecutionContext,
  CommandErrorContext,
  CommandNotFoundContext,
  ContextNotFoundContext,ErrorResponse, 
  FileExistsContext,
  FileNotFoundContext,
  FileSystemContext,
  GitAuthFailedContext,
  GitBranchNotFoundContext,
  GitErrorContext,
  GitRepositoryNotFoundContext,
  InternalErrorContext,
  InterpreterNotReadyContext,
  InvalidPortContext,
  PortAlreadyExposedContext,
  PortErrorContext,
  PortNotExposedContext,
  ProcessErrorContext,
  ProcessNotFoundContext,
  ValidationFailedContext,} from '@repo/shared/errors';
import { ErrorCode } from '@repo/shared/errors';

import {
  CodeExecutionError,
  CommandError,
  CommandNotFoundError,
  ContextNotFoundError,
  CustomDomainRequiredError,
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
  InterpreterNotReadyError,
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
  ServiceNotRespondingError,
  ValidationFailedError,
} from './classes';

/**
 * Convert ErrorResponse to appropriate Error class
 * Simple switch statement - we trust the container sends correct context
 */
export function createErrorFromResponse(errorResponse: ErrorResponse): Error {
  switch (errorResponse.code) {
    // File System Errors
    case ErrorCode.FILE_NOT_FOUND:
      return new FileNotFoundError(errorResponse as ErrorResponse<FileNotFoundContext>);

    case ErrorCode.FILE_EXISTS:
      return new FileExistsError(errorResponse as ErrorResponse<FileExistsContext>);

    case ErrorCode.PERMISSION_DENIED:
      return new PermissionDeniedError(errorResponse as ErrorResponse<FileSystemContext>);

    case ErrorCode.IS_DIRECTORY:
    case ErrorCode.NOT_DIRECTORY:
    case ErrorCode.NO_SPACE:
    case ErrorCode.TOO_MANY_FILES:
    case ErrorCode.RESOURCE_BUSY:
    case ErrorCode.READ_ONLY:
    case ErrorCode.NAME_TOO_LONG:
    case ErrorCode.TOO_MANY_LINKS:
    case ErrorCode.FILESYSTEM_ERROR:
      return new FileSystemError(errorResponse as ErrorResponse<FileSystemContext>);

    // Command Errors
    case ErrorCode.COMMAND_NOT_FOUND:
      return new CommandNotFoundError(errorResponse as ErrorResponse<CommandNotFoundContext>);

    case ErrorCode.COMMAND_PERMISSION_DENIED:
    case ErrorCode.COMMAND_EXECUTION_ERROR:
    case ErrorCode.INVALID_COMMAND:
    case ErrorCode.STREAM_START_ERROR:
      return new CommandError(errorResponse as ErrorResponse<CommandErrorContext>);

    // Process Errors
    case ErrorCode.PROCESS_NOT_FOUND:
      return new ProcessNotFoundError(errorResponse as ErrorResponse<ProcessNotFoundContext>);

    case ErrorCode.PROCESS_PERMISSION_DENIED:
    case ErrorCode.PROCESS_ERROR:
      return new ProcessError(errorResponse as ErrorResponse<ProcessErrorContext>);

    // Port Errors
    case ErrorCode.PORT_ALREADY_EXPOSED:
      return new PortAlreadyExposedError(errorResponse as ErrorResponse<PortAlreadyExposedContext>);

    case ErrorCode.PORT_NOT_EXPOSED:
      return new PortNotExposedError(errorResponse as ErrorResponse<PortNotExposedContext>);

    case ErrorCode.INVALID_PORT_NUMBER:
    case ErrorCode.INVALID_PORT:
      return new InvalidPortError(errorResponse as ErrorResponse<InvalidPortContext>);

    case ErrorCode.SERVICE_NOT_RESPONDING:
      return new ServiceNotRespondingError(errorResponse as ErrorResponse<PortErrorContext>);

    case ErrorCode.PORT_IN_USE:
      return new PortInUseError(errorResponse as ErrorResponse<PortErrorContext>);

    case ErrorCode.PORT_OPERATION_ERROR:
      return new PortError(errorResponse as ErrorResponse<PortErrorContext>);

    case ErrorCode.CUSTOM_DOMAIN_REQUIRED:
      return new CustomDomainRequiredError(errorResponse as ErrorResponse<InternalErrorContext>);

    // Git Errors
    case ErrorCode.GIT_REPOSITORY_NOT_FOUND:
      return new GitRepositoryNotFoundError(errorResponse as ErrorResponse<GitRepositoryNotFoundContext>);

    case ErrorCode.GIT_AUTH_FAILED:
      return new GitAuthenticationError(errorResponse as ErrorResponse<GitAuthFailedContext>);

    case ErrorCode.GIT_BRANCH_NOT_FOUND:
      return new GitBranchNotFoundError(errorResponse as ErrorResponse<GitBranchNotFoundContext>);

    case ErrorCode.GIT_NETWORK_ERROR:
      return new GitNetworkError(errorResponse as ErrorResponse<GitErrorContext>);

    case ErrorCode.GIT_CLONE_FAILED:
      return new GitCloneError(errorResponse as ErrorResponse<GitErrorContext>);

    case ErrorCode.GIT_CHECKOUT_FAILED:
      return new GitCheckoutError(errorResponse as ErrorResponse<GitErrorContext>);

    case ErrorCode.INVALID_GIT_URL:
      return new InvalidGitUrlError(errorResponse as ErrorResponse<ValidationFailedContext>);

    case ErrorCode.GIT_OPERATION_FAILED:
      return new GitError(errorResponse as ErrorResponse<GitErrorContext>);

    // Code Interpreter Errors
    case ErrorCode.INTERPRETER_NOT_READY:
      return new InterpreterNotReadyError(errorResponse as ErrorResponse<InterpreterNotReadyContext>);

    case ErrorCode.CONTEXT_NOT_FOUND:
      return new ContextNotFoundError(errorResponse as ErrorResponse<ContextNotFoundContext>);

    case ErrorCode.CODE_EXECUTION_ERROR:
      return new CodeExecutionError(errorResponse as ErrorResponse<CodeExecutionContext>);

    // Validation Errors
    case ErrorCode.VALIDATION_FAILED:
      return new ValidationFailedError(errorResponse as ErrorResponse<ValidationFailedContext>);

    default:
      // Fallback for unknown error codes
      return new SandboxError(errorResponse);
  }
}
