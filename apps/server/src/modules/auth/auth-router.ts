import { Router } from "express";
import { z } from "zod";

import { sendApiError } from "../../http/api-error.js";
import type { SessionStore } from "../../stores/session-store.js";
import {
  clearSessionCookie,
  createGuestSession,
  readSession,
  setSessionCookie,
  toSessionResponse,
} from "./session.js";

const guestSessionBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(20).optional(),
  })
  .strict();

export interface AuthRouterOptions {
  sessionStore: SessionStore;
  secureCookies: boolean;
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();

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
      response.status(200).json(toSessionResponse(existingSession));
      return;
    }

    const session = createGuestSession(parsedBody.data.displayName);
    options.sessionStore.save(session);
    setSessionCookie(response, session.sessionId, options.secureCookies);
    response.status(201).json(toSessionResponse(session));
  });

  router.get("/session", (request, response) => {
    const session = readSession(request, options.sessionStore);
    if (!session) {
      sendApiError(response, 401, "AUTH_REQUIRED", "缺少或失效会话");
      return;
    }

    response.json(toSessionResponse(session));
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
