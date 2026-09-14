import { createHmac } from "node:crypto";

import type { PublicUser } from "@zhiliao/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { MemoryChatStore } from "../../stores/memory/chat-store.js";
import { MemoryAccountStore } from "../../stores/memory/account-store.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";
import type { UserSession } from "../../stores/session-store.js";
import { SESSION_COOKIE_NAME } from "../auth/session.js";

const sessionSecret = "test-session-secret-with-at-least-32-characters";

function signSessionCookie(sessionId: string): string {
  const signature = createHmac("sha256", sessionSecret)
    .update(sessionId)
    .digest("base64")
    .replace(/=+$/, "");
  const signedValue = `s:${sessionId}.${signature}`;
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedValue)}`;
}

function createZhihuSession(sessionStore: MemorySessionStore): string {
  const user: PublicUser = {
    userId: "zhihu-user-1",
    identityType: "zhihu",
    displayName: "测试知友",
    avatarUrl: null,
    level: 1,
    levelTitle: "蛰伏",
  };
  const session: UserSession = {
    sessionId: "session-zhihu-user-1",
    user,
    createdAt: "2026-09-13T08:00:00.000Z",
    updatedAt: "2026-09-13T08:00:00.000Z",
  };
  sessionStore.save(session);
  return signSessionCookie(session.sessionId);
}

function createTestContext() {
  const sessionStore = new MemorySessionStore();
  const roomStore = new MemoryRoomStore();
  const app = createApp({
    sessionStore,
    accountStore: new MemoryAccountStore(),
    roomStore,
    chatStore: new MemoryChatStore(),
    speechTurnStore: new MemorySpeechTurnStore(),
    zhihuOAuthService: null,
    rtcCredentialService: null,
    sessionSecret,
    secureCookies: false,
    webOrigin: "http://localhost:5173",
  });

  return {
    app,
    roomStore,
    zhihuCookie: createZhihuSession(sessionStore),
  };
}

describe("room routes", () => {
  it("requires a Zhihu session to create a room", async () => {
    const { app } = createTestContext();
    const roomRequest = {
      topic: { source: "manual", title: "测试辩题" },
    };

    const unauthenticated = await request(app)
      .post("/api/v1/rooms")
      .set("Idempotency-Key", "request-123")
      .send(roomRequest);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe("AUTH_REQUIRED");

    const guest = request.agent(app);
    await guest.post("/api/v1/auth/guest").send({}).expect(201);
    const forbidden = await guest
      .post("/api/v1/rooms")
      .set("Idempotency-Key", "request-123")
      .send(roomRequest);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("ZHIHU_LOGIN_REQUIRED");
  });

  it("creates, lists and retrieves a public room", async () => {
    const { app, zhihuCookie } = createTestContext();
    const created = await request(app)
      .post("/api/v1/rooms")
      .set("Cookie", zhihuCookie)
      .set("Idempotency-Key", "request-123")
      .send({
        topic: { source: "manual", title: "  是否应该拥抱 AI  " },
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      room: {
        type: "custom",
        status: "active",
        visibility: "public",
        topic: {
          source: "manual",
          title: "是否应该拥抱 AI",
        },
        creator: {
          userId: "zhihu-user-1",
        },
        onlineCount: 0,
        seatedCount: 0,
        version: 1,
      },
    });
    expect(Object.keys(created.body)).toEqual(["room"]);

    const roomId = created.body.room.roomId as string;
    const detail = await request(app).get(`/api/v1/rooms/${roomId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.seats).toHaveLength(6);
    expect(detail.body.queue).toEqual([]);
    expect(detail.body.speakerLock).toBeNull();

    const rooms = await request(app).get("/api/v1/rooms?type=custom");
    expect(rooms.status).toBe(200);
    expect(rooms.body.items.map((room: { roomId: string }) => room.roomId)).toEqual([roomId]);
    expect(rooms.body.nextCursor).toBeNull();
  });

  it("does not duplicate a room when the idempotency key is retried", async () => {
    const { app, zhihuCookie } = createTestContext();
    const createRequest = () =>
      request(app)
        .post("/api/v1/rooms")
        .set("Cookie", zhihuCookie)
        .set("Idempotency-Key", "same-request")
        .send({
          topic: { source: "manual", title: "同一个请求" },
        });

    const first = await createRequest();
    const retry = await createRequest();
    expect(first.status).toBe(201);
    expect(retry.body).toEqual(first.body);

    const rooms = await request(app).get("/api/v1/rooms");
    expect(rooms.body.items).toHaveLength(1);
  });

  it("rejects the deferred invite-room creation fields", async () => {
    const { app, zhihuCookie } = createTestContext();
    const created = await request(app)
      .post("/api/v1/rooms")
      .set("Cookie", zhihuCookie)
      .set("Idempotency-Key", "private-room")
      .send({
        visibility: "invite",
        topic: { source: "manual", title: "朋友间辩论" },
      });

    expect(created.status).toBe(400);
    expect(created.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects the deferred Zhihu question-link topic input", async () => {
    const { app, zhihuCookie } = createTestContext();
    const result = await request(app)
      .post("/api/v1/rooms")
      .set("Cookie", zhihuCookie)
      .set("Idempotency-Key", "zhihu-question")
      .send({
        topic: {
          source: "zhihu_question",
          questionUrl: "https://www.zhihu.com/question/123456789",
          title: "一个知乎问题",
        },
      });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("paginates the lobby with an opaque room cursor", async () => {
    const { app, zhihuCookie } = createTestContext();
    const roomInputs: Array<[string, string]> = [
      ["room-request-one", "房间一"],
      ["room-request-two", "房间二"],
    ];
    for (const [idempotencyKey, title] of roomInputs) {
      await request(app)
        .post("/api/v1/rooms")
        .set("Cookie", zhihuCookie)
        .set("Idempotency-Key", idempotencyKey)
        .send({ topic: { source: "manual", title } })
        .expect(201);
    }

    const firstPage = await request(app).get("/api/v1/rooms?limit=1");
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app).get(
      `/api/v1/rooms?limit=1&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].roomId).not.toBe(firstPage.body.items[0].roomId);
    expect(secondPage.body.nextCursor).toBeNull();
  });
});
