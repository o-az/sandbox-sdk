/**
 * Minimal test worker for integration tests
 *
 * Exposes SDK methods via HTTP endpoints for E2E testing.
 * Uses fixed sandbox ID per request (from sessionId parameter).
 */
import { Sandbox, getSandbox, proxyToSandbox } from '@cloudflare/sandbox';

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route requests to exposed container ports via their preview URLs
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    const url = new URL(request.url);
    const body = await parseBody(request);

    // Support sessionId from query params (for GET requests) or body (for POST/DELETE)
    const sessionId = url.searchParams.get('sessionId') || body.sessionId || 'default-test-sandbox';

    const sandbox = getSandbox(env.Sandbox, sessionId);

    try {
      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Command execution
      if (url.pathname === '/api/execute' && request.method === 'POST') {
        const result = await sandbox.exec(body.command);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Git clone
      if (url.pathname === '/api/git/clone' && request.method === 'POST') {
        await sandbox.gitCheckout(body.repoUrl, {
          branch: body.branch,
          targetDir: body.targetDir,
        });
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File read
      if (url.pathname === '/api/file/read' && request.method === 'POST') {
        const file = await sandbox.readFile(body.path);
        return new Response(JSON.stringify(file), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File write
      if (url.pathname === '/api/file/write' && request.method === 'POST') {
        await sandbox.writeFile(body.path, body.content);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File mkdir
      if (url.pathname === '/api/file/mkdir' && request.method === 'POST') {
        await sandbox.mkdir(body.path, { recursive: body.recursive });
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File delete
      if (url.pathname === '/api/file/delete' && request.method === 'DELETE') {
        await sandbox.deleteFile(body.path);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File rename
      if (url.pathname === '/api/file/rename' && request.method === 'POST') {
        await sandbox.renameFile(body.oldPath, body.newPath);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // File move
      if (url.pathname === '/api/file/move' && request.method === 'POST') {
        await sandbox.moveFile(body.sourcePath, body.destinationPath);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Process start
      if (url.pathname === '/api/process/start' && request.method === 'POST') {
        const process = await sandbox.startProcess(body.command);
        return new Response(JSON.stringify(process), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Process list
      if (url.pathname === '/api/process/list' && request.method === 'GET') {
        const processes = await sandbox.listProcesses();
        return new Response(JSON.stringify(processes), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Process get by ID
      if (url.pathname.startsWith('/api/process/') && request.method === 'GET') {
        const pathParts = url.pathname.split('/');
        const processId = pathParts[3];

        // Handle /api/process/:id/logs
        if (pathParts[4] === 'logs') {
          const logs = await sandbox.getProcessLogs(processId);
          return new Response(JSON.stringify(logs), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Handle /api/process/:id/stream (SSE)
        if (pathParts[4] === 'stream') {
          const stream = await sandbox.streamProcessLogs(processId);

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
          const process = await sandbox.getProcess(processId);
          return new Response(JSON.stringify(process), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Process kill by ID
      if (url.pathname.startsWith('/api/process/') && request.method === 'DELETE') {
        const processId = url.pathname.split('/')[3];
        await sandbox.killProcess(processId);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Kill all processes
      if (url.pathname === '/api/process/kill-all' && request.method === 'POST') {
        await sandbox.killAllProcesses();
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Port exposure
      if (url.pathname === '/api/port/expose' && request.method === 'POST') {
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
