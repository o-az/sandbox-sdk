import { BaseHttpClient } from './base-client';
import type {
  BaseApiResponse,
  HttpClientOptions,
  SessionRequest
} from './types';

/**
 * Request interface for command execution
 */
export interface ExecuteRequest extends SessionRequest {
  command: string;
  timeoutMs?: number;
}

/**
 * Response interface for command execution
 */
export interface ExecuteResponse extends BaseApiResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

/**
 * Client for command execution operations
 */
export class CommandClient extends BaseHttpClient {
  /**
   * Execute a command and return the complete result
   * @param command - The command to execute
   * @param sessionId - The session ID for this command execution
   * @param timeoutMs - Optional timeout in milliseconds (unlimited by default)
   */
  async execute(
    command: string,
    sessionId: string,
    timeoutMs?: number
  ): Promise<ExecuteResponse> {
    try {
      const data: ExecuteRequest = {
        command,
        sessionId,
        ...(timeoutMs !== undefined && { timeoutMs })
      };

      const response = await this.post<ExecuteResponse>('/api/execute', data);

      this.logSuccess(
        'Command executed',
        `${command}, Success: ${response.success}`
      );

      // Call the callback if provided
      this.options.onCommandComplete?.(
        response.success,
        response.exitCode,
        response.stdout,
        response.stderr,
        response.command
      );

      return response;
    } catch (error) {
      this.logError('execute', error);

      // Call error callback if provided
      this.options.onError?.(
        error instanceof Error ? error.message : String(error),
        command
      );

      throw error;
    }
  }

  /**
   * Execute a command and return a stream of events
   * @param command - The command to execute
   * @param sessionId - The session ID for this command execution
   */
  async executeStream(
    command: string,
    sessionId: string
  ): Promise<ReadableStream<Uint8Array>> {
    try {
      const data = { command, sessionId };

      const response = await this.doFetch('/api/execute/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      const stream = await this.handleStreamResponse(response);

      this.logSuccess('Command stream started', command);

      return stream;
    } catch (error) {
      this.logError('executeStream', error);

      // Call error callback if provided
      this.options.onError?.(
        error instanceof Error ? error.message : String(error),
        command
      );

      throw error;
    }
  }
}
