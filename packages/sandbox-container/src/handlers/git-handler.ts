// Git Handler
import { ErrorCode } from '@repo/shared/errors';

import type { GitCheckoutRequest, Logger, RequestContext } from '../core/types';
import type { GitService } from '../services/git-service';
import { BaseHandler } from './base-handler';

export class GitHandler extends BaseHandler<Request, Response> {
  constructor(
    private gitService: GitService,
    logger: Logger
  ) {
    super(logger);
  }

  async handle(request: Request, context: RequestContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    switch (pathname) {
      case '/api/git/checkout':
        return await this.handleCheckout(request, context);
      default:
        return this.createServiceResponse({
          success: false,
          error: {
            message: 'Invalid git endpoint',
            code: ErrorCode.UNKNOWN_ERROR,
          }
        }, context);
    }
  }

  private async handleCheckout(request: Request, context: RequestContext): Promise<Response> {
    const body = this.getValidatedData<GitCheckoutRequest>(context);
    const sessionId = body.sessionId || context.sessionId;
    
    this.logger.info('Cloning git repository', { 
      requestId: context.requestId,
      repoUrl: body.repoUrl,
      branch: body.branch,
      targetDir: body.targetDir,
      sessionId
    });

    const result = await this.gitService.cloneRepository(body.repoUrl, {
      branch: body.branch,
      targetDir: body.targetDir,
      sessionId,
    });

    this.logger.info('Repository clone result', {
      requestId: context.requestId,
      repoUrl: body.repoUrl,
      success: result.success,
    });

    return this.createServiceResponse(result, context);
  }
}