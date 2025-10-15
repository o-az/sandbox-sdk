import type {
  ProcessCleanupResult,
  ProcessInfoResult,
  ProcessKillResult,
  ProcessListResult,
  ProcessLogsResult,
  ProcessStartResult,
  StartProcessRequest,
} from '@repo/shared';
import { BaseHttpClient } from './base-client';
import type { HttpClientOptions } from './types';

// Re-export for convenience
export type {
  StartProcessRequest,
  ProcessStartResult,
  ProcessListResult,
  ProcessInfoResult,
  ProcessKillResult,
  ProcessLogsResult,
  ProcessCleanupResult,
};


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
  ): Promise<ProcessStartResult> {
    try {
      const data: StartProcessRequest = {
        command,
        sessionId,
        processId: options?.processId,
      };

      const response = await this.post<ProcessStartResult>(
        '/api/process/start',
        data
      );

      this.logSuccess(
        'Process started',
        `${command} (ID: ${response.processId})`
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
  async listProcesses(sessionId: string): Promise<ProcessListResult> {
    try {
      const url = `/api/process/list?session=${encodeURIComponent(sessionId)}`;
      const response = await this.get<ProcessListResult>(url);

      this.logSuccess('Processes listed', `${response.processes.length} processes`);
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
  async getProcess(processId: string, sessionId: string): Promise<ProcessInfoResult> {
    try {
      const url = `/api/process/${processId}?session=${encodeURIComponent(sessionId)}`;
      const response = await this.get<ProcessInfoResult>(url);
      
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
  async killProcess(processId: string, sessionId: string): Promise<ProcessKillResult> {
    try {
      const url = `/api/process/${processId}?session=${encodeURIComponent(sessionId)}`;
      const response = await this.delete<ProcessKillResult>(url);

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
  async killAllProcesses(sessionId: string): Promise<ProcessCleanupResult> {
    try {
      const url = `/api/process/kill-all?session=${encodeURIComponent(sessionId)}`;
      const response = await this.delete<ProcessCleanupResult>(url);

      this.logSuccess(
        'All processes killed',
        `${response.cleanedCount} processes terminated`
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
  async getProcessLogs(processId: string, sessionId: string): Promise<ProcessLogsResult> {
    try {
      const url = `/api/process/${processId}/logs?session=${encodeURIComponent(sessionId)}`;
      const response = await this.get<ProcessLogsResult>(url);

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
