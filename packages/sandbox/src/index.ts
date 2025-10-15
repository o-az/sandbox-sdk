// Export the main Sandbox class and utilities


// Export the new client architecture
export {
  CommandClient,
  FileClient,
  GitClient,
  PortClient,
  ProcessClient,
  SandboxClient,
  UtilityClient
} from "./clients";
export { getSandbox, Sandbox } from "./sandbox";

// Legacy types are now imported from the new client architecture

// Export core SDK types for consumers
export type {
  BaseExecOptions,
  ExecEvent,
  ExecOptions,
  ExecResult,
  ISandbox,
  LogEvent,
  Process,
  ProcessOptions,
  ProcessStatus,
  StreamOptions
} from "@repo/shared";
export * from '@repo/shared';
// Export type guards for runtime validation
export {
  isExecResult,
  isProcess,
  isProcessStatus
} from "@repo/shared";
// Export all client types from new architecture
export type {
  BaseApiResponse,
  CommandsResponse, 
  ContainerStub,
  ErrorResponse,

  // Command client types
  ExecuteRequest,
  ExecuteResponse as CommandExecuteResponse,
  ExposedPortInfo,

  // Port client types
  ExposePortRequest,
  ExposePortResponse,
  FileOperationRequest,
  GetExposedPortsResponse,

  // Git client types
  GitCheckoutRequest,
  GitCheckoutResponse,
  // Base client types
  HttpClientOptions as SandboxClientOptions,

  // File client types
  MkdirRequest,

  // Utility client types
  PingResponse,
  ProcessCleanupResult,
  ProcessInfoResult,
  ProcessKillResult,
  ProcessListResult,
  ProcessLogsResult,
  ProcessStartResult,
  ReadFileRequest,
  RequestConfig,
  ResponseHandler,
  SessionRequest,

  // Process client types
  StartProcessRequest,
  UnexposePortRequest,
  UnexposePortResponse,
  WriteFileRequest
} from "./clients";
export type { ExecutionCallbacks, InterpreterClient } from './clients/interpreter-client.js';

// Export interpreter functionality
export { CodeInterpreter } from './interpreter.js';
// Re-export request handler utilities
export {
  proxyToSandbox, type RouteInfo, type SandboxEnv
} from './request-handler';
// Export SSE parser for converting ReadableStream to AsyncIterable
export { asyncIterableToSSEStream, parseSSEStream, responseToAsyncIterable } from "./sse-parser";
