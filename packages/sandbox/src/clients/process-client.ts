import type { LogEvent } from '@repo/shared-types';
import { parseSSEStream } from '../sse-parser';
import { BaseHttpClient } from './base-client';
import type { BaseApiResponse, HttpClientOptions, SessionRequest } from './types';

/**
 * Request interface for starting processes
 */
export interface StartProcessRequest extends SessionRequest {
  command: string;
  processId?: string;
}

/**
 * Process information
 */
export interface ProcessInfo {
  id: string;
  command: string;
  status: 'running' | 'completed' | 'killed' | 'failed';
  pid?: number;
  exitCode?: number;
  startTime: string;
  endTime?: string;
}

/**
 * Response interface for starting processes
 */
export interface StartProcessResponse extends BaseApiResponse {
  process: ProcessInfo;
}

/**
 * Response interface for listing processes
 */
export interface ListProcessesResponse extends BaseApiResponse {
  processes: ProcessInfo[];
  count: number;
}

/**
 * Response interface for getting a single process
 */
export interface GetProcessResponse extends BaseApiResponse {
  process: ProcessInfo;
}

/**
 * Response interface for process logs - matches container format
 */
export interface GetProcessLogsResponse extends BaseApiResponse {
  processId: string;
  stdout: string;
  stderr: string;
}

/**
 * Response interface for killing processes
 */
export interface KillProcessResponse extends BaseApiResponse {
  message: string;
}

/**
 * Response interface for killing all processes
 */
export interface KillAllProcessesResponse extends BaseApiResponse {
  killedCount: number;
  message: string;
}


/**
 * Client for background process management
 */
export class ProcessClient extends BaseHttpClient {
  constructor(options: HttpClientOptions = {}) {
    super(options);
  }

  /**
   * Start a background process
   * @param command - Command to execute as a background process
   * @param sessionId - The session ID for this operation
   * @param options - Optional settings (processId)
   */
  async startProcess(
    command: string,
    sessionId: string,
    options?: { processId?: string }
  ): Promise<StartProcessResponse> {
    try {
      const data = {
        command,
        sessionId,
        processId: options?.processId,
      };

      const response = await this.post<StartProcessResponse>(
        '/api/process/start',
        data
      );

      this.logSuccess(
        'Process started',
        `${command} (ID: ${response.process.id})`
      );

      return response;
    } catch (error) {
      this.logError('startProcess', error);
      throw error;
    }
  }

  /**
   * List all processes
   * @param sessionId - The session ID for this operation
   */
  async listProcesses(sessionId: string): Promise<ListProcessesResponse> {
    try {
      const url = `/api/process/list?session=${encodeURIComponent(sessionId)}`;
      const response = await this.get<ListProcessesResponse>(url);
      
      this.logSuccess('Processes listed', `${response.count} processes`);
      return response;
    } catch (error) {
      this.logError('listProcesses', error);
      throw error;
    }
  }

  /**
   * Get information about a specific process
   * @param processId - ID of the process to retrieve
   * @param sessionId - The session ID for this operation
   */
  async getProcess(processId: string, sessionId: string): Promise<GetProcessResponse> {
    try {
      const url = `/api/process/${processId}?session=${encodeURIComponent(sessionId)}`;
      const response = await this.get<GetProcessResponse>(url);
      
      this.logSuccess('Process retrieved', `ID: ${processId}`);
      return response;
    } catch (error) {
      this.logError('getProcess', error);
      throw error;
    }
  }

  /**
   * Kill a specific process
   * @param processId - ID of the process to kill
   * @param sessionId - The session ID for this operation
   */
  async killProcess(processId: string, sessionId: string): Promise<KillProcessResponse> {
    try {
      const url = `/api/process/${processId}?session=${encodeURIComponent(sessionId)}`;
      const response = await this.delete<KillProcessResponse>(url);

      this.logSuccess('Process killed', `ID: ${processId}`);
      return response;
    } catch (error) {
      this.logError('killProcess', error);
      throw error;
    }
  }

  /**
   * Kill all running processes
   * @param sessionId - The session ID for this operation
   */
  async killAllProcesses(sessionId: string): Promise<KillAllProcessesResponse> {
    try {
      const url = `/api/process/kill-all?session=${encodeURIComponent(sessionId)}`;
      const response = await this.delete<KillAllProcessesResponse>(url);

      this.logSuccess(
        'All processes killed',
        `${response.killedCount} processes terminated`
      );

      return response;
    } catch (error) {
      this.logError('killAllProcesses', error);
      throw error;
    }
  }

  /**
   * Get logs from a specific process
   * @param processId - ID of the process to get logs from
   * @param sessionId - The session ID for this operation
   */
  async getProcessLogs(processId: string, sessionId: string): Promise<GetProcessLogsResponse> {
    try {
      const url = `/api/process/${processId}/logs?session=${encodeURIComponent(sessionId)}`;
      const response = await this.get<GetProcessLogsResponse>(url);

      this.logSuccess(
        'Process logs retrieved',
        `ID: ${processId}, stdout: ${response.stdout.length} chars, stderr: ${response.stderr.length} chars`
      );

      return response;
    } catch (error) {
      this.logError('getProcessLogs', error);
      throw error;
    }
  }

  /**
   * Stream logs from a specific process
   * @param processId - ID of the process to stream logs from
   * @param sessionId - The session ID for this operation
   */
  async streamProcessLogs(processId: string, sessionId: string): Promise<ReadableStream<Uint8Array>> {
    try {
      const url = `/api/process/${processId}/stream?session=${encodeURIComponent(sessionId)}`;
      const response = await this.doFetch(url, {
        method: 'GET',
      });

      const stream = await this.handleStreamResponse(response);
      
      this.logSuccess('Process log stream started', `ID: ${processId}`);

      return stream;
    } catch (error) {
      this.logError('streamProcessLogs', error);
      throw error;
    }
  }
}
