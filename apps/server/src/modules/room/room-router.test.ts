import { createHmac } from "node:crypto";

import type { PublicUser } from "@zhiliao/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
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
    roomStore,
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
      visibility: "public",
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
        visibility: "public",
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
      inviteCode: null,
      inviteUrl: null,
    });

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
          visibility: "public",
          topic: { source: "manual", title: "同一个请求" },
        });

    const first = await createRequest();
    const retry = await createRequest();
    expect(first.status).toBe(201);
    expect(retry.body).toEqual(first.body);

    const rooms = await request(app).get("/api/v1/rooms");
    expect(rooms.body.items).toHaveLength(1);
  });

  it("keeps invite rooms out of the lobby and checks their access code", async () => {
    const { app, zhihuCookie } = createTestContext();
    const created = await request(app)
      .post("/api/v1/rooms")
      .set("Cookie", zhihuCookie)
      .set("Idempotency-Key", "private-room")
      .send({
        visibility: "invite",
        topic: { source: "manual", title: "朋友间辩论" },
      });

    expect(created.status).toBe(201);
    expect(created.body.inviteCode).toEqual(expect.any(String));
    expect(created.body.inviteUrl).toContain("inviteCode=");
    const roomId = created.body.room.roomId as string;

    const lobby = await request(app).get("/api/v1/rooms");
    expect(lobby.body.items).toEqual([]);

    const missingCode = await request(app).get(`/api/v1/rooms/${roomId}`);
    expect(missingCode.status).toBe(403);
    expect(missingCode.body.error.code).toBe("INVITE_REQUIRED");

    const wrongCode = await request(app).get(`/api/v1/rooms/${roomId}?inviteCode=wrong-code`);
    expect(wrongCode.status).toBe(403);
    expect(wrongCode.body.error.code).toBe("INVALID_INVITE_CODE");

    const detail = await request(app).get(
      `/api/v1/rooms/${roomId}?inviteCode=${encodeURIComponent(created.body.inviteCode)}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.room.roomId).toBe(roomId);
  });

  it("normalizes a Zhihu question topic and rejects non-Zhihu question URLs", async () => {
    const { app, zhihuCookie } = createTestContext();
    const valid = await request(app)
      .post("/api/v1/rooms")
      .set("Cookie", zhihuCookie)
      .set("Idempotency-Key", "zhihu-question")
      .send({
        visibility: "public",
        topic: {
          source: "zhihu_question",
          questionUrl: "https://www.zhihu.com/question/123456789",
          title: "一个知乎问题",
        },
      });
    expect(valid.status).toBe(201);
    expect(valid.body.room.topic).toMatchObject({
      source: "zhihu_question",
      zhihuQuestionId: "123456789",
      zhihuUrl: "https://www.zhihu.com/question/123456789",
    });

    const invalid = await request(app)
      .post("/api/v1/rooms")
      .set("Cookie", zhihuCookie)
      .set("Idempotency-Key", "invalid-question")
      .send({
        visibility: "public",
        topic: {
          source: "zhihu_question",
          questionUrl: "https://example.com/question/123456789",
          title: "错误链接",
        },
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
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
        .send({ visibility: "public", topic: { source: "manual", title } })
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
