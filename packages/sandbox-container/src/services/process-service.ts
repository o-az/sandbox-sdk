// Bun-optimized Process Management Service
import type {
  CommandResult,
  Logger,
  ProcessOptions,
  ProcessRecord,
  ProcessStatus,
  ServiceResult
} from '../core/types';
import type { SessionManager } from './session-manager';
import { ProcessManager } from '../managers/process-manager';
import { BunProcessAdapter } from '../adapters/bun-process-adapter';
import type { Subprocess } from 'bun';

export interface ProcessStore {
  create(process: ProcessRecord): Promise<void>;
  get(id: string): Promise<ProcessRecord | null>;
  update(id: string, data: Partial<ProcessRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  list(filters?: ProcessFilters): Promise<ProcessRecord[]>;
  cleanup(olderThan: Date): Promise<number>;
}

export interface ProcessFilters {
  status?: ProcessStatus;
  sessionId?: string;
}

// In-memory implementation optimized for Bun
export class InMemoryProcessStore implements ProcessStore {
  private processes = new Map<string, ProcessRecord>();

  async create(process: ProcessRecord): Promise<void> {
    this.processes.set(process.id, process);
  }

  async get(id: string): Promise<ProcessRecord | null> {
    return this.processes.get(id) || null;
  }

  async update(id: string, data: Partial<ProcessRecord>): Promise<void> {
    const existing = this.processes.get(id);
    if (!existing) {
      throw new Error(`Process ${id} not found`);
    }
    
    const updated = { ...existing, ...data };
    this.processes.set(id, updated);
  }

  async delete(id: string): Promise<void> {
    const process = this.processes.get(id);
    if (process?.subprocess) {
      // Kill the subprocess if it's still running
      try {
        process.subprocess.kill();
      } catch (error) {
        console.warn(`Failed to kill subprocess ${id}:`, error);
      }
    }
    this.processes.delete(id);
  }

  async list(filters?: ProcessFilters): Promise<ProcessRecord[]> {
    let processes = Array.from(this.processes.values());
    
    if (filters) {
      if (filters.status) {
        processes = processes.filter(p => p.status === filters.status);
      }
      if (filters.sessionId) {
        processes = processes.filter(p => p.sessionId === filters.sessionId);
      }
    }
    
    return processes;
  }

  async cleanup(olderThan: Date): Promise<number> {
    let cleaned = 0;
    for (const [id, process] of Array.from(this.processes.entries())) {
      if (process.startTime < olderThan && 
          ['completed', 'failed', 'killed', 'error'].includes(process.status)) {
        await this.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  // Helper methods for testing
  clear(): void {
    // Kill all running processes first
    for (const process of Array.from(this.processes.values())) {
      if (process.subprocess) {
        try {
          process.subprocess.kill();
        } catch (error) {
          console.warn(`Failed to kill subprocess ${process.id}:`, error);
        }
      }
    }
    this.processes.clear();
  }

  size(): number {
    return this.processes.size;
  }
}

export class ProcessService {
  private cleanupInterval: Timer | null = null;
  private manager: ProcessManager;
  private adapter: BunProcessAdapter;

  constructor(
    private store: ProcessStore,
    private logger: Logger,
    private sessionManager?: SessionManager,
    adapter?: BunProcessAdapter  // Injectable for testing
  ) {
    this.manager = new ProcessManager();
    this.adapter = adapter || new BunProcessAdapter();

    // Start cleanup process every 30 minutes
    this.startCleanupProcess();
  }

  async startProcess(command: string, options: ProcessOptions = {}): Promise<ServiceResult<ProcessRecord>> {
    try {
      // 1. Validate command (business logic via manager)
      const validation = this.manager.validateCommand(command);
      if (!validation.valid) {
        return {
          success: false,
          error: {
            message: validation.error || 'Invalid command',
            code: validation.code || 'INVALID_COMMAND',
          },
        };
      }

      // 2. Parse command (business logic via manager)
      const { executable, args } = this.manager.parseCommand(command);

      this.logger.info('Starting process', { command, options });

      // 3. Spawn process (infrastructure via adapter)
      // Filter out undefined values from process.env to match Record<string, string> type
      const envWithoutUndefined = Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined)
      ) as Record<string, string>;

      const spawnResult = this.adapter.spawn(executable, args, {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'pipe',
        cwd: options.cwd || process.cwd(),
        env: { ...envWithoutUndefined, ...options.env },
      });

      // 4. Create process record (business logic via manager)
      const processRecordData = this.manager.createProcessRecord(command, spawnResult.pid, options);

      // 5. Build full process record with subprocess
      const processRecord: ProcessRecord = {
        ...processRecordData,
        subprocess: spawnResult.subprocess,
      };

      // 6. Set up stream handling (infrastructure via adapter)
      this.adapter.handleStreams(spawnResult.subprocess, {
        onStdout: (data) => {
          processRecord.stdout += data;
          processRecord.outputListeners.forEach(listener => listener('stdout', data));
        },
        onStderr: (data) => {
          processRecord.stderr += data;
          processRecord.outputListeners.forEach(listener => listener('stderr', data));
        },
        onExit: (exitCode) => {
          const status = this.manager.interpretExitCode(exitCode);
          const endTime = new Date();

          processRecord.status = status;
          processRecord.endTime = endTime;
          processRecord.exitCode = exitCode;

          processRecord.statusListeners.forEach(listener => listener(status));

          this.store.update(processRecord.id, {
            status,
            endTime,
            exitCode,
          }).catch(error => {
            this.logger.error('Failed to update process status', error, { processId: processRecord.id });
          });

          this.logger.info('Process exited', {
            processId: processRecord.id,
            exitCode,
            status,
            duration: endTime.getTime() - processRecord.startTime.getTime(),
          });
        },
        onError: (error) => {
          processRecord.status = 'error';
          processRecord.endTime = new Date();
          processRecord.statusListeners.forEach(listener => listener('error'));

          this.logger.error('Process error', error, { processId: processRecord.id });
        },
      });

      // 7. Store record (data layer)
      await this.store.create(processRecord);

      this.logger.info('Process started successfully', {
        processId: processRecord.id,
        pid: spawnResult.pid
      });

      return {
        success: true,
        data: processRecord,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to start process', error instanceof Error ? error : undefined, { command, options });

      return {
        success: false,
        error: {
          message: 'Failed to start process',
          code: 'PROCESS_START_ERROR',
          details: { command, originalError: errorMessage },
        },
      };
    }
  }

  async executeCommand(command: string, options: ProcessOptions = {}): Promise<ServiceResult<CommandResult>> {
    try {
      this.logger.info('Executing command', { command, options });

      // If SessionManager is available, use isolated execution
      if (this.sessionManager) {
        const sessionId = options.sessionId || 'default';
        const result = await this.sessionManager.executeInSession(
          sessionId,
          command,
          options.cwd
        );

        if (!result.success) {
          return result as ServiceResult<CommandResult>;
        }

        // Convert RawExecResult to CommandResult
        const commandResult: CommandResult = {
          success: result.data.exitCode === 0,
          exitCode: result.data.exitCode,
          stdout: result.data.stdout,
          stderr: result.data.stderr,
        };

        this.logger.info('Command executed via isolation', {
          command,
          exitCode: commandResult.exitCode,
          success: commandResult.success
        });

        return {
          success: true,
          data: commandResult,
        };
      }

      // Fallback to adapter-based execution if no SessionManager
      // Filter out undefined values from process.env to match Record<string, string> type
      const envWithoutUndefined = Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined)
      ) as Record<string, string>;

      const executionResult = await this.adapter.executeShell(command, {
        cwd: options.cwd || process.cwd(),
        env: { ...envWithoutUndefined, ...options.env },
      });

      const result: CommandResult = {
        success: executionResult.exitCode === 0,
        exitCode: executionResult.exitCode,
        stdout: executionResult.stdout,
        stderr: executionResult.stderr,
      };

      this.logger.info('Command executed (no isolation)', {
        command,
        exitCode: result.exitCode,
        success: result.success
      });

      // Service operation was successful regardless of command exit code
      // Command failure is indicated in CommandResult.success, not ServiceResult.success
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to execute command', error instanceof Error ? error : undefined, { command, options });

      return {
        success: false,
        error: {
          message: 'Failed to execute command',
          code: 'COMMAND_EXEC_ERROR',
          details: { command, originalError: errorMessage },
        },
      };
    }
  }

  async getProcess(id: string): Promise<ServiceResult<ProcessRecord>> {
    try {
      const process = await this.store.get(id);
      
      if (!process) {
        return {
          success: false,
          error: {
            message: `Process ${id} not found`,
            code: 'PROCESS_NOT_FOUND',
          },
        };
      }

      return {
        success: true,
        data: process,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to get process', error instanceof Error ? error : undefined, { processId: id });
      
      return {
        success: false,
        error: {
          message: 'Failed to get process',
          code: 'PROCESS_GET_ERROR',
          details: { processId: id, originalError: errorMessage },
        },
      };
    }
  }

  async killProcess(id: string): Promise<ServiceResult<void>> {
    try {
      const process = await this.store.get(id);

      if (!process) {
        return {
          success: false,
          error: {
            message: `Process ${id} not found`,
            code: 'PROCESS_NOT_FOUND',
          },
        };
      }

      if (process.subprocess) {
        // Use adapter to kill the process
        this.adapter.kill(process.subprocess);

        await this.store.update(id, {
          status: 'killed',
          endTime: new Date()
        });

        this.logger.info('Process killed', { processId: id, pid: process.pid });
      }

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to kill process', error instanceof Error ? error : undefined, { processId: id });

      return {
        success: false,
        error: {
          message: 'Failed to kill process',
          code: 'PROCESS_KILL_ERROR',
          details: { processId: id, originalError: errorMessage },
        },
      };
    }
  }

  async listProcesses(filters?: ProcessFilters): Promise<ServiceResult<ProcessRecord[]>> {
    try {
      const processes = await this.store.list(filters);
      
      return {
        success: true,
        data: processes,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to list processes', error instanceof Error ? error : undefined, { filters });
      
      return {
        success: false,
        error: {
          message: 'Failed to list processes',
          code: 'PROCESS_LIST_ERROR',
          details: { filters, originalError: errorMessage },
        },
      };
    }
  }

  async killAllProcesses(): Promise<ServiceResult<number>> {
    try {
      const processes = await this.store.list({ status: 'running' });
      let killed = 0;
      
      for (const process of processes) {
        const result = await this.killProcess(process.id);
        if (result.success) {
          killed++;
        }
      }

      this.logger.info('Killed all processes', { count: killed });

      return {
        success: true,
        data: killed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to kill all processes', error instanceof Error ? error : undefined);
      
      return {
        success: false,
        error: {
          message: 'Failed to kill all processes',
          code: 'PROCESS_KILL_ALL_ERROR',
          details: { originalError: errorMessage },
        },
      };
    }
  }

  async streamProcessLogs(id: string): Promise<ServiceResult<ReadableStream>> {
    try {
      const process = await this.store.get(id);
      
      if (!process) {
        return {
          success: false,
          error: {
            message: `Process ${id} not found`,
            code: 'PROCESS_NOT_FOUND',
          },
        };
      }

      const stdout = process.subprocess?.stdout;

      // Check if stdout exists and is a ReadableStream (not a file descriptor number)
      if (!stdout || typeof stdout === 'number') {
        return {
          success: false,
          error: {
            message: `Process ${id} has no stdout stream`,
            code: 'NO_STDOUT_STREAM',
          },
        };
      }

      // Return Bun's native readable stream for better performance
      return {
        success: true,
        data: stdout,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to stream process logs', error instanceof Error ? error : undefined, { processId: id });
      
      return {
        success: false,
        error: {
          message: 'Failed to stream process logs',
          code: 'PROCESS_STREAM_ERROR',
          details: { processId: id, originalError: errorMessage },
        },
      };
    }
  }


  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        // Use manager to calculate cleanup cutoff date
        const thirtyMinutesAgo = this.manager.createCleanupCutoffDate(30);
        const cleaned = await this.store.cleanup(thirtyMinutesAgo);
        if (cleaned > 0) {
          this.logger.info('Cleaned up old processes', { count: cleaned });
        }
      } catch (error) {
        this.logger.error('Failed to cleanup processes', error instanceof Error ? error : undefined);
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  // Cleanup method for graceful shutdown
  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Kill all running processes
    const result = await this.killAllProcesses();
    if (result.success) {
      this.logger.info('All processes killed during service shutdown');
    }
  }
}