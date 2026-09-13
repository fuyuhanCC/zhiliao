import { randomInt, randomUUID } from "node:crypto";

import type { components } from "@zhiliao/shared/openapi";
import type { Request, Response } from "express";

import { toUserAccount, withAccountProgression } from "../../domain/account/user-account.js";
import type { AccountStore } from "../../stores/account-store.js";
import type { SessionStore, UserSession } from "../../stores/session-store.js";

type SessionResponse = components["schemas"]["SessionResponse"];

export const SESSION_COOKIE_NAME = "zhiliao_session";
const sessionMaxAgeMilliseconds = 7 * 24 * 60 * 60 * 1000;

export function readSession(request: Request, sessionStore: SessionStore): UserSession | undefined {
  const cookieValue: unknown = request.signedCookies?.[SESSION_COOKIE_NAME];
  return typeof cookieValue === "string" ? sessionStore.get(cookieValue) : undefined;
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

export function setSessionCookie(response: Response, sessionId: string, secure: boolean): void {
  response.cookie(SESSION_COOKIE_NAME, sessionId, {
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
