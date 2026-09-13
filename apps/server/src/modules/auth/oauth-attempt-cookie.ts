import type { Request, Response } from "express";

export const OAUTH_ATTEMPT_COOKIE_NAME = "zhiliao_oauth_attempt";

export function readOAuthAttemptCookie(request: Request): string | undefined {
  const cookieValue: unknown = request.signedCookies?.[OAUTH_ATTEMPT_COOKIE_NAME];
  return typeof cookieValue === "string" ? cookieValue : undefined;
}

export function setOAuthAttemptCookie(
  response: Response,
  attemptId: string,
  secure: boolean,
  maxAgeMilliseconds: number,
): void {
  response.cookie(OAUTH_ATTEMPT_COOKIE_NAME, attemptId, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    signed: true,
    maxAge: maxAgeMilliseconds,
    path: "/api/v1/auth/zhihu/callback",
  });
}

export function clearOAuthAttemptCookie(response: Response, secure: boolean): void {
  response.clearCookie(OAUTH_ATTEMPT_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    signed: true,
    path: "/api/v1/auth/zhihu/callback",
  });
}
