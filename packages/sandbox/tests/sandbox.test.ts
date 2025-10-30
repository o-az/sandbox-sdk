import { Container } from '@cloudflare/containers';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, Sandbox } from '../src/sandbox';

// Mock dependencies before imports
vi.mock('./interpreter', () => ({
  CodeInterpreter: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('@cloudflare/containers', () => {
  const mockSwitchPort = vi.fn((request: Request, port: number) => {
    // Create a new request with the port in the URL path
    const url = new URL(request.url);
    url.pathname = `/proxy/${port}${url.pathname}`;
    return new Request(url, request);
  });

  const MockContainer = class Container {
    ctx: any;
    env: any;
    constructor(ctx: any, env: any) {
      this.ctx = ctx;
      this.env = env;
    }
    async fetch(request: Request): Promise<Response> {
      // Mock implementation - will be spied on in tests
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader?.toLowerCase() === 'websocket') {
        return new Response('WebSocket Upgraded', {
          status: 200,
          headers: {
            'X-WebSocket-Upgraded': 'true',
            Upgrade: 'websocket',
            Connection: 'Upgrade'
          }
        });
      }
      return new Response('Mock Container fetch');
    }
    async containerFetch(request: Request, port: number): Promise<Response> {
      // Mock implementation for HTTP path
      return new Response('Mock Container HTTP fetch');
    }
  };

  return {
    Container: MockContainer,
    getContainer: vi.fn(),
    switchPort: mockSwitchPort
  };
});

describe('Sandbox - Automatic Session Management', () => {
  let sandbox: Sandbox;
  let mockCtx: Partial<DurableObjectState<{}>>;
  let mockEnv: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock DurableObjectState
    mockCtx = {
      storage: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue(new Map())
      } as any,
      blockConcurrencyWhile: vi
        .fn()
        .mockImplementation(
          <T>(callback: () => Promise<T>): Promise<T> => callback()
        ),
      id: {
        toString: () => 'test-sandbox-id',
        equals: vi.fn(),
        name: 'test-sandbox'
      } as any
    };

    mockEnv = {};

    // Create Sandbox instance - SandboxClient is created internally
    const stub = new Sandbox(mockCtx, mockEnv);

    // Wait for blockConcurrencyWhile to complete
    await vi.waitFor(() => {
      expect(mockCtx.blockConcurrencyWhile).toHaveBeenCalled();
    });

    sandbox = Object.assign(stub, {
      wsConnect: connect(stub)
    });

    // Now spy on the client methods that we need for testing
    vi.spyOn(sandbox.client.utils, 'createSession').mockResolvedValue({
      success: true,
      id: 'sandbox-default',
      message: 'Created'
    } as any);

    vi.spyOn(sandbox.client.commands, 'execute').mockResolvedValue({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
      command: '',
      timestamp: new Date().toISOString()
    } as any);

    vi.spyOn(sandbox.client.files, 'writeFile').mockResolvedValue({
      success: true,
      path: '/test.txt',
      timestamp: new Date().toISOString()
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default session management', () => {
    it('should create default session on first operation', async () => {
      vi.mocked(sandbox.client.commands.execute).mockResolvedValueOnce({
        success: true,
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
        command: 'echo test',
        timestamp: new Date().toISOString()
      } as any);

      await sandbox.exec('echo test');

      expect(sandbox.client.utils.createSession).toHaveBeenCalledTimes(1);
      expect(sandbox.client.utils.createSession).toHaveBeenCalledWith({
        id: expect.stringMatching(/^sandbox-/),
        env: {},
        cwd: '/workspace'
      });

      expect(sandbox.client.commands.execute).toHaveBeenCalledWith(
        'echo test',
        expect.stringMatching(/^sandbox-/)
      );
    });

    it('should reuse default session across multiple operations', async () => {
      await sandbox.exec('echo test1');
      await sandbox.writeFile('/test.txt', 'content');
      await sandbox.exec('echo test2');

      expect(sandbox.client.utils.createSession).toHaveBeenCalledTimes(1);

      const firstSessionId = vi.mocked(sandbox.client.commands.execute).mock
        .calls[0][1];
      const fileSessionId = vi.mocked(sandbox.client.files.writeFile).mock
        .calls[0][2];
      const secondSessionId = vi.mocked(sandbox.client.commands.execute).mock
        .calls[1][1];

      expect(firstSessionId).toBe(fileSessionId);
      expect(firstSessionId).toBe(secondSessionId);
    });

    it('should use default session for process management', async () => {
      vi.spyOn(sandbox.client.processes, 'startProcess').mockResolvedValue({
        success: true,
        processId: 'proc-1',
        pid: 1234,
        command: 'sleep 10',
        timestamp: new Date().toISOString()
      } as any);

      vi.spyOn(sandbox.client.processes, 'listProcesses').mockResolvedValue({
        success: true,
        processes: [
          {
            id: 'proc-1',
            pid: 1234,
            command: 'sleep 10',
            status: 'running',
            startTime: new Date().toISOString()
          }
        ],
        timestamp: new Date().toISOString()
      } as any);

      const process = await sandbox.startProcess('sleep 10');
      const processes = await sandbox.listProcesses();

      expect(sandbox.client.utils.createSession).toHaveBeenCalledTimes(1);

      // startProcess uses sessionId (to start process in that session)
      const startSessionId = vi.mocked(sandbox.client.processes.startProcess)
        .mock.calls[0][1];
      expect(startSessionId).toMatch(/^sandbox-/);

      // listProcesses is sandbox-scoped - no sessionId parameter
      const listProcessesCall = vi.mocked(
        sandbox.client.processes.listProcesses
      ).mock.calls[0];
      expect(listProcessesCall).toEqual([]);

      // Verify the started process appears in the list
      expect(process.id).toBe('proc-1');
      expect(processes).toHaveLength(1);
      expect(processes[0].id).toBe('proc-1');
    });

    it('should use default session for git operations', async () => {
      vi.spyOn(sandbox.client.git, 'checkout').mockResolvedValue({
        success: true,
        stdout: 'Cloned successfully',
        stderr: '',
        branch: 'main',
        targetDir: '/workspace/repo',
        timestamp: new Date().toISOString()
      } as any);

      await sandbox.gitCheckout('https://github.com/test/repo.git', {
        branch: 'main'
      });

      expect(sandbox.client.utils.createSession).toHaveBeenCalledTimes(1);
      expect(sandbox.client.git.checkout).toHaveBeenCalledWith(
        'https://github.com/test/repo.git',
        expect.stringMatching(/^sandbox-/),
        { branch: 'main', targetDir: undefined }
      );
    });

    it('should initialize session with sandbox name when available', async () => {
      await sandbox.setSandboxName('my-sandbox');

      await sandbox.exec('pwd');

      expect(sandbox.client.utils.createSession).toHaveBeenCalledWith({
        id: 'sandbox-my-sandbox',
        env: {},
        cwd: '/workspace'
      });
    });
  });

  describe('explicit session creation', () => {
    it('should create isolated execution session', async () => {
      vi.mocked(sandbox.client.utils.createSession).mockResolvedValueOnce({
        success: true,
        id: 'custom-session-123',
        message: 'Created'
      } as any);

      const session = await sandbox.createSession({
        id: 'custom-session-123',
        env: { NODE_ENV: 'test' },
        cwd: '/test'
      });

      expect(sandbox.client.utils.createSession).toHaveBeenCalledWith({
        id: 'custom-session-123',
        env: { NODE_ENV: 'test' },
        cwd: '/test'
      });

      expect(session.id).toBe('custom-session-123');
      expect(session.exec).toBeInstanceOf(Function);
      expect(session.startProcess).toBeInstanceOf(Function);
      expect(session.writeFile).toBeInstanceOf(Function);
      expect(session.gitCheckout).toBeInstanceOf(Function);
    });

    it('should execute operations in specific session context', async () => {
      vi.mocked(sandbox.client.utils.createSession).mockResolvedValueOnce({
        success: true,
        id: 'isolated-session',
        message: 'Created'
      } as any);

      const session = await sandbox.createSession({ id: 'isolated-session' });

      await session.exec('echo test');

      expect(sandbox.client.commands.execute).toHaveBeenCalledWith(
        'echo test',
        'isolated-session'
      );
    });

    it('should isolate multiple explicit sessions', async () => {
      vi.mocked(sandbox.client.utils.createSession)
        .mockResolvedValueOnce({
          success: true,
          id: 'session-1',
          message: 'Created'
        } as any)
        .mockResolvedValueOnce({
          success: true,
          id: 'session-2',
          message: 'Created'
        } as any);

      const session1 = await sandbox.createSession({ id: 'session-1' });
      const session2 = await sandbox.createSession({ id: 'session-2' });

      await session1.exec('echo build');
      await session2.exec('echo test');

      const session1Id = vi.mocked(sandbox.client.commands.execute).mock
        .calls[0][1];
      const session2Id = vi.mocked(sandbox.client.commands.execute).mock
        .calls[1][1];

      expect(session1Id).toBe('session-1');
      expect(session2Id).toBe('session-2');
      expect(session1Id).not.toBe(session2Id);
    });

    it('should not interfere with default session', async () => {
      vi.mocked(sandbox.client.utils.createSession)
        .mockResolvedValueOnce({
          success: true,
          id: 'sandbox-default',
          message: 'Created'
        } as any)
        .mockResolvedValueOnce({
          success: true,
          id: 'explicit-session',
          message: 'Created'
        } as any);

      await sandbox.exec('echo default');

      const explicitSession = await sandbox.createSession({
        id: 'explicit-session'
      });
      await explicitSession.exec('echo explicit');

      await sandbox.exec('echo default-again');

      const defaultSessionId1 = vi.mocked(sandbox.client.commands.execute).mock
        .calls[0][1];
      const explicitSessionId = vi.mocked(sandbox.client.commands.execute).mock
        .calls[1][1];
      const defaultSessionId2 = vi.mocked(sandbox.client.commands.execute).mock
        .calls[2][1];

      expect(defaultSessionId1).toBe('sandbox-default');
      expect(explicitSessionId).toBe('explicit-session');
      expect(defaultSessionId2).toBe('sandbox-default');
      expect(defaultSessionId1).toBe(defaultSessionId2);
      expect(explicitSessionId).not.toBe(defaultSessionId1);
    });

    it('should generate session ID if not provided', async () => {
      vi.mocked(sandbox.client.utils.createSession).mockResolvedValueOnce({
        success: true,
        id: 'session-generated-123',
        message: 'Created'
      } as any);

      await sandbox.createSession();

      expect(sandbox.client.utils.createSession).toHaveBeenCalledWith({
        id: expect.stringMatching(/^session-/),
        env: undefined,
        cwd: undefined
      });
    });
  });

  describe('ExecutionSession operations', () => {
    let session: any;

    beforeEach(async () => {
      vi.mocked(sandbox.client.utils.createSession).mockResolvedValueOnce({
        success: true,
        id: 'test-session',
        message: 'Created'
      } as any);

      session = await sandbox.createSession({ id: 'test-session' });
    });

    it('should execute command with session context', async () => {
      await session.exec('pwd');
      expect(sandbox.client.commands.execute).toHaveBeenCalledWith(
        'pwd',
        'test-session'
      );
    });

    it('should start process with session context', async () => {
      vi.spyOn(sandbox.client.processes, 'startProcess').mockResolvedValue({
        success: true,
        process: {
          id: 'proc-1',
          pid: 1234,
          command: 'sleep 10',
          status: 'running',
          startTime: new Date().toISOString()
        }
      } as any);

      await session.startProcess('sleep 10');

      expect(sandbox.client.processes.startProcess).toHaveBeenCalledWith(
        'sleep 10',
        'test-session',
        { processId: undefined }
      );
    });

    it('should write file with session context', async () => {
      vi.spyOn(sandbox.client.files, 'writeFile').mockResolvedValue({
        success: true,
        path: '/test.txt',
        timestamp: new Date().toISOString()
      } as any);

      await session.writeFile('/test.txt', 'content');

      expect(sandbox.client.files.writeFile).toHaveBeenCalledWith(
        '/test.txt',
        'content',
        'test-session',
        { encoding: undefined }
      );
    });

    it('should perform git checkout with session context', async () => {
      vi.spyOn(sandbox.client.git, 'checkout').mockResolvedValue({
        success: true,
        stdout: 'Cloned',
        stderr: '',
        branch: 'main',
        targetDir: '/workspace/repo',
        timestamp: new Date().toISOString()
      } as any);

      await session.gitCheckout('https://github.com/test/repo.git');

      expect(sandbox.client.git.checkout).toHaveBeenCalledWith(
        'https://github.com/test/repo.git',
        'test-session',
        { branch: undefined, targetDir: undefined }
      );
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle session creation errors gracefully', async () => {
      vi.mocked(sandbox.client.utils.createSession).mockRejectedValueOnce(
        new Error('Session creation failed')
      );

      await expect(sandbox.exec('echo test')).rejects.toThrow(
        'Session creation failed'
      );
    });

    it('should initialize with empty environment when not set', async () => {
      await sandbox.exec('pwd');

      expect(sandbox.client.utils.createSession).toHaveBeenCalledWith({
        id: expect.any(String),
        env: {},
        cwd: '/workspace'
      });
    });

    it('should use updated environment after setEnvVars', async () => {
      await sandbox.setEnvVars({ NODE_ENV: 'production', DEBUG: 'true' });

      await sandbox.exec('env');

      expect(sandbox.client.utils.createSession).toHaveBeenCalledWith({
        id: expect.any(String),
        env: { NODE_ENV: 'production', DEBUG: 'true' },
        cwd: '/workspace'
      });
    });
  });

  describe('port exposure - workers.dev detection', () => {
    beforeEach(async () => {
      await sandbox.setSandboxName('test-sandbox');
      vi.spyOn(sandbox.client.ports, 'exposePort').mockResolvedValue({
        success: true,
        port: 8080,
        name: 'test-service',
        exposedAt: new Date().toISOString()
      } as any);
    });

    it('should reject workers.dev domains with CustomDomainRequiredError', async () => {
      const hostnames = [
        'my-worker.workers.dev',
        'my-worker.my-account.workers.dev'
      ];

      for (const hostname of hostnames) {
        try {
          await sandbox.exposePort(8080, { name: 'test', hostname });
          // Should not reach here
          expect.fail('Should have thrown CustomDomainRequiredError');
        } catch (error: any) {
          expect(error.name).toBe('CustomDomainRequiredError');
          expect(error.code).toBe('CUSTOM_DOMAIN_REQUIRED');
          expect(error.message).toContain('workers.dev');
          expect(error.message).toContain('custom domain');
        }
      }

      // Verify client method was never called
      expect(sandbox.client.ports.exposePort).not.toHaveBeenCalled();
    });

    it('should accept custom domains and subdomains', async () => {
      const testCases = [
        { hostname: 'example.com', description: 'apex domain' },
        { hostname: 'sandbox.example.com', description: 'subdomain' }
      ];

      for (const { hostname } of testCases) {
        const result = await sandbox.exposePort(8080, {
          name: 'test',
          hostname
        });
        expect(result.url).toContain(hostname);
        expect(result.port).toBe(8080);
      }
    });

    it('should accept localhost for local development', async () => {
      const result = await sandbox.exposePort(8080, {
        name: 'test',
        hostname: 'localhost:8787'
      });

      expect(result.url).toContain('localhost');
      expect(sandbox.client.ports.exposePort).toHaveBeenCalled();
    });
  });

  describe('fetch() override - WebSocket detection', () => {
    let superFetchSpy: any;

    beforeEach(async () => {
      await sandbox.setSandboxName('test-sandbox');

      // Spy on Container.prototype.fetch to verify WebSocket routing
      superFetchSpy = vi
        .spyOn(Container.prototype, 'fetch')
        .mockResolvedValue(new Response('WebSocket response'));
    });

    afterEach(() => {
      superFetchSpy?.mockRestore();
    });

    it('should detect WebSocket upgrade header and route to super.fetch', async () => {
      const request = new Request('https://example.com/ws', {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade'
        }
      });

      const response = await sandbox.fetch(request);

      // Should route through super.fetch() for WebSocket
      expect(superFetchSpy).toHaveBeenCalledTimes(1);
      expect(await response.text()).toBe('WebSocket response');
    });

    it('should route non-WebSocket requests through containerFetch', async () => {
      // GET request
      const getRequest = new Request('https://example.com/api/data');
      await sandbox.fetch(getRequest);
      expect(superFetchSpy).not.toHaveBeenCalled();

      vi.clearAllMocks();

      // POST request
      const postRequest = new Request('https://example.com/api/data', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
        headers: { 'Content-Type': 'application/json' }
      });
      await sandbox.fetch(postRequest);
      expect(superFetchSpy).not.toHaveBeenCalled();

      vi.clearAllMocks();

      // SSE request (should not be detected as WebSocket)
      const sseRequest = new Request('https://example.com/events', {
        headers: { Accept: 'text/event-stream' }
      });
      await sandbox.fetch(sseRequest);
      expect(superFetchSpy).not.toHaveBeenCalled();
    });

    it('should preserve WebSocket request unchanged when calling super.fetch()', async () => {
      const request = new Request('https://example.com/ws', {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade',
          'Sec-WebSocket-Key': 'test-key-123',
          'Sec-WebSocket-Version': '13'
        }
      });

      await sandbox.fetch(request);

      expect(superFetchSpy).toHaveBeenCalledTimes(1);
      const passedRequest = superFetchSpy.mock.calls[0][0] as Request;
      expect(passedRequest.headers.get('Upgrade')).toBe('websocket');
      expect(passedRequest.headers.get('Connection')).toBe('Upgrade');
      expect(passedRequest.headers.get('Sec-WebSocket-Key')).toBe(
        'test-key-123'
      );
      expect(passedRequest.headers.get('Sec-WebSocket-Version')).toBe('13');
    });
  });

  describe('wsConnect() method', () => {
    it('should route WebSocket request through switchPort to sandbox.fetch', async () => {
      const { switchPort } = await import('@cloudflare/containers');
      const switchPortMock = vi.mocked(switchPort);

      const request = new Request('http://localhost/ws/echo', {
        headers: {
          Upgrade: 'websocket',
          Connection: 'Upgrade'
        }
      });

      const fetchSpy = vi.spyOn(sandbox, 'fetch');
      const response = await sandbox.wsConnect(request, 8080);

      // Verify switchPort was called with correct port
      expect(switchPortMock).toHaveBeenCalledWith(request, 8080);

      // Verify fetch was called with the switched request
      expect(fetchSpy).toHaveBeenCalledOnce();

      // Verify response indicates WebSocket upgrade
      expect(response.status).toBe(200);
      expect(response.headers.get('X-WebSocket-Upgraded')).toBe('true');
    });

    it('should reject invalid ports with SecurityError', async () => {
      const request = new Request('http://localhost/ws/test', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' }
      });

      // Invalid port values
      await expect(sandbox.wsConnect(request, -1)).rejects.toThrow(
        'Invalid or restricted port'
      );
      await expect(sandbox.wsConnect(request, 0)).rejects.toThrow(
        'Invalid or restricted port'
      );
      await expect(sandbox.wsConnect(request, 70000)).rejects.toThrow(
        'Invalid or restricted port'
      );

      // Privileged ports
      await expect(sandbox.wsConnect(request, 80)).rejects.toThrow(
        'Invalid or restricted port'
      );
      await expect(sandbox.wsConnect(request, 443)).rejects.toThrow(
        'Invalid or restricted port'
      );
    });

    it('should preserve request properties through routing', async () => {
      const request = new Request(
        'http://localhost/ws/test?token=abc&room=lobby',
        {
          headers: {
            Upgrade: 'websocket',
            Connection: 'Upgrade',
            'X-Custom-Header': 'custom-value'
          }
        }
      );

      const fetchSpy = vi.spyOn(sandbox, 'fetch');
      await sandbox.wsConnect(request, 8080);

      const calledRequest = fetchSpy.mock.calls[0][0];

      // Verify headers are preserved
      expect(calledRequest.headers.get('Upgrade')).toBe('websocket');
      expect(calledRequest.headers.get('X-Custom-Header')).toBe('custom-value');

      // Verify query parameters are preserved
      const url = new URL(calledRequest.url);
      expect(url.searchParams.get('token')).toBe('abc');
      expect(url.searchParams.get('room')).toBe('lobby');
    });
  });
});
