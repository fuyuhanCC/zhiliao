import { Router } from "express";
import { z } from "zod";

import { sendApiError } from "../../http/api-error.js";
import type { AccountStore } from "../../stores/account-store.js";
import type { SessionStore } from "../../stores/session-store.js";
import {
  clearOAuthAttemptCookie,
  readOAuthAttemptCookie,
  setOAuthAttemptCookie,
} from "./oauth-attempt-cookie.js";
import {
  clearSessionCookie,
  createDevelopmentZhihuSession,
  createGuestSession,
  readSession,
  setSessionCookie,
  toSessionResponse,
} from "./session.js";
import { ZhihuOAuthUpstreamError } from "./zhihu-oauth-client.js";
import { InvalidOAuthAttemptError, type ZhihuOAuthService } from "./zhihu-oauth-service.js";

const guestSessionBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(20).optional(),
  })
  .strict();

const developmentSessionBodySchema = z
  .object({
    userIndex: z.number().int().min(1).max(99),
    displayName: z.string().trim().min(1).max(20).optional(),
  })
  .strict();

const authorizeQuerySchema = z
  .object({
    returnTo: z.string().max(500).optional(),
  })
  .strict();

const callbackQuerySchema = z
  .object({
    authorization_code: z.string().min(1),
    state: z.string().min(1).optional(),
  })
  .strict();

export interface AuthRouterOptions {
  sessionStore: SessionStore;
  accountStore: AccountStore;
  secureCookies: boolean;
  zhihuOAuthService: ZhihuOAuthService | null;
  enableDevelopmentSessions?: boolean;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();

  if (options.enableDevelopmentSessions) {
    router.post("/dev-session", (request, response) => {
      const parsedBody = developmentSessionBodySchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
          issues: parsedBody.error.issues,
        });
        return;
      }

      const existingSession = readSession(request, options.sessionStore);
      if (existingSession) {
        options.sessionStore.delete(existingSession.sessionId);
      }
      const session = createDevelopmentZhihuSession(
        parsedBody.data.userIndex,
        parsedBody.data.displayName,
      );
      options.sessionStore.save(session);
      options.accountStore.ensure(session.user.userId);
      setSessionCookie(response, session.sessionId, options.secureCookies);
      response.status(201).json(toSessionResponse(session, options.accountStore));
    });
  }

  router.post("/guest", (request, response) => {
    const parsedBody = guestSessionBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        issues: parsedBody.error.issues,
      });
      return;
    }

    const existingSession = readSession(request, options.sessionStore);
    if (existingSession) {
      setSessionCookie(response, existingSession.sessionId, options.secureCookies);
      response.status(200).json(toSessionResponse(existingSession, options.accountStore));
      return;
    }

    const session = createGuestSession(parsedBody.data.displayName);
    options.sessionStore.save(session);
    options.accountStore.ensure(session.user.userId);
    setSessionCookie(response, session.sessionId, options.secureCookies);
    response.status(201).json(toSessionResponse(session, options.accountStore));
  });

  router.get("/session", (request, response) => {
    const session = readSession(request, options.sessionStore);
    if (!session) {
      sendApiError(response, 401, "AUTH_REQUIRED", "缺少或失效会话");
      return;
    }

    response.json(toSessionResponse(session, options.accountStore));
  });

  router.get("/zhihu/authorize", (request, response) => {
    if (!options.zhihuOAuthService) {
      sendApiError(response, 502, "ZHIHU_OAUTH_UNAVAILABLE", "知乎 OAuth 尚未配置");
      return;
    }

    const parsedQuery = authorizeQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        issues: parsedQuery.error.issues,
      });
      return;
    }

    let session = readSession(request, options.sessionStore);
    if (!session) {
      session = createGuestSession();
      options.sessionStore.save(session);
      options.accountStore.ensure(session.user.userId);
      setSessionCookie(response, session.sessionId, options.secureCookies);
    }

    const authorization = options.zhihuOAuthService.start(session, parsedQuery.data.returnTo);
    setOAuthAttemptCookie(
      response,
      authorization.attemptId,
      options.secureCookies,
      options.zhihuOAuthService.attemptTtlMilliseconds,
    );
    response.redirect(302, authorization.authorizationUrl);
  });

  router.get("/zhihu/callback", async (request, response) => {
    if (!options.zhihuOAuthService) {
      sendApiError(response, 502, "ZHIHU_OAUTH_UNAVAILABLE", "知乎 OAuth 尚未配置");
      return;
    }

    const parsedQuery = callbackQuerySchema.safeParse(request.query);
    const attemptId = readOAuthAttemptCookie(request);
    const session = readSession(request, options.sessionStore);
    clearOAuthAttemptCookie(response, options.secureCookies);

    if (!parsedQuery.success || !attemptId || !session) {
      sendApiError(response, 400, "INVALID_OAUTH_CALLBACK", "OAuth 回调无效或已过期", {
        issues: parsedQuery.success ? [] : parsedQuery.error.issues,
      });
      return;
    }

    try {
      const completed = await options.zhihuOAuthService.complete({
        attemptId,
        authorizationCode: parsedQuery.data.authorization_code,
        ...(parsedQuery.data.state ? { returnedState: parsedQuery.data.state } : {}),
        session,
      });
      setSessionCookie(response, completed.session.sessionId, options.secureCookies);
      response.redirect(302, completed.redirectUrl);
    } catch (error) {
      if (error instanceof InvalidOAuthAttemptError) {
        sendApiError(response, 400, "INVALID_OAUTH_CALLBACK", "OAuth 回调无效或已过期");
        return;
      }

      if (error instanceof ZhihuOAuthUpstreamError) {
        sendApiError(response, 502, "ZHIHU_OAUTH_FAILED", "知乎 OAuth 服务暂时不可用");
        return;
      }

      sendApiError(response, 502, "ZHIHU_OAUTH_FAILED", "知乎 OAuth 登录失败");
    }
  });

  router.post("/logout", (request, response) => {
    const session = readSession(request, options.sessionStore);
    if (session) {
      options.sessionStore.delete(session.sessionId);
    }
    clearSessionCookie(response, options.secureCookies);
    response.status(204).send();
  });

  return router;
}
