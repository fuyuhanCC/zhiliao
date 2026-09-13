import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import { MemoryOAuthAttemptStore } from "../../stores/memory/oauth-attempt-store.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
import type { ZhihuOAuthClient } from "./zhihu-oauth-client.js";
import { ZhihuOAuthUpstreamError } from "./zhihu-oauth-client.js";
import { ZhihuOAuthService } from "./zhihu-oauth-service.js";

const sessionSecret = "test-session-secret-with-at-least-32-characters";

function createSuccessfulClient(): ZhihuOAuthClient {
  return {
    exchangeAuthorizationCode: vi.fn(async () => ({
      accessToken: "oauth-access-token",
      tokenType: "Bearer",
      expiresInSeconds: 3600,
    })),
  };
}

function createTestContext(client: ZhihuOAuthClient = createSuccessfulClient(), now?: () => Date) {
  const sessionStore = new MemorySessionStore();
  const oauthService = new ZhihuOAuthService({
    appId: "zhihu-app-id",
    redirectUri: "http://localhost:3000/api/v1/auth/zhihu/callback",
    webOrigin: "http://localhost:5173",
    attemptTtlSeconds: 600,
    attemptStore: new MemoryOAuthAttemptStore(),
    sessionStore,
    client,
    ...(now ? { now } : {}),
  });
  const app = createApp({
    sessionStore,
    roomStore: new MemoryRoomStore(),
    zhihuOAuthService: oauthService,
    rtcCredentialService: null,
    sessionSecret,
    secureCookies: false,
    webOrigin: "http://localhost:5173",
  });

  return { app, client };
}

async function beginAuthorization(agent: ReturnType<typeof request.agent>, returnTo = "/") {
  const response = await agent.get("/api/v1/auth/zhihu/authorize").query({ returnTo }).expect(302);
  const location = response.headers.location;
  if (!location) {
    throw new Error("authorization response did not include a location");
  }
  const authorizationUrl = new URL(location);
  const state = authorizationUrl.searchParams.get("state");
  if (!state) {
    throw new Error("authorization redirect did not include state");
  }
  return {
    response,
    state,
    authorizationUrl,
  };
}

describe("Zhihu OAuth routes", () => {
  it("creates a guest session and redirects to the documented authorize endpoint", async () => {
    const { app } = createTestContext();
    const agent = request.agent(app);
    const { response, authorizationUrl } = await beginAuthorization(agent, "/rooms/room_123");

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://openapi.zhihu.com/authorize",
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toMatchObject({
      app_id: "zhihu-app-id",
      redirect_uri: "http://localhost:3000/api/v1/auth/zhihu/callback",
      response_type: "code",
    });
    expect(authorizationUrl.searchParams.get("state")).toEqual(expect.any(String));
    expect(response.headers["set-cookie"]).toHaveLength(2);

    const session = await agent.get("/api/v1/auth/session").expect(200);
    expect(session.body.user.identityType).toBe("guest");
  });

  it("upgrades the same session and redirects only to an internal return path", async () => {
    const { app, client } = createTestContext();
    const agent = request.agent(app);
    const { state } = await beginAuthorization(agent, "/rooms/room_123?inviteCode=abc123");
    const guestSession = await agent.get("/api/v1/auth/session").expect(200);

    const callback = await agent
      .get("/api/v1/auth/zhihu/callback")
      .query({ authorization_code: "authorization-code", state })
      .expect(302);

    expect(callback.headers.location).toBe(
      "http://localhost:5173/rooms/room_123?inviteCode=abc123",
    );
    expect(client.exchangeAuthorizationCode).toHaveBeenCalledWith("authorization-code");

    const upgradedSession = await agent.get("/api/v1/auth/session").expect(200);
    expect(upgradedSession.body.user).toMatchObject({
      identityType: "zhihu",
      displayName: guestSession.body.user.displayName,
    });
    expect(upgradedSession.body.user.userId).not.toBe(guestSession.body.user.userId);
    expect(JSON.stringify(upgradedSession.body)).not.toContain("oauth-access-token");
    expect(upgradedSession.body.permissions).toEqual({
      canCreateRoom: true,
      canRequestSeat: true,
      canSpeak: true,
    });
  });

  it("accepts callbacks without state because Zhihu does not document returning it", async () => {
    const { app } = createTestContext();
    const agent = request.agent(app);
    await beginAuthorization(agent);

    const callback = await agent
      .get("/api/v1/auth/zhihu/callback")
      .query({ authorization_code: "authorization-code" });
    expect(callback.status).toBe(302);
  });

  it("rejects state mismatches and prevents callback replay", async () => {
    const { app, client } = createTestContext();
    const agent = request.agent(app);
    const { state } = await beginAuthorization(agent);

    const invalid = await agent
      .get("/api/v1/auth/zhihu/callback")
      .query({ authorization_code: "authorization-code", state: `${state}-tampered` });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_OAUTH_CALLBACK");
    expect(client.exchangeAuthorizationCode).not.toHaveBeenCalled();

    const replay = await agent
      .get("/api/v1/auth/zhihu/callback")
      .query({ authorization_code: "authorization-code", state });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("INVALID_OAUTH_CALLBACK");
  });

  it("rejects an expired authorization attempt before exchanging the code", async () => {
    let now = new Date("2026-09-13T08:00:00.000Z");
    const client = createSuccessfulClient();
    const { app } = createTestContext(client, () => now);
    const agent = request.agent(app);
    const { state } = await beginAuthorization(agent);
    now = new Date("2026-09-13T08:11:00.000Z");

    const callback = await agent
      .get("/api/v1/auth/zhihu/callback")
      .query({ authorization_code: "authorization-code", state });
    expect(callback.status).toBe(400);
    expect(callback.body.error.code).toBe("INVALID_OAUTH_CALLBACK");
    expect(client.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("blocks external return targets", async () => {
    const { app } = createTestContext();
    const agent = request.agent(app);
    const { state } = await beginAuthorization(agent, "https://attacker.example/steal");

    const callback = await agent
      .get("/api/v1/auth/zhihu/callback")
      .query({ authorization_code: "authorization-code", state })
      .expect(302);
    expect(callback.headers.location).toBe("http://localhost:5173/");
  });

  it("returns a generic error when the token exchange fails", async () => {
    const client: ZhihuOAuthClient = {
      exchangeAuthorizationCode: vi.fn(async () => {
        throw new ZhihuOAuthUpstreamError("upstream included a sensitive token");
      }),
    };
    const { app } = createTestContext(client);
    const agent = request.agent(app);
    const { state } = await beginAuthorization(agent);

    const callback = await agent
      .get("/api/v1/auth/zhihu/callback")
      .query({ authorization_code: "authorization-code", state });
    expect(callback.status).toBe(502);
    expect(callback.body.error.code).toBe("ZHIHU_OAUTH_FAILED");
    expect(JSON.stringify(callback.body)).not.toContain("sensitive token");
  });

  it("reports that OAuth is unavailable when credentials are missing", async () => {
    const app = createApp({
      sessionStore: new MemorySessionStore(),
      roomStore: new MemoryRoomStore(),
      zhihuOAuthService: null,
      rtcCredentialService: null,
      sessionSecret,
      secureCookies: false,
      webOrigin: "http://localhost:5173",
    });

    const response = await request(app).get("/api/v1/auth/zhihu/authorize");
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("ZHIHU_OAUTH_UNAVAILABLE");
  });
});
