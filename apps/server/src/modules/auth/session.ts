import { randomInt, randomUUID } from "node:crypto";

import type { components } from "@zhiliao/shared/openapi";
import type { Request, Response } from "express";
import { z } from "zod";

import { toUserAccount, withAccountProgression } from "../../domain/account/user-account.js";
import type { AccountStore } from "../../stores/account-store.js";
import type { SessionStore, UserSession } from "../../stores/session-store.js";

type SessionResponse = components["schemas"]["SessionResponse"];

export const SESSION_COOKIE_NAME = "zhiliao_session";
const sessionMaxAgeMilliseconds = 7 * 24 * 60 * 60 * 1000;
const recoverableSessionPrefix = "v1.";

const recoverableSessionSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    user: z
      .object({
        userId: z.string().min(1).max(200),
        identityType: z.enum(["guest", "zhihu"]),
        displayName: z.string().min(1).max(100),
        avatarUrl: z.string().min(1).nullable(),
        level: z.union([
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4),
          z.literal(5),
          z.literal(6),
        ]),
        levelTitle: z.enum(["蛰伏", "破土", "蜕壳", "振翅", "鸣夏", "知秋"]),
      })
      .strict(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

function encodeRecoverableSession(session: UserSession): string {
  const payload = recoverableSessionSchema.parse({
    sessionId: session.sessionId,
    user: session.user,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
  return `${recoverableSessionPrefix}${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

export function readSessionCookieValue(
  cookieValue: string,
  sessionStore: SessionStore,
): UserSession | undefined {
  const storedSession = sessionStore.get(cookieValue);
  if (storedSession) {
    return storedSession;
  }

  if (!cookieValue.startsWith(recoverableSessionPrefix)) {
    return undefined;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(cookieValue.slice(recoverableSessionPrefix.length), "base64url").toString("utf8"),
    );
    const parsedSession = recoverableSessionSchema.safeParse(payload);
    if (!parsedSession.success) {
      return undefined;
    }
    const currentSession = sessionStore.get(parsedSession.data.sessionId);
    if (currentSession) {
      return currentSession;
    }
    const recoveredSession: UserSession = parsedSession.data;
    sessionStore.save(recoveredSession);
    return recoveredSession;
  } catch {
    return undefined;
  }
}

export function readSession(request: Request, sessionStore: SessionStore): UserSession | undefined {
  const cookieValue: unknown = request.signedCookies?.[SESSION_COOKIE_NAME];
  return typeof cookieValue === "string"
    ? readSessionCookieValue(cookieValue, sessionStore)
    : undefined;
}

export function createGuestSession(displayName?: string): UserSession {
  const now = new Date().toISOString();
  const guestId = `guest_${randomUUID()}`;

  return {
    sessionId: randomUUID(),
    user: {
      userId: guestId,
      identityType: "guest",
      displayName: displayName ?? `知友${randomInt(1000, 10000)}`,
      avatarUrl: null,
      level: 1,
      levelTitle: "蛰伏",
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createDevelopmentZhihuSession(
  userIndex: number,
  displayName?: string,
): UserSession {
  const now = new Date().toISOString();
  return {
    sessionId: randomUUID(),
    user: {
      userId: `dev_zhihu_${userIndex}`,
      identityType: "zhihu",
      displayName: displayName ?? `测试知友 ${userIndex}`,
      avatarUrl: null,
      level: 1,
      levelTitle: "蛰伏",
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function toSessionResponse(
  session: UserSession,
  accountStore: AccountStore,
): SessionResponse {
  const isZhihuUser = session.user.identityType === "zhihu";
  const account = accountStore.ensure(session.user.userId);
  return {
    user: withAccountProgression(session.user, account),
    account: toUserAccount(account),
    permissions: {
      canCreateRoom: isZhihuUser,
      canRequestSeat: isZhihuUser,
      canSpeak: isZhihuUser,
    },
  };
}

export function setSessionCookie(response: Response, session: UserSession, secure: boolean): void {
  response.cookie(SESSION_COOKIE_NAME, encodeRecoverableSession(session), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    signed: true,
    maxAge: sessionMaxAgeMilliseconds,
    path: "/",
  });
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    signed: true,
    path: "/",
  });
}
