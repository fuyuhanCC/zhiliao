import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { withAccountProgression } from "../../domain/account/user-account.js";
import type { AccountStore } from "../../stores/account-store.js";
import type { OAuthAttemptStore } from "../../stores/oauth-attempt-store.js";
import type { SessionStore, UserSession } from "../../stores/session-store.js";
import type { ZhihuOAuthClient } from "./zhihu-oauth-client.js";

export interface ZhihuOAuthServiceOptions {
  appId: string;
  redirectUri: string;
  webOrigin: string;
  attemptTtlSeconds: number;
  attemptStore: OAuthAttemptStore;
  accountStore: AccountStore;
  sessionStore: SessionStore;
  client: ZhihuOAuthClient;
  now?: () => Date;
  generateOpaqueValue?: () => string;
}

export interface StartZhihuOAuthResult {
  attemptId: string;
  authorizationUrl: string;
}

export interface CompleteZhihuOAuthInput {
  attemptId: string;
  authorizationCode: string;
  returnedState?: string;
  session: UserSession;
}

export interface CompleteZhihuOAuthResult {
  session: UserSession;
  redirectUrl: string;
}

export class InvalidOAuthAttemptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOAuthAttemptError";
  }
}

function statesMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function createZhihuUserId(session: UserSession): string {
  if (session.user.identityType === "zhihu") {
    return session.user.userId;
  }

  const digest = createHash("sha256").update(session.sessionId).digest("base64url").slice(0, 24);
  return `zhihu_${digest}`;
}

export class ZhihuOAuthService {
  private readonly now: () => Date;
  private readonly generateOpaqueValue: () => string;
  private readonly webOrigin: URL;

  constructor(private readonly options: ZhihuOAuthServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.generateOpaqueValue = options.generateOpaqueValue ?? randomUUID;
    this.webOrigin = new URL(options.webOrigin);
  }

  get attemptTtlMilliseconds(): number {
    return this.options.attemptTtlSeconds * 1000;
  }

  start(session: UserSession, requestedReturnTo?: string): StartZhihuOAuthResult {
    const attemptId = this.generateOpaqueValue();
    const state = this.generateOpaqueValue();
    const expiresAt = new Date(
      this.now().getTime() + this.options.attemptTtlSeconds * 1000,
    ).toISOString();
    const returnTo = this.normalizeReturnTo(requestedReturnTo);

    this.options.attemptStore.save({
      attemptId,
      sessionId: session.sessionId,
      state,
      returnTo,
      expiresAt,
    });

    const authorizationUrl = new URL("https://openapi.zhihu.com/authorize");
    authorizationUrl.search = new URLSearchParams({
      redirect_uri: this.options.redirectUri,
      app_id: this.options.appId,
      response_type: "code",
      state,
    }).toString();

    return {
      attemptId,
      authorizationUrl: authorizationUrl.toString(),
    };
  }

  async complete(input: CompleteZhihuOAuthInput): Promise<CompleteZhihuOAuthResult> {
    const attempt = this.options.attemptStore.take(input.attemptId);
    if (!attempt) {
      throw new InvalidOAuthAttemptError("OAuth 尝试不存在或已使用");
    }

    if (new Date(attempt.expiresAt).getTime() <= this.now().getTime()) {
      throw new InvalidOAuthAttemptError("OAuth 尝试已过期");
    }

    if (attempt.sessionId !== input.session.sessionId) {
      throw new InvalidOAuthAttemptError("OAuth 尝试与当前会话不匹配");
    }

    if (input.returnedState && !statesMatch(attempt.state, input.returnedState)) {
      throw new InvalidOAuthAttemptError("OAuth state 校验失败");
    }

    const token = await this.options.client.exchangeAuthorizationCode(input.authorizationCode);
    const now = this.now();
    // The current Zhihu OAuth document does not publish a user-profile endpoint or profile schema.
    // Keep the existing nickname and use a session-scoped ID until that contract is available.
    const zhihuUserId = createZhihuUserId(input.session);
    const account = this.options.accountStore.migrate(input.session.user.userId, zhihuUserId);
    const upgradedSession: UserSession = {
      ...input.session,
      user: withAccountProgression(
        {
          ...input.session.user,
          userId: zhihuUserId,
          identityType: "zhihu",
        },
        account,
      ),
      zhihuOAuth: {
        accessToken: token.accessToken,
        tokenType: token.tokenType,
        expiresAt: new Date(now.getTime() + token.expiresInSeconds * 1000).toISOString(),
      },
      updatedAt: now.toISOString(),
    };
    this.options.sessionStore.save(upgradedSession);

    return {
      session: upgradedSession,
      redirectUrl: new URL(attempt.returnTo, this.webOrigin).toString(),
    };
  }

  private normalizeReturnTo(requestedReturnTo?: string): string {
    if (!requestedReturnTo) {
      return "/";
    }

    try {
      const target = new URL(requestedReturnTo, this.webOrigin);
      if (target.origin !== this.webOrigin.origin) {
        return "/";
      }
      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return "/";
    }
  }
}
