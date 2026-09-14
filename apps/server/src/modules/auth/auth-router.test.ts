import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { MemoryChatStore } from "../../stores/memory/chat-store.js";
import { MemoryAccountStore } from "../../stores/memory/account-store.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";

function createTestApp(enableDevelopmentSessions = false) {
  return createApp({
    sessionStore: new MemorySessionStore(),
    accountStore: new MemoryAccountStore(),
    roomStore: new MemoryRoomStore(),
    chatStore: new MemoryChatStore(),
    speechTurnStore: new MemorySpeechTurnStore(),
    zhihuOAuthService: null,
    rtcCredentialService: null,
    sessionSecret: "test-session-secret-with-at-least-32-characters",
    secureCookies: false,
    webOrigin: "http://localhost:5173",
    enableDevelopmentSessions,
  });
}

describe("auth routes", () => {
  it("creates a guest session and restores it from the signed cookie", async () => {
    const agent = request.agent(createTestApp());

    const created = await agent.post("/api/v1/auth/guest").send({ displayName: "测试访客" });

    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({
      identityType: "guest",
      displayName: "测试访客",
      avatarUrl: null,
      level: 1,
      levelTitle: "蛰伏",
    });
    expect(created.body.account).toEqual({
      coinBalance: 100,
      experience: 0,
      level: 1,
      levelTitle: "蛰伏",
      nextLevelExperience: 500,
    });
    expect(created.body.permissions).toEqual({
      canCreateRoom: false,
      canRequestSeat: false,
      canSpeak: false,
    });
    expect(created.headers["set-cookie"]?.[0]).toContain("HttpOnly");

    const restored = await agent.post("/api/v1/auth/guest").send({});
    expect(restored.status).toBe(200);
    expect(restored.body.user.userId).toBe(created.body.user.userId);

    const session = await agent.get("/api/v1/auth/session");
    expect(session.status).toBe(200);
    expect(session.body.user.userId).toBe(created.body.user.userId);
  });

  it("recovers the basic session identity after the in-memory store is replaced", async () => {
    const created = await request(createTestApp())
      .post("/api/v1/auth/guest")
      .send({ displayName: "可恢复访客" });
    const sessionCookie = created.headers["set-cookie"]?.[0]?.split(";", 1)[0];
    expect(sessionCookie).toBeTruthy();

    const restored = await request(createTestApp())
      .get("/api/v1/auth/session")
      .set("Cookie", sessionCookie!);

    expect(restored.status).toBe(200);
    expect(restored.body.user).toMatchObject({
      userId: created.body.user.userId,
      identityType: "guest",
      displayName: "可恢复访客",
    });
  });

  it("rejects invalid guest session input with a traceable error", async () => {
    const response = await request(createTestApp())
      .post("/api/v1/auth/guest")
      .send({ displayName: "", unexpected: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("returns 401 when no session cookie is present", async () => {
    const response = await request(createTestApp()).get("/api/v1/auth/session");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("creates isolated Zhihu-capable development sessions when explicitly enabled", async () => {
    const firstUser = request.agent(createTestApp(true));
    const created = await firstUser
      .post("/api/v1/auth/dev-session")
      .send({ userIndex: 1, displayName: "一号测试员" });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      user: {
        userId: "dev_zhihu_1",
        identityType: "zhihu",
        displayName: "一号测试员",
      },
      account: { coinBalance: 100 },
      permissions: {
        canCreateRoom: true,
        canRequestSeat: true,
        canSpeak: true,
      },
    });
    const restored = await firstUser.get("/api/v1/auth/session");
    expect(restored.body.user.userId).toBe("dev_zhihu_1");
  });

  it("does not register the development session route by default", async () => {
    const response = await request(createTestApp())
      .post("/api/v1/auth/dev-session")
      .send({ userIndex: 1 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});
