/**
 * Minimal test worker for integration tests
 *
 * Exposes SDK methods via HTTP endpoints for E2E testing.
 * Uses fixed sandbox ID per request (from sessionId parameter).
 */
import { Sandbox, getSandbox } from '@cloudflare/sandbox';

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
    const url = new URL(request.url);
    const body = await parseBody(request);
    const sessionId = body.sessionId || 'default-test-sandbox';

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

      // Process start
      if (url.pathname === '/api/process/start' && request.method === 'POST') {
        const process = await sandbox.startProcess(body.command);
        return new Response(JSON.stringify(process), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Port exposure
      if (url.pathname === '/api/port/expose' && request.method === 'POST') {
        const preview = await sandbox.exposePort(body.port, { name: body.name });
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
