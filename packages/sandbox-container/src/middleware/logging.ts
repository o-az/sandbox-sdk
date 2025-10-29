// Logging Middleware
import type { Logger } from '@repo/shared';
import type { Middleware, NextFunction, RequestContext } from '../core/types';

export class LoggingMiddleware implements Middleware {
  constructor(private logger: Logger) {}

  async handle(
    request: Request,
    context: RequestContext,
    next: NextFunction
  ): Promise<Response> {
    const startTime = Date.now();
    const method = request.method;
    const pathname = new URL(request.url).pathname;

    this.logger.info('Request started', {
      requestId: context.requestId,
      method,
      pathname,
      sessionId: context.sessionId,
      timestamp: context.timestamp.toISOString()
    });

    try {
      const response = await next();
      const duration = Date.now() - startTime;

      this.logger.info('Request completed', {
        requestId: context.requestId,
        method,
        pathname,
        status: response.status,
        duration
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error(
        'Request failed',
        error instanceof Error ? error : new Error('Unknown error'),
        {
          requestId: context.requestId,
          method,
          pathname,
          duration
        }
      );

      throw error;
    }
  }
}
