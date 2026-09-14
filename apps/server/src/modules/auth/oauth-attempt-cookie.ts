import type { Request, Response } from "express";
import { z } from "zod";

import type { OAuthAttempt } from "../../stores/oauth-attempt-store.js";

export const OAUTH_ATTEMPT_COOKIE_NAME = "zhiliao_oauth_attempt";
const oauthAttemptCookiePrefix = "v1.";
const oauthAttemptSchema = z
  .object({
    attemptId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(200),
    state: z.string().min(1).max(200),
    returnTo: z.string().min(1).max(500),
    expiresAt: z.string().min(1),
  })
  .strict();

export function readOAuthAttemptCookie(request: Request): OAuthAttempt | undefined {
  const cookieValue: unknown = request.signedCookies?.[OAUTH_ATTEMPT_COOKIE_NAME];
  if (typeof cookieValue !== "string" || !cookieValue.startsWith(oauthAttemptCookiePrefix)) {
    return undefined;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(cookieValue.slice(oauthAttemptCookiePrefix.length), "base64url").toString("utf8"),
    );
    const parsedAttempt = oauthAttemptSchema.safeParse(payload);
    return parsedAttempt.success ? parsedAttempt.data : undefined;
  } catch {
    return undefined;
  }
}

export function setOAuthAttemptCookie(
  response: Response,
  attempt: OAuthAttempt,
  secure: boolean,
  maxAgeMilliseconds: number,
): void {
  const payload = oauthAttemptSchema.parse(attempt);
  const encodedPayload = `${oauthAttemptCookiePrefix}${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  response.cookie(OAUTH_ATTEMPT_COOKIE_NAME, encodedPayload, {
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
