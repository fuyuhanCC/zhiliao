import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { MemoryChatStore } from "../../stores/memory/chat-store.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";

function createTestApp() {
  return createApp({
    sessionStore: new MemorySessionStore(),
    roomStore: new MemoryRoomStore(),
    chatStore: new MemoryChatStore(),
    speechTurnStore: new MemorySpeechTurnStore(),
    zhihuOAuthService: null,
    rtcCredentialService: null,
    sessionSecret: "test-session-secret-with-at-least-32-characters",
    secureCookies: false,
    webOrigin: "http://localhost:5173",
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
});
