/**
 * Core SDK Types - Public API interfaces for Cloudflare Sandbox SDK consumers
 */

// Base execution options shared across command types
export interface BaseExecOptions {
  /**
   * Session ID for grouping related commands
   */
  sessionId?: string;

  /**
   * Maximum execution time in milliseconds
   */
  timeout?: number;

  /**
   * Environment variables for the command
   */
  env?: Record<string, string>;

  /**
   * Working directory for command execution
   */
  cwd?: string;

  /**
   * Text encoding for output (default: 'utf8')
   */
  encoding?: string;
}

// Command execution types
export interface ExecOptions extends BaseExecOptions {
  /**
   * Enable real-time output streaming via callbacks
   */
  stream?: boolean;

  /**
   * Callback for real-time output data
   */
  onOutput?: (stream: 'stdout' | 'stderr', data: string) => void;

  /**
   * Callback when command completes (only when stream: true)
   */
  onComplete?: (result: ExecResult) => void;

  /**
   * Callback for execution errors
   */
  onError?: (error: Error) => void;

  /**
   * AbortSignal for cancelling execution
   */
  signal?: AbortSignal;
}

export interface ExecResult {
  /**
   * Whether the command succeeded (exitCode === 0)
   */
  success: boolean;

  /**
   * Process exit code
   */
  exitCode: number;

  /**
   * Standard output content
   */
  stdout: string;

  /**
   * Standard error content
   */
  stderr: string;

  /**
   * Command that was executed
   */
  command: string;

  /**
   * Execution duration in milliseconds
   */
  duration: number;

  /**
   * ISO timestamp when command started
   */
  timestamp: string;

  /**
   * Session ID if provided
   */
  sessionId?: string;
}

// Background process types
export interface ProcessOptions extends BaseExecOptions {
  /**
   * Custom process ID for later reference
   * If not provided, a UUID will be generated
   */
  processId?: string;

  /**
   * Automatically cleanup process record after exit (default: true)
   */
  autoCleanup?: boolean;

  /**
   * Callback when process exits
   */
  onExit?: (code: number | null) => void;

  /**
   * Callback for real-time output (background processes)
   */
  onOutput?: (stream: 'stdout' | 'stderr', data: string) => void;

  /**
   * Callback when process starts successfully
   */
  onStart?: (process: Process) => void;

  /**
   * Callback for process errors
   */
  onError?: (error: Error) => void;
}

export type ProcessStatus =
  | 'starting'    // Process is being initialized
  | 'running'     // Process is actively running
  | 'completed'   // Process exited successfully (code 0)
  | 'failed'      // Process exited with non-zero code
  | 'killed'      // Process was terminated by signal
  | 'error';      // Process failed to start or encountered error

export interface Process {
  /**
   * Unique process identifier
   */
  readonly id: string;

  /**
   * System process ID (if available and running)
   */
  readonly pid?: number;

  /**
   * Command that was executed
   */
  readonly command: string;

  /**
   * Current process status
   */
  readonly status: ProcessStatus;

  /**
   * When the process was started
   */
  readonly startTime: Date;

  /**
   * When the process ended (if completed)
   */
  readonly endTime?: Date;

  /**
   * Process exit code (if completed)
   */
  readonly exitCode?: number;

  /**
   * Session ID if provided
   */
  readonly sessionId?: string;

  /**
   * Kill the process
   */
  kill(signal?: string): Promise<void>;

  /**
   * Get current process status (refreshed)
   */
  getStatus(): Promise<ProcessStatus>;

  /**
   * Get accumulated logs
   */
  getLogs(): Promise<{ stdout: string; stderr: string }>;
}

// Streaming event types
export interface ExecEvent {
  type: 'start' | 'stdout' | 'stderr' | 'complete' | 'error';
  timestamp: string;
  data?: string;
  command?: string;
  exitCode?: number;
  result?: ExecResult;
  error?: string;
  sessionId?: string;
}

export interface LogEvent {
  type: 'stdout' | 'stderr' | 'exit' | 'error';
  timestamp: string;
  data: string;
  processId: string;
  sessionId?: string;
  exitCode?: number;
}

export interface StreamOptions extends BaseExecOptions {
  /**
   * Buffer size for streaming output
   */
  bufferSize?: number;

  /**
   * AbortSignal for cancelling stream
   */
  signal?: AbortSignal;
}


// Session management types
export interface SessionOptions {
  /**
   * Optional session ID (auto-generated if not provided)
   */
  id?: string;
  
  /**
   * Session name for identification
   */
  name?: string;
  
  /**
   * Environment variables for this session
   */
  env?: Record<string, string>;
  
  /**
   * Working directory
   */
  cwd?: string;
  
  /**
   * Enable PID namespace isolation (requires CAP_SYS_ADMIN)
   */
  isolation?: boolean;
}

/**
 * Execution session - isolated execution context within a sandbox
 * Returned by sandbox.createSession()
 * Provides the same API as ISandbox but bound to a specific session
 */
// File operation result types
export interface MkdirResult {
  success: boolean;
  path: string;
  recursive: boolean;
  timestamp: string;
  exitCode?: number;
}

export interface WriteFileResult {
  success: boolean;
  path: string;
  timestamp: string;
  exitCode?: number;
}

export interface ReadFileResult {
  success: boolean;
  path: string;
  content: string;
  timestamp: string;
  exitCode?: number;
}

export interface DeleteFileResult {
  success: boolean;
  path: string;
  timestamp: string;
  exitCode?: number;
}

export interface RenameFileResult {
  success: boolean;
  path: string;
  newPath: string;
  timestamp: string;
  exitCode?: number;
}

export interface MoveFileResult {
  success: boolean;
  path: string;
  newPath: string;
  timestamp: string;
  exitCode?: number;
}

export interface GitCheckoutResult {
  success: boolean;
  repoUrl: string;
  branch: string;
  targetDir: string;
  timestamp: string;
  exitCode?: number;
}

export interface ExecutionSession {
  /** Unique session identifier */
  readonly id: string;
  
  // Command execution
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  execStream(command: string, options?: StreamOptions): Promise<ReadableStream<Uint8Array>>;
  
  // Background process management
  startProcess(command: string, options?: ProcessOptions): Promise<Process>;
  listProcesses(): Promise<Process[]>;
  getProcess(id: string): Promise<Process | null>;
  killProcess(id: string, signal?: string): Promise<void>;
  killAllProcesses(): Promise<number>;
  cleanupCompletedProcesses(): Promise<number>;
  getProcessLogs(id: string): Promise<{ stdout: string; stderr: string; processId: string }>;
  streamProcessLogs(processId: string, options?: { signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>>;
  
  // File operations
  writeFile(path: string, content: string, options?: { encoding?: string }): Promise<WriteFileResult>;
  readFile(path: string, options?: { encoding?: string }): Promise<ReadFileResult>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<MkdirResult>;
  deleteFile(path: string): Promise<DeleteFileResult>;
  renameFile(oldPath: string, newPath: string): Promise<RenameFileResult>;
  moveFile(sourcePath: string, destinationPath: string): Promise<MoveFileResult>;
  
  // Git operations
  gitCheckout(repoUrl: string, options?: { branch?: string; targetDir?: string }): Promise<GitCheckoutResult>;
  
  // Environment management
  setEnvVars(envVars: Record<string, string>): Promise<void>;
  
  // Code interpreter methods
  createCodeContext(options?: import('./interpreter-types').CreateContextOptions): Promise<import('./interpreter-types').CodeContext>;
  runCode(code: string, options?: import('./interpreter-types').RunCodeOptions): Promise<import('./interpreter-types').ExecutionResult>;
  listCodeContexts(): Promise<import('./interpreter-types').CodeContext[]>;
  deleteCodeContext(contextId: string): Promise<void>;
}

// Main Sandbox interface
export interface ISandbox {
  // Command execution
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;

  // Background process management
  startProcess(command: string, options?: ProcessOptions): Promise<Process>;
  listProcesses(): Promise<Process[]>;
  getProcess(id: string): Promise<Process | null>;
  killProcess(id: string, signal?: string): Promise<void>;
  killAllProcesses(): Promise<number>;

  // Streaming operations
  execStream(command: string, options?: StreamOptions): Promise<ReadableStream<Uint8Array>>;
  streamProcessLogs(processId: string, options?: { signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>>;

  // Utility methods
  cleanupCompletedProcesses(): Promise<number>;
  getProcessLogs(id: string): Promise<{ stdout: string; stderr: string; processId: string }>;

  // Session management
  createSession(options?: SessionOptions): Promise<ExecutionSession>;

  // Code interpreter methods
  createCodeContext(options?: import('./interpreter-types').CreateContextOptions): Promise<import('./interpreter-types').CodeContext>;
  runCode(code: string, options?: import('./interpreter-types').RunCodeOptions): Promise<import('./interpreter-types').ExecutionResult>;
  listCodeContexts(): Promise<import('./interpreter-types').CodeContext[]>;
  deleteCodeContext(contextId: string): Promise<void>;
}

// Type guards for runtime validation
export function isExecResult(value: any): value is ExecResult {
  return value &&
    typeof value.success === 'boolean' &&
    typeof value.exitCode === 'number' &&
    typeof value.stdout === 'string' &&
    typeof value.stderr === 'string';
}

export function isProcess(value: any): value is Process {
  return value &&
    typeof value.id === 'string' &&
    typeof value.command === 'string' &&
    typeof value.status === 'string';
}

export function isProcessStatus(value: string): value is ProcessStatus {
  return ['starting', 'running', 'completed', 'failed', 'killed', 'error'].includes(value);
}

// Re-export interpreter types for convenience
export type {
  ChartData,
  CodeContext,
  CreateContextOptions,
  ExecutionError,
  ExecutionResult, 
  OutputMessage,
  Result,
  RunCodeOptions
} from './interpreter-types.js';

export { Execution, ResultImpl } from './interpreter-types.js';