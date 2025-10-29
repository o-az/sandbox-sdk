export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';

export interface Handler<TRequest, TResponse> {
  handle(request: TRequest, context: RequestContext): Promise<TResponse>;
}

export interface RequestContext {
  sessionId?: string;
  corsHeaders: Record<string, string>;
  requestId: string;
  timestamp: Date;
}

export type ValidationResult<T = unknown> =
  | {
      isValid: true;
      data: T;
      errors: ValidationError[];
    }
  | {
      isValid: false;
      data?: undefined;
      errors: ValidationError[];
    };

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export type ServiceResult<T, M = Record<string, unknown>> = T extends void
  ?
      | {
          success: true;
          metadata?: M;
        }
      | {
          success: false;
          error: ServiceError;
        }
  :
      | {
          success: true;
          data: T;
          metadata?: M;
        }
      | {
          success: false;
          error: ServiceError;
        };

export interface ServiceError {
  message: string;
  code: string;
  details?: Record<string, unknown>;
}

// Handler error response structure - matches BaseHandler.createErrorResponse()
export interface HandlerErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: any;
  timestamp: string;
}

// Misc handler response interfaces
export interface PingResponse {
  message: string;
  timestamp: string;
  requestId: string;
}

export interface CommandsResponse {
  availableCommands: string[];
  timestamp: string;
}

// Port handler response interfaces
export interface ExposePortResponse {
  success: true;
  port: number;
  name?: string;
  exposedAt: string;
  timestamp: string;
}

export interface UnexposePortResponse {
  success: true;
  message: string;
  port: number;
  timestamp: string;
}

export interface ListExposedPortsResponse {
  success: true;
  count: number;
  ports: Array<{
    port: number;
    name?: string;
    exposedAt: string;
  }>;
  timestamp: string;
}

// Proxied service response interfaces - for responses from external services via proxy
export interface ProxiedSuccessResponse {
  success: boolean;
  [key: string]: unknown;
}

export interface ProxiedErrorResponse {
  error: string;
  [key: string]: unknown;
}

// Process handler response interfaces
export interface StartProcessResponse {
  success: true;
  process: ProcessInfo;
  message: string;
  timestamp: string;
}

export interface ListProcessesResponse {
  success: true;
  count: number;
  processes: ProcessInfo[];
  timestamp: string;
}

export interface GetProcessResponse {
  success: true;
  process: ProcessInfo;
  timestamp: string;
}

export interface KillProcessResponse {
  success: true;
  message: string;
  timestamp: string;
}

export interface KillAllProcessesResponse {
  success: true;
  message: string;
  killedCount: number;
  timestamp: string;
}

export interface ProcessLogsResponse {
  success: true;
  processId: string;
  stdout: string;
  stderr: string;
  timestamp: string;
}

// Session handler response interfaces
export interface CreateSessionResponse {
  message: string;
  sessionId: string;
  timestamp: string;
}

export interface ListSessionsResponse {
  count: number;
  sessions: Array<{
    sessionId: string;
    // Note: createdAt and hasActiveProcess are not included
    // as they would require querying each session individually
  }>;
  timestamp: string;
}

// Port service specific error response interfaces
export interface PortNotFoundResponse {
  error: string;
  port: number;
}

export interface ProxyErrorResponse {
  error: string;
  message: string;
}

export interface Middleware {
  handle(
    request: Request,
    context: RequestContext,
    next: NextFunction
  ): Promise<Response>;
}

export type NextFunction = () => Promise<Response>;

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handler: RequestHandler;
  middleware?: Middleware[];
}

export type RequestHandler = (
  request: Request,
  context: RequestContext
) => Promise<Response>;

// Session types
export interface SessionData {
  id: string;
  sessionId: string; // Keep for backwards compatibility
  activeProcess: string | null;
  createdAt: Date;
  expiresAt?: Date;
  env?: Record<string, string>;
  cwd?: string;
}

// Process types (enhanced from existing)
export type ProcessStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'error';

export interface ProcessRecord {
  id: string;
  pid?: number;
  command: string;
  status: ProcessStatus;
  startTime: Date;
  endTime?: Date;
  exitCode?: number;
  sessionId?: string;
  stdout: string;
  stderr: string;
  outputListeners: Set<(stream: 'stdout' | 'stderr', data: string) => void>;
  statusListeners: Set<(status: ProcessStatus) => void>;
  // Unified execution model: All processes use SessionManager
  commandHandle?: {
    sessionId: string;
    commandId: string;
  };
  // For isolation layer (file-based IPC)
  stdoutFile?: string;
  stderrFile?: string;
  monitoringInterval?: Timer;
}

// Export ProcessRecord as ProcessInfo for consistency with test usage
export type ProcessInfo = ProcessRecord;

export type { ProcessOptions } from '../validation/schemas';

export interface CommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

// File operation types
export interface FileStats {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  modified: Date;
  created: Date;
}

export interface FileMetadata {
  encoding: 'utf-8' | 'base64';
  isBinary: boolean;
  mimeType: string;
  size: number;
}

export interface ReadOptions {
  encoding?: string;
}

export interface WriteOptions {
  encoding?: string;
  mode?: string;
}

export interface MkdirOptions {
  recursive?: boolean;
  mode?: string;
}

// Port management types
export interface PortInfo {
  port: number;
  name?: string;
  exposedAt: Date;
  status: 'active' | 'inactive';
}

// Git operation types
export interface GitResult {
  success: boolean;
  message: string;
  targetDirectory?: string;
  error?: string;
}

export interface CloneOptions {
  branch?: string;
  targetDir?: string;
  sessionId?: string;
}

// Import request types from Zod schemas - single source of truth!
export type { ExecuteRequest } from '../validation/schemas';

export interface ExecuteResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  processId?: string;
}

export type { ReadFileRequest } from '../validation/schemas';

export interface ReadFileResponse {
  success: boolean;
  content: string;
  path: string;
  exitCode: number;
  encoding: string;
  timestamp: string;
}

export type { WriteFileRequest } from '../validation/schemas';

export interface WriteFileResponse {
  success: boolean;
  exitCode: number;
  path: string;
  timestamp: string;
}

export type { DeleteFileRequest } from '../validation/schemas';

export interface DeleteFileResponse {
  success: boolean;
  exitCode: number;
  path: string;
  timestamp: string;
}

export type { RenameFileRequest } from '../validation/schemas';

export interface RenameFileResponse {
  success: boolean;
  exitCode: number;
  path: string;
  newPath: string;
  timestamp: string;
}

export type { MoveFileRequest } from '../validation/schemas';

export interface MoveFileResponse {
  success: boolean;
  exitCode: number;
  path: string;
  newPath: string;
  timestamp: string;
}

export type { GitCheckoutRequest } from '../validation/schemas';

export interface GitCheckoutResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  repoUrl: string;
  branch: string;
  targetDir: string;
  timestamp: string;
}

export type { ListFilesRequest, MkdirRequest } from '../validation/schemas';

export interface MkdirResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  path: string;
  recursive: boolean;
  timestamp: string;
}

// Import StartProcessRequest from @repo/shared for type safety across client/container boundary
export type { StartProcessRequest } from '@repo/shared';

// Import union types from Zod schemas
export type {
  ExposePortRequest,
  FileOperation,
  FileRequest
} from '../validation/schemas';
