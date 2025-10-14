// Miscellaneous Handler for ping, commands, etc.
import { ErrorCode } from '@repo/shared/errors';

import type { Logger, RequestContext } from '../core/types';
import { BaseHandler } from './base-handler';

export class MiscHandler extends BaseHandler<Request, Response> {

  async handle(request: Request, context: RequestContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    switch (pathname) {
      case '/':
        return await this.handleRoot(request, context);
      case '/api/ping':
        return await this.handlePing(request, context);
      case '/api/commands':
        return await this.handleCommands(request, context);
      default:
        return this.createServiceResponse({
          success: false,
          error: {
            message: 'Invalid endpoint',
            code: ErrorCode.UNKNOWN_ERROR,
          }
        }, context);
    }
  }

  private async handleRoot(request: Request, context: RequestContext): Promise<Response> {
    return new Response('Hello from Bun server! 🚀', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...context.corsHeaders,
      },
    });
  }

  private async handlePing(request: Request, context: RequestContext): Promise<Response> {
    this.logger.info('Ping request', { requestId: context.requestId });

    return this.createSuccessResponse(
      {
        message: 'pong',
        timestamp: new Date().toISOString(),
        requestId: context.requestId,
      },
      context
    );
  }

  private async handleCommands(request: Request, context: RequestContext): Promise<Response> {
    this.logger.info('Commands request', { requestId: context.requestId });

    return this.createSuccessResponse(
      {
        availableCommands: [
          'ls',
          'pwd',
          'echo',
          'cat',
          'grep',
          'find',
          'whoami',
          'date',
          'uptime',
          'ps',
          'top',
          'df',
          'du',
          'free',
          'node',
          'npm',
          'git',
          'curl',
          'wget',
        ],
        timestamp: new Date().toISOString(),
      },
      context
    );
  }
}