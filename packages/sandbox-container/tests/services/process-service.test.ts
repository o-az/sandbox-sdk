import type { Mock } from 'bun:test';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { BunProcessAdapter, ExecutionResult, SpawnOptions, SpawnResult, StreamHandlers } from '@sandbox-container/adapters/bun-process-adapter.ts';
import type { Logger, ProcessOptions, ProcessRecord } from '@sandbox-container/core/types.ts';
import type { ProcessFilters, ProcessService, ProcessStore } from '@sandbox-container/services/process-service.ts';
import type { Subprocess } from 'bun';

// Mock the dependencies with proper typing
const mockProcessStore: ProcessStore = {
  create: vi.fn() as Mock<(process: ProcessRecord) => Promise<void>>,
  get: vi.fn() as Mock<(id: string) => Promise<ProcessRecord | null>>,
  update: vi.fn() as Mock<(id: string, data: Partial<ProcessRecord>) => Promise<void>>,
  delete: vi.fn() as Mock<(id: string) => Promise<void>>,
  list: vi.fn() as Mock<(filters?: ProcessFilters) => Promise<ProcessRecord[]>>,
  cleanup: vi.fn() as Mock<(olderThan: Date) => Promise<number>>,
};

const mockLogger: Logger = {
  info: vi.fn() as Mock<(message: string, meta?: Record<string, unknown>) => void>,
  error: vi.fn() as Mock<(message: string, error?: Error, meta?: Record<string, unknown>) => void>,
  warn: vi.fn() as Mock<(message: string, meta?: Record<string, unknown>) => void>,
  debug: vi.fn() as Mock<(message: string, meta?: Record<string, unknown>) => void>,
};

// Mock adapter with proper typing - this is the key difference from the old approach
const mockAdapter: BunProcessAdapter = {
  spawn: vi.fn() as Mock<(executable: string, args: string[], options?: SpawnOptions) => SpawnResult>,
  execute: vi.fn() as Mock<(executable: string, args: string[], options?: SpawnOptions) => Promise<ExecutionResult>>,
  executeShell: vi.fn() as Mock<(command: string, options?: SpawnOptions) => Promise<ExecutionResult>>,
  readStream: vi.fn() as Mock<(stream: ReadableStream | undefined) => Promise<string>>,
  streamOutput: vi.fn() as Mock<(stream: ReadableStream | undefined, onData: (data: string) => void) => Promise<void>>,
  handleStreams: vi.fn() as Mock<(subprocess: Subprocess, handlers: StreamHandlers) => () => void>,
  waitForExit: vi.fn() as Mock<(subprocess: Subprocess) => Promise<ExecutionResult>>,
  kill: vi.fn() as Mock<(subprocess: Subprocess, signal?: number) => boolean>,
  isRunning: vi.fn() as Mock<(subprocess: Subprocess) => boolean>,
};

// Mock factory functions
const createMockProcess = (overrides: Partial<ProcessRecord> = {}): ProcessRecord => ({
  id: 'proc-123',
  command: 'test command',
  status: 'running',
  startTime: new Date(),
  pid: 12345,
  stdout: '',
  stderr: '',
  outputListeners: new Set(),
  statusListeners: new Set(),
  ...overrides,
});

const createMockSubprocess = (overrides: Partial<Subprocess> = {}): Subprocess => ({
  pid: 12345,
  exitCode: undefined,
  kill: vi.fn(),
  exited: new Promise(() => {}),
  ...overrides,
} as Subprocess);

describe('ProcessService', () => {
  let ProcessServiceClass: typeof ProcessService;
  let processService: ProcessService;

  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Import the ProcessService (dynamic import for fresh module)
    const module = await import('@sandbox-container/services/process-service.ts');
    ProcessServiceClass = module.ProcessService;

    // Create service with mocked adapter
    processService = new ProcessServiceClass(
      mockProcessStore,
      mockLogger,
      undefined,  // No session manager
      mockAdapter // Inject mocked adapter
    );
  });

  describe('executeCommand', () => {
    it('should execute command and return success', async () => {
      // Mock adapter to return successful execution
      (mockAdapter.executeShell as Mock).mockResolvedValue({
        exitCode: 0,
        stdout: 'hello world\n',
        stderr: '',
      });

      const result = await processService.executeCommand('echo "hello world"', {
        cwd: '/tmp',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(true);
        expect(result.data.exitCode).toBe(0);
        expect(result.data.stdout).toBe('hello world\n');
        expect(result.data.stderr).toBe('');
      }

      // Verify adapter was called correctly
      expect(mockAdapter.executeShell).toHaveBeenCalledWith(
        'echo "hello world"',
        expect.objectContaining({
          cwd: '/tmp',
        })
      );
    });

    it('should handle command with non-zero exit code', async () => {
      (mockAdapter.executeShell as Mock).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'error message',
      });

      const result = await processService.executeCommand('false');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.success).toBe(false);
        expect(result.data.exitCode).toBe(1);
      }
    });

    it('should handle adapter errors', async () => {
      (mockAdapter.executeShell as Mock).mockRejectedValue(new Error('Spawn failed'));

      const result = await processService.executeCommand('some command');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('COMMAND_EXEC_ERROR');
        expect(result.error.message).toBe('Failed to execute command');
      }
    });
  });

  describe('startProcess', () => {
    it('should start background process successfully', async () => {
      const mockSubprocess: Subprocess = {
        pid: 12345,
        exitCode: undefined,
        kill: vi.fn() as Mock<(signal?: number) => void>,
        exited: new Promise(() => {}), // Never resolves (background process)
      } as Subprocess;

      (mockAdapter.spawn as Mock).mockReturnValue({
        pid: 12345,
        subprocess: mockSubprocess,
      });

      (mockAdapter.handleStreams as Mock).mockReturnValue(() => {});

      const result = await processService.startProcess('sleep 10', {
        cwd: '/tmp',
        sessionId: 'session-123',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toMatch(/^proc_\d+_[a-z0-9]+$/);
        expect(result.data.command).toBe('sleep 10');
        expect(result.data.status).toBe('running');
        expect(result.data.pid).toBe(12345);
        expect(result.data.sessionId).toBe('session-123');
      }

      // Verify adapter was called correctly
      expect(mockAdapter.spawn).toHaveBeenCalledWith(
        'sleep',
        ['10'],
        expect.objectContaining({
          cwd: '/tmp',
        })
      );

      // Verify process was stored
      expect(mockProcessStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'sleep 10',
          status: 'running',
          pid: 12345,
          sessionId: 'session-123',
        })
      );

      // Verify stream handling was set up
      expect(mockAdapter.handleStreams).toHaveBeenCalled();
    });

    it('should reject empty command', async () => {
      const result = await processService.startProcess('', {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_COMMAND');
        expect(result.error.message).toContain('empty command');
      }

      // Verify adapter was not called
      expect(mockAdapter.spawn).not.toHaveBeenCalled();
    });

    it('should handle spawn errors', async () => {
      (mockAdapter.spawn as Mock).mockImplementation(() => {
        throw new Error('Failed to spawn');
      });

      const result = await processService.startProcess('echo test', {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PROCESS_START_ERROR');
        expect(result.error.message).toBe('Failed to start process');
      }
    });
  });

  describe('getProcess', () => {
    it('should return process from store', async () => {
      const mockProcess = createMockProcess({ command: 'sleep 5' });

      (mockProcessStore.get as Mock).mockResolvedValue(mockProcess);

      const result = await processService.getProcess('proc-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(mockProcess);
      }
      expect(mockProcessStore.get).toHaveBeenCalledWith('proc-123');
    });

    it('should return error when process not found', async () => {
      (mockProcessStore.get as Mock).mockResolvedValue(null);

      const result = await processService.getProcess('nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PROCESS_NOT_FOUND');
        expect(result.error.message).toContain('Process nonexistent not found');
      }
    });
  });

  describe('killProcess', () => {
    it('should kill process and update store', async () => {
      const mockSubprocess = createMockSubprocess();
      const mockProcess = createMockProcess({
        command: 'sleep 10',
        subprocess: mockSubprocess,
      });

      (mockProcessStore.get as Mock).mockResolvedValue(mockProcess);
      (mockAdapter.kill as Mock).mockReturnValue(true);

      const result = await processService.killProcess('proc-123');

      expect(result.success).toBe(true);

      // Verify adapter kill was called
      expect(mockAdapter.kill).toHaveBeenCalledWith(mockSubprocess);

      // Verify store was updated
      expect(mockProcessStore.update).toHaveBeenCalledWith('proc-123', {
        status: 'killed',
        endTime: expect.any(Date),
      });
    });

    it('should return error when process not found', async () => {
      (mockProcessStore.get as Mock).mockResolvedValue(null);

      const result = await processService.killProcess('nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PROCESS_NOT_FOUND');
      }
    });
  });

  describe('listProcesses', () => {
    it('should return all processes from store', async () => {
      const mockProcesses = [
        createMockProcess({ id: 'proc-1', command: 'ls', status: 'completed', pid: 100 }),
        createMockProcess({ id: 'proc-2', command: 'sleep 10', status: 'running', pid: 200 }),
      ];

      (mockProcessStore.list as Mock).mockResolvedValue(mockProcesses);

      const result = await processService.listProcesses();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(mockProcesses);
      }
    });
  });

  describe('killAllProcesses', () => {
    it('should kill all running processes', async () => {
      const mockSubprocess1 = createMockSubprocess({ pid: 100 });
      const mockSubprocess2 = createMockSubprocess({ pid: 200 });

      const mockProcesses = [
        createMockProcess({ id: 'proc-1', command: 'sleep 10', pid: 100, subprocess: mockSubprocess1 }),
        createMockProcess({ id: 'proc-2', command: 'sleep 20', pid: 200, subprocess: mockSubprocess2 }),
      ];

      (mockProcessStore.list as Mock).mockResolvedValue(mockProcesses);
      (mockProcessStore.get as Mock)
        .mockResolvedValueOnce(mockProcesses[0])
        .mockResolvedValueOnce(mockProcesses[1]);
      (mockAdapter.kill as Mock).mockReturnValue(true);

      const result = await processService.killAllProcesses();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(2); // Killed 2 processes
      }
    });
  });
});
