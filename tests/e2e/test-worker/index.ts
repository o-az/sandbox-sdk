/**
 * Minimal test worker for integration tests
 *
 * Exposes SDK methods via HTTP endpoints for E2E testing.
 * Supports both default sessions (implicit) and explicit sessions via X-Session-Id header.
 */
import { Sandbox, getSandbox, proxyToSandbox } from '@cloudflare/sandbox';
import type { ExecutionSession } from '@repo/shared-types';

export { Sandbox };

interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
}

async function parseBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Store explicit sessions by ID
// Key: `${sandboxId}:${sessionId}` to namespace sessions per sandbox
const sessions = new Map<string, ExecutionSession>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route requests to exposed container ports via their preview URLs
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    const url = new URL(request.url);
    const body = await parseBody(request);

    // Get sandbox ID from header
    // Sandbox ID determines which container instance (Durable Object)
    const sandboxId = request.headers.get('X-Sandbox-Id') || 'default-test-sandbox';
    const sandbox = getSandbox(env.Sandbox, sandboxId);

    // Get session ID from header (optional)
    // If provided, use explicit session instead of default sandbox session
    const sessionId = request.headers.get('X-Session-Id');
    const sessionKey = sessionId ? `${sandboxId}:${sessionId}` : null;

    // Executor pattern: use session if specified, otherwise use sandbox
    // ExecutionSession has same API as Sandbox (except port/session management)
    const executor = (sessionKey && sessions.get(sessionKey)) || sandbox;

    try {
      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Session management
      if (url.pathname === '/api/session/create' && request.method === 'POST') {
        const session = await sandbox.createSession(body);
        const sessionKey = `${sandboxId}:${session.id}`;
        sessions.set(sessionKey, session);
        return new Response(JSON.stringify({ success: true, sessionId: session.id }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Command execution (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/execute' && request.method === 'POST') {
        const result = await executor.exec(body.command);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Git clone (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/git/clone' && request.method === 'POST') {
        await executor.gitCheckout(body.repoUrl, {
          branch: body.branch,
          targetDir: body.targetDir,
        });
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File read (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/file/read' && request.method === 'POST') {
        const file = await executor.readFile(body.path);
        return new Response(JSON.stringify(file), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File write (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/file/write' && request.method === 'POST') {
        await executor.writeFile(body.path, body.content);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File mkdir (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/file/mkdir' && request.method === 'POST') {
        await executor.mkdir(body.path, { recursive: body.recursive });
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File delete (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/file/delete' && request.method === 'DELETE') {
        await executor.deleteFile(body.path);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File rename (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/file/rename' && request.method === 'POST') {
        await executor.renameFile(body.oldPath, body.newPath);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File move (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/file/move' && request.method === 'POST') {
        await executor.moveFile(body.sourcePath, body.destinationPath);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Process start (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/process/start' && request.method === 'POST') {
        const process = await executor.startProcess(body.command);
        return new Response(JSON.stringify(process), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Process list (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/process/list' && request.method === 'GET') {
        const processes = await executor.listProcesses();
        return new Response(JSON.stringify(processes), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Process get by ID (works with both sandbox and explicit sessions)
      if (url.pathname.startsWith('/api/process/') && request.method === 'GET') {
        const pathParts = url.pathname.split('/');
        const processId = pathParts[3];

        // Handle /api/process/:id/logs
        if (pathParts[4] === 'logs') {
          const logs = await executor.getProcessLogs(processId);
          return new Response(JSON.stringify(logs), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Handle /api/process/:id/stream (SSE)
        if (pathParts[4] === 'stream') {
          const stream = await executor.streamProcessLogs(processId);

          // Convert AsyncIterable to ReadableStream for SSE
          const readableStream = new ReadableStream({
            async start(controller) {
              try {
                for await (const event of stream) {
                  const sseData = `data: ${JSON.stringify(event)}\n\n`;
                  controller.enqueue(new TextEncoder().encode(sseData));
                }
                controller.close();
              } catch (error) {
                controller.error(error);
              }
            },
          });

          return new Response(readableStream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          });
        }

        // Handle /api/process/:id (get single process)
        if (!pathParts[4]) {
          const process = await executor.getProcess(processId);
          return new Response(JSON.stringify(process), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Process kill by ID (works with both sandbox and explicit sessions)
      if (url.pathname.startsWith('/api/process/') && request.method === 'DELETE') {
        const processId = url.pathname.split('/')[3];
        await executor.killProcess(processId);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Kill all processes (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/process/kill-all' && request.method === 'POST') {
        await executor.killAllProcesses();
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Port exposure (ONLY works with sandbox - sessions don't expose ports)
      if (url.pathname === '/api/port/expose' && request.method === 'POST') {
        if (sessionKey) {
          return new Response(JSON.stringify({
            error: 'Port exposure not supported for explicit sessions. Use default sandbox.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // Extract hostname from the request
        const hostname = url.hostname + (url.port ? `:${url.port}` : '');
        const preview = await sandbox.exposePort(body.port, {
          name: body.name,
          hostname: hostname,
        });
        return new Response(JSON.stringify(preview), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Port unexpose (ONLY works with sandbox - sessions don't expose ports)
      if (url.pathname.startsWith('/api/exposed-ports/') && request.method === 'DELETE') {
        if (sessionKey) {
          return new Response(JSON.stringify({
            error: 'Port exposure not supported for explicit sessions. Use default sandbox.'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const pathParts = url.pathname.split('/');
        const port = parseInt(pathParts[3], 10);
        if (!isNaN(port)) {
          await sandbox.unexposePort(port);
          return new Response(JSON.stringify({ success: true, port }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Environment variables (works with both sandbox and explicit sessions)
      if (url.pathname === '/api/env/set' && request.method === 'POST') {
        await executor.setEnvVars(body.envVars);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
