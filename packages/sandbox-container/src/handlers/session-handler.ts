// Session Handler

import { randomBytes } from "node:crypto";
import type { Logger, RequestContext } from '../core/types';
import type { SessionManager } from '../services/session-manager';
import { BaseHandler } from './base-handler';

export class SessionHandler extends BaseHandler<Request, Response> {
  constructor(
    private sessionManager: SessionManager,
    logger: Logger
  ) {
    super(logger);
  }

  async handle(request: Request, context: RequestContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    switch (pathname) {
      case '/api/session/create':
        return await this.handleCreate(request, context);
      case '/api/session/list':
        return await this.handleList(request, context);
      default:
        return this.createErrorResponse('Invalid session endpoint', 404, context);
    }
  }

  private async handleCreate(request: Request, context: RequestContext): Promise<Response> {
    this.logger.info('Creating new session', { requestId: context.requestId });

    // Parse request body for session options
    let sessionId: string;
    let env: Record<string, string>;
    let cwd: string;
    let isolation: boolean;

    try {
      const body = await request.json() as any;
      sessionId = body.id || this.generateSessionId();
      env = body.env || {};
      cwd = body.cwd || '/workspace';
      isolation = body.isolation !== undefined ? body.isolation : true;
    } catch {
      // If no body or invalid JSON, use defaults
      sessionId = this.generateSessionId();
      env = {};
      cwd = '/workspace';
      isolation = true;
    }

    const result = await this.sessionManager.createSession({
      id: sessionId,
      env,
      cwd,
      isolation
    });

    if (result.success) {
      this.logger.info('Session created successfully', {
        requestId: context.requestId,
        sessionId: sessionId
      });

      return new Response(
        JSON.stringify({
          message: 'Session created successfully',
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...context.corsHeaders,
          },
        }
      );
    } else {
      this.logger.error('Session creation failed', undefined, {
        requestId: context.requestId,
        errorCode: result.error!.code,
        errorMessage: result.error!.message,
      });
      return this.createErrorResponse(result.error!, 500, context);
    }
  }

  private async handleList(request: Request, context: RequestContext): Promise<Response> {
    this.logger.info('Listing sessions', { requestId: context.requestId });

    const result = await this.sessionManager.listSessions();

    if (result.success) {
      // SessionManager returns string[] (session IDs)
      const sessionList = result.data!.map(sessionId => ({
        sessionId,
        // We don't have createdAt/activeProcess from SessionManager
        // These would require querying each session individually
      }));

      return new Response(
        JSON.stringify({
          count: sessionList.length,
          sessions: sessionList,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...context.corsHeaders,
          },
        }
      );
    } else {
      this.logger.error('Session listing failed', undefined, {
        requestId: context.requestId,
        errorCode: result.error!.code,
        errorMessage: result.error!.message,
      });
      return this.createErrorResponse(result.error!, 500, context);
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${randomBytes(6).toString('hex')}`;
  }
}
