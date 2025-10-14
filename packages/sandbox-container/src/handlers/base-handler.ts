import {
  type ErrorCode,
  type ErrorResponse,
  getHttpStatus,
  getSuggestion,
  type OperationType,
} from "@repo/shared/errors";
import type {
  Handler,
  Logger,
  RequestContext,
  ServiceError,
  ServiceResult,
  ValidatedRequestContext,
} from "../core/types";

export abstract class BaseHandler<TRequest, TResponse>
  implements Handler<TRequest, TResponse>
{
  constructor(protected logger: Logger) {}

  abstract handle(
    request: TRequest,
    context: RequestContext
  ): Promise<TResponse>;

  protected createSuccessResponse<T>(
    data: T,
    context: RequestContext,
    statusCode: number = 200
  ): Response {
    return new Response(
      JSON.stringify({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      }),
      {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
          ...context.corsHeaders,
        },
      }
    );
  }

  protected createErrorResponse(
    error: ServiceError | Error | string,
    statusCode: number = 500,
    context: RequestContext
  ): Response {
    let errorObj: ServiceError;

    if (typeof error === "string") {
      errorObj = {
        message: error,
        code: "UNKNOWN_ERROR",
      };
    } else if (error instanceof Error) {
      errorObj = {
        message: error.message,
        code: "INTERNAL_ERROR",
        details: { stack: error.stack },
      };
    } else {
      errorObj = error;
    }

    this.logger.error(
      "Handler error",
      error instanceof Error ? error : undefined,
      {
        requestId: context.requestId,
        errorCode: errorObj.code,
        statusCode,
      }
    );

    return new Response(
      JSON.stringify({
        success: false,
        error: errorObj.message,
        code: errorObj.code,
        details: errorObj.details,
        timestamp: new Date().toISOString(),
      }),
      {
        status: statusCode,
        headers: {
          "Content-Type": "application/json",
          ...context.corsHeaders,
        },
      }
    );
  }

  /**
   * Enrich lightweight ServiceError into full ErrorResponse
   * Adds HTTP status, timestamp, suggestions, operation, etc.
   */
  protected enrichServiceError(
    serviceError: ServiceError,
    operation?: OperationType
  ): ErrorResponse {
    const errorCode = serviceError.code as ErrorCode;
    return {
      code: errorCode,
      message: serviceError.message,
      context: serviceError.details || {},
      operation: operation || (serviceError.details?.operation as OperationType | undefined),
      httpStatus: getHttpStatus(errorCode),
      timestamp: new Date().toISOString(),
      suggestion: getSuggestion(errorCode, serviceError.details || {}),
    };
  }

  protected createServiceResponse<T>(
    result: ServiceResult<T>,
    context: RequestContext,
    successStatus: number = 200,
    operation?: OperationType
  ): Response {
    if (result.success) {
      const data = "data" in result ? result.data : undefined;
      return this.createSuccessResponse(data, context, successStatus);
    } else {
      // Enrich ServiceError to ErrorResponse
      const errorResponse = this.enrichServiceError(result.error, operation);

      return new Response(
        JSON.stringify({
          ...errorResponse,
        }),
        {
          status: errorResponse.httpStatus,
          headers: {
            "Content-Type": "application/json",
            ...context.corsHeaders,
          },
        }
      );
    }
  }

  protected getValidatedData<T>(context: RequestContext): T {
    const validatedContext = context as ValidatedRequestContext<T>;
    if (!validatedContext.validatedData) {
      throw new Error(
        "No validated data found in context. Ensure validation middleware ran first."
      );
    }
    return validatedContext.validatedData;
  }

  protected extractPathParam(pathname: string, position: number): string {
    const segments = pathname.split("/");
    return segments[position] || "";
  }

  protected extractQueryParam(request: Request, param: string): string | null {
    const url = new URL(request.url);
    return url.searchParams.get(param);
  }
}
