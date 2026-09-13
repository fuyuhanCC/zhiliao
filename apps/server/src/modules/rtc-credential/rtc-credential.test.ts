import type { PublicUser } from "@zhiliao/shared";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import { MemoryChatStore } from "../../stores/memory/chat-store.js";
import { MemoryAccountStore } from "../../stores/memory/account-store.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";
import { createRoomSnapshot } from "../../test/room-fixture.js";
import { RtcCredentialService, type UserSigSigner } from "./rtc-credential-service.js";

const now = new Date("2026-09-13T08:00:00.000Z");

function createCredentialService() {
  const signer: UserSigSigner = {
    genUserSig: vi.fn((userId, expireSeconds) => `sig:${userId}:${expireSeconds}`),
  };

  return {
    service: new RtcCredentialService({
      sdkAppId: 1_400_000_000,
      secretKey: "test-secret",
      userSigTtlSeconds: 7200,
      now: () => now,
      signer,
    }),
    signer,
  };
}

function createTestApp(
  roomOptions: { visibility?: "public" | "invite"; inviteCode?: string } = {},
) {
  const sessionStore = new MemorySessionStore();
  const roomStore = new MemoryRoomStore();
  const { service } = createCredentialService();
  const roomSnapshot = createRoomSnapshot();
  roomSnapshot.room.visibility = roomOptions.visibility ?? "public";
  roomStore.save(
    roomSnapshot,
    roomOptions.inviteCode ? { inviteCode: roomOptions.inviteCode } : undefined,
  );

  return createApp({
    sessionStore,
    accountStore: new MemoryAccountStore(),
    roomStore,
    chatStore: new MemoryChatStore(),
    speechTurnStore: new MemorySpeechTurnStore(),
    zhihuOAuthService: null,
    rtcCredentialService: service,
    sessionSecret: "test-session-secret-with-at-least-32-characters",
    secureCookies: false,
    webOrigin: "http://localhost:5173",
  });
}

function createFailingTestApp() {
  const sessionStore = new MemorySessionStore();
  const roomStore = new MemoryRoomStore();
  roomStore.save(createRoomSnapshot());

  return createApp({
    sessionStore,
    accountStore: new MemoryAccountStore(),
    roomStore,
    chatStore: new MemoryChatStore(),
    speechTurnStore: new MemorySpeechTurnStore(),
    zhihuOAuthService: null,
    rtcCredentialService: new RtcCredentialService({
      sdkAppId: 1_400_000_000,
      secretKey: "test-secret",
      userSigTtlSeconds: 7200,
      signer: {
        genUserSig: () => {
          throw new Error("signing failed");
        },
      },
    }),
    sessionSecret: "test-session-secret-with-at-least-32-characters",
    secureCookies: false,
    webOrigin: "http://localhost:5173",
  });
}

describe("RtcCredentialService", () => {
  it("generates a UserSig with the Tencent signer", () => {
    const service = new RtcCredentialService({
      sdkAppId: 1_400_000_000,
      secretKey: "local-test-secret-that-is-not-a-real-credential",
      userSigTtlSeconds: 7200,
      now: () => now,
    });

    const credentials = service.create({
      roomId: "room_123",
      user: {
        userId: "guest-1",
        identityType: "guest",
        displayName: "访客",
        avatarUrl: null,
        level: 1,
        levelTitle: "蛰伏",
      },
      isSeated: false,
      idempotencyKey: "request-123",
    });

    expect(credentials.userSig.length).toBeGreaterThan(50);
    expect(credentials.userSig).not.toContain("local-test-secret");
  });

  it("grants speaker role only to a seated Zhihu user", () => {
    const { service } = createCredentialService();
    const user: PublicUser = {
      userId: "zhihu-user-1",
      identityType: "zhihu",
      displayName: "测试知友",
      avatarUrl: null,
      level: 1,
      levelTitle: "蛰伏",
    };

    const credentials = service.create({
      roomId: "room_123",
      user,
      isSeated: true,
      idempotencyKey: "request-123",
    });

    expect(credentials.role).toBe("speaker");
    expect(credentials.trtcUserId).toMatch(/^u_[A-Za-z0-9_-]{28}$/);
    expect(credentials.expiresAt).toBe("2026-09-13T10:00:00.000Z");
  });

  it("returns the same credentials for the same idempotency key", () => {
    const { service, signer } = createCredentialService();
    const user: PublicUser = {
      userId: "guest-1",
      identityType: "guest",
      displayName: "访客",
      avatarUrl: null,
      level: 1,
      levelTitle: "蛰伏",
    };
    const input = {
      roomId: "room_123",
      user,
      isSeated: false,
      idempotencyKey: "request-123",
    };

    expect(service.create(input)).toEqual(service.create(input));
    expect(signer.genUserSig).toHaveBeenCalledTimes(1);
  });
});

describe("RTC credential route", () => {
  it("issues audience credentials to a guest with a valid room session", async () => {
    const agent = request.agent(createTestApp());
    await agent.post("/api/v1/auth/guest").send({ displayName: "访客" }).expect(201);

    const response = await agent
      .post("/api/v1/rooms/room_123/rtc-credentials")
      .set("Idempotency-Key", "request-123")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      sdkAppId: 1_400_000_000,
      trtcRoomId: "room_123",
      role: "audience",
      expiresAt: "2026-09-13T10:00:00.000Z",
    });
    expect(response.body.userSig).not.toContain("test-secret");
  });

  it("rejects requests without a session", async () => {
    const response = await request(createTestApp())
      .post("/api/v1/rooms/room_123/rtc-credentials")
      .set("Idempotency-Key", "request-123")
      .send({});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects a missing room", async () => {
    const agent = request.agent(createTestApp());
    await agent.post("/api/v1/auth/guest").send({}).expect(201);

    const response = await agent
      .post("/api/v1/rooms/missing-room/rtc-credentials")
      .set("Idempotency-Key", "request-123")
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROOM_NOT_FOUND");
  });

  it("requires the correct invite code for a private room", async () => {
    const agent = request.agent(createTestApp({ visibility: "invite", inviteCode: "invite-123" }));
    await agent.post("/api/v1/auth/guest").send({}).expect(201);

    const denied = await agent
      .post("/api/v1/rooms/room_123/rtc-credentials")
      .set("Idempotency-Key", "request-123")
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("INVITE_REQUIRED");

    const admitted = await agent
      .post("/api/v1/rooms/room_123/rtc-credentials")
      .set("Idempotency-Key", "request-456")
      .send({ inviteCode: "invite-123" });
    expect(admitted.status).toBe(200);
  });

  it("returns a structured upstream error when signing fails", async () => {
    const agent = request.agent(createFailingTestApp());
    await agent.post("/api/v1/auth/guest").send({}).expect(201);

    const response = await agent
      .post("/api/v1/rooms/room_123/rtc-credentials")
      .set("Idempotency-Key", "request-123")
      .send({});

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("TRTC_UNAVAILABLE");
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });
});
