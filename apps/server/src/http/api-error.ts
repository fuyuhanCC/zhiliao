import type { Response } from "express";

export function sendApiError(
  response: Response,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): void {
  response.status(status).json({
    error: {
      code,
      message,
      details,
      requestId: response.locals.requestId,
    },
  });
}
