import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { BunProcessAdapter } from '@sandbox-container/adapters/bun-process-adapter.ts';
import type { Subprocess } from 'bun';

describe('BunProcessAdapter (Integration)', () => {
  let adapter: BunProcessAdapter;
  const spawnedProcesses: Subprocess[] = [];

  beforeEach(() => {
    adapter = new BunProcessAdapter();
  });

  afterEach(() => {
    for (const subprocess of spawnedProcesses) {
      try {
        if (adapter.isRunning(subprocess)) {
          subprocess.kill();
        }
      } catch (error) {}
    }
    spawnedProcesses.length = 0;
  });

  describe('spawn', () => {
    it('should spawn a process and return pid', () => {
      const result = adapter.spawn('echo', ['hello']);
      spawnedProcesses.push(result.subprocess);
      expect(result.pid).toBeGreaterThan(0);
      expect(result.subprocess).toBeDefined();
    });

    it('should spawn process with custom cwd', () => {
      const result = adapter.spawn('pwd', [], { cwd: '/tmp' });
      spawnedProcesses.push(result.subprocess);
      expect(result.pid).toBeGreaterThan(0);
    });

    it('should spawn process with custom env', () => {
      const result = adapter.spawn('echo', ['$TEST_VAR'], {
        env: { TEST_VAR: 'test-value' },
      });
      spawnedProcesses.push(result.subprocess);
      expect(result.subprocess).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute command and return output', async () => {
      const result = await adapter.execute('echo', ['hello world']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello world');
      expect(result.stderr).toBe('');
    });

    it('should execute command that writes to stderr', async () => {
      const result = await adapter.execute('sh', ['-c', 'echo error >&2']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('error');
    });

    it('should return correct exit codes', async () => {
      const failResult = await adapter.execute('false', []);
      expect(failResult.exitCode).toBe(1);
      const successResult = await adapter.execute('true', []);
      expect(successResult.exitCode).toBe(0);
    });

    it('should execute command with custom cwd', async () => {
      const result = await adapter.execute('pwd', [], { cwd: '/tmp' });
      expect(result.exitCode).toBe(0);
      // macOS symlinks /tmp to /private/tmp
      expect(result.stdout.trim()).toMatch(/\/tmp$/);
    });
  });

  describe('executeShell', () => {
    it('should execute shell commands with pipes, redirects, and substitution', async () => {
      const pipeResult = await adapter.executeShell('echo hello | cat');
      expect(pipeResult.exitCode).toBe(0);
      expect(pipeResult.stdout).toContain('hello');
      const redirectResult = await adapter.executeShell('echo test 2>&1');
      expect(redirectResult.exitCode).toBe(0);
      expect(redirectResult.stdout).toContain('test');
      const substResult = await adapter.executeShell('echo $(echo nested)');
      expect(substResult.exitCode).toBe(0);
      expect(substResult.stdout).toContain('nested');
    });
  });

  describe('readStream', () => {
    it('should read entire stream as string', async () => {
      const { subprocess } = adapter.spawn('echo', ['test output']);
      spawnedProcesses.push(subprocess);
      const output = await adapter.readStream(subprocess.stdout);
      expect(output).toContain('test output');
    });

    it('should return empty string for undefined stream', async () => {
      const output = await adapter.readStream(undefined);
      expect(output).toBe('');
    });

    it('should handle large output', async () => {
      const { subprocess } = adapter.spawn('sh', [
        '-c',
        'for i in {1..1000}; do echo "Line $i"; done',
      ]);
      spawnedProcesses.push(subprocess);
      const output = await adapter.readStream(subprocess.stdout);
      expect(output).toContain('Line 1');
      expect(output).toContain('Line 1000');
    });
  });

  describe('streamOutput', () => {
    it('should stream output with callbacks', async () => {
      const chunks: string[] = [];
      const { subprocess } = adapter.spawn('echo', ['streaming test']);
      spawnedProcesses.push(subprocess);
      await adapter.streamOutput(subprocess.stdout, (data) => {
        chunks.push(data);
      });
      const fullOutput = chunks.join('');
      expect(fullOutput).toContain('streaming test');
    });

    it('should handle undefined stream', async () => {
      const chunks: string[] = [];
      await adapter.streamOutput(undefined, (data) => {
        chunks.push(data);
      });
      expect(chunks).toHaveLength(0);
    });
  });

  describe('handleStreams', () => {
    it('should call stdout handler', async () => {
      const stdoutChunks: string[] = [];
      const { subprocess } = adapter.spawn('echo', ['test']);
      spawnedProcesses.push(subprocess);
      const cleanup = adapter.handleStreams(subprocess, {
        onStdout: (data) => stdoutChunks.push(data),
      });
      await subprocess.exited;
      cleanup();
      const fullOutput = stdoutChunks.join('');
      expect(fullOutput).toContain('test');
    });

    it('should call stderr handler', async () => {
      const stderrChunks: string[] = [];
      const { subprocess } = adapter.spawn('sh', ['-c', 'echo error >&2']);
      spawnedProcesses.push(subprocess);
      const cleanup = adapter.handleStreams(subprocess, {
        onStderr: (data) => stderrChunks.push(data),
      });
      await subprocess.exited;
      cleanup();
      const fullOutput = stderrChunks.join('');
      expect(fullOutput).toContain('error');
    });

    it('should call exit handler with correct codes', async () => {
      let exitCodeSuccess: number | undefined;
      const { subprocess: successProcess } = adapter.spawn('true', []);
      spawnedProcesses.push(successProcess);
      const cleanup1 = adapter.handleStreams(successProcess, {
        onExit: (code) => { exitCodeSuccess = code; },
      });
      await successProcess.exited;
      cleanup1();
      expect(exitCodeSuccess).toBe(0);

      let exitCodeFail: number | undefined;
      const { subprocess: failProcess } = adapter.spawn('false', []);
      spawnedProcesses.push(failProcess);
      const cleanup2 = adapter.handleStreams(failProcess, {
        onExit: (code) => { exitCodeFail = code; },
      });
      await failProcess.exited;
      cleanup2();
      expect(exitCodeFail).toBe(1);
    });
  });

  describe('waitForExit', () => {
    it('should wait for process to exit and return correct results', async () => {
      const { subprocess: echoProcess } = adapter.spawn('echo', ['wait test']);
      spawnedProcesses.push(echoProcess);
      const successResult = await adapter.waitForExit(echoProcess);
      expect(successResult.exitCode).toBe(0);
      expect(successResult.stdout).toContain('wait test');

      const { subprocess: failProcess } = adapter.spawn('false', []);
      spawnedProcesses.push(failProcess);
      const failResult = await adapter.waitForExit(failProcess);
      expect(failResult.exitCode).toBe(1);
    });
  });

  describe('kill', () => {
    it('should kill a running process and wait for exit', async () => {
      const { subprocess } = adapter.spawn('sleep', ['10']);
      spawnedProcesses.push(subprocess);
      const killed = adapter.kill(subprocess);
      expect(killed).toBe(true);
      await subprocess.exited;
      expect(subprocess.exitCode).toBeDefined();
    });
  });
});
