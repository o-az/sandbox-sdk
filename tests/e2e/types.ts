import type { ProcessStatus } from '@repo/shared';

/**
 * Serialized SDK types for E2E testing
 *
 * These types represent what comes back from the test worker after SDK types
 * are serialized to JSON. Methods on objects are lost during serialization,
 * but all data properties are preserved.
 *
 * E2E tests should expect these serialized types, NOT container DTOs.
 */

/**
 * Serialized Process object - what comes back when Process is JSON serialized
 *
 * Note: The SDK's Process type includes methods (kill, getStatus, getLogs)
 * which don't serialize over HTTP. This type represents the data-only structure.
 */
export interface SerializedProcess {
  /** Process identifier (SDK uses 'id', not 'processId') */
  id: string;

  /** Operating system process ID */
  pid?: number;

  /** Command that was executed */
  command: string;

  /** Current process status (SDK includes this field) */
  status: ProcessStatus;

  /** Process start time as ISO string (Date → string during serialization) */
  startTime: string;

  /** Process end time as ISO string, if completed */
  endTime?: string;

  /** Exit code if process has finished */
  exitCode?: number;

  /** Associated session ID if running in a session context */
  sessionId?: string;

  // Note: Methods (kill, getStatus, getLogs) are not included as they don't serialize
}

/**
 * Response from test worker when listing processes
 * Note: Returns array directly, not wrapped in an object
 */
export type ProcessListResponse = SerializedProcess[];

/**
 * Response from test worker when getting process logs
 */
export interface ProcessLogsResponse {
  stdout: string;
  stderr: string;
}

/**
 * Generic success response from test worker
 */
export interface SuccessResponse {
  success: boolean;
  message?: string;
  [key: string]: any; // Allow for additional fields
}
