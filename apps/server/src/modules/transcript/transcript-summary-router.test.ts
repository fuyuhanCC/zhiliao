import { createHmac } from "node:crypto";

import type { PublicUser } from "@zhiliao/shared";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import { RoomEventBus } from "../../realtime/room-event-bus.js";
import { MemoryAccountStore } from "../../stores/memory/account-store.js";
import { MemoryChatStore } from "../../stores/memory/chat-store.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";
import { MemorySummaryStore } from "../../stores/memory/summary-store.js";
import type { UserSession } from "../../stores/session-store.js";
import { createRoomSnapshot } from "../../test/room-fixture.js";
import { SESSION_COOKIE_NAME } from "../auth/session.js";
import { SummaryService } from "../summary/summary-service.js";
import { TranscriptService } from "./transcript-service.js";

const sessionSecret = "test-session-secret-with-at-least-32-characters";

function signSessionCookie(sessionId: string): string {
  const signature = createHmac("sha256", sessionSecret)
    .update(sessionId)
    .digest("base64")
    .replace(/=+$/, "");
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(`s:${sessionId}.${signature}`)}`;
}

describe("transcript and summary routes", () => {
  it("uploads one speech recording, transcribes it and generates a cached summary", async () => {
    const user: PublicUser = {
      userId: "user-1",
      identityType: "zhihu",
      displayName: "测试知友",
      avatarUrl: null,
      level: 1,
      levelTitle: "蛰伏",
    };
    const sessionStore = new MemorySessionStore();
    const session: UserSession = {
      sessionId: "session-1",
      user,
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
    };
    sessionStore.save(session);
    const roomStore = new MemoryRoomStore();
    roomStore.save(createRoomSnapshot("room-1"));
    const speechTurnStore = new MemorySpeechTurnStore();
    speechTurnStore.create("room-1", {
      speechTurnId: "turn-1",
      speaker: user,
      startedAt: "2026-09-14T00:00:00.000Z",
      endedAt: "2026-09-14T00:00:10.000Z",
      releaseReason: "user_finished",
      likeCount: 0,
      transcript: {
        status: "pending",
        source: null,
        text: null,
        failureCode: null,
        updatedAt: "2026-09-14T00:00:10.000Z",
      },
    });
    const eventBus = new RoomEventBus();
    const transcriptService = new TranscriptService({
      roomStore,
      speechTurnStore,
      eventBus,
      client: { transcribe: vi.fn(async () => "这是本场讨论的转写。") },
    });
    const generate = vi.fn(async () => ({
      overview: "讨论围绕测试辩题展开。",
      viewpoints: [{ speakerUserId: "user-1", summary: "提出测试观点", speechTurnIds: ["turn-1"] }],
      agreements: [],
      disagreements: [],
      openQuestions: [],
      timeline: [{ speechTurnId: "turn-1", summary: "提出观点" }],
    }));
    const summaryService = new SummaryService({
      roomStore,
      speechTurnStore,
      summaryStore: new MemorySummaryStore(),
      eventBus,
      client: { generate },
    });
    const app = createApp({
      sessionStore,
      accountStore: new MemoryAccountStore(),
      roomStore,
      chatStore: new MemoryChatStore(),
      speechTurnStore,
      zhihuOAuthService: null,
      rtcCredentialService: null,
      transcriptService,
      summaryService,
      roomEventBus: eventBus,
      sessionSecret,
      secureCookies: false,
      webOrigin: "http://localhost:5173",
    });
    const cookie = signSessionCookie(session.sessionId);

    const upload = await request(app)
      .post("/api/v1/rooms/room-1/speech-turns/turn-1/audio")
      .set("Cookie", cookie)
      .set("Idempotency-Key", "upload-1")
      .field("durationMs", "10000")
      .attach("audio", Buffer.from([1, 2, 3]), {
        filename: "turn-1.m4a",
        contentType: "audio/mp4",
      });
    expect(upload.status).toBe(202);
    expect(upload.body).toEqual({ speechTurnId: "turn-1", status: "processing" });
    await vi.waitFor(() =>
      expect(speechTurnStore.get("room-1", "turn-1")?.transcript?.status).toBe("ready"),
    );

    const started = await request(app)
      .post("/api/v1/rooms/room-1/summary/generate")
      .set("Cookie", cookie)
      .set("Idempotency-Key", "summary-1")
      .send({});
    expect(started.status).toBe(202);
    expect(started.body.status).toBe("processing");
    await vi.waitFor(() => expect(summaryService.get("room-1").status).toBe("ready"));

    const fetched = await request(app).get("/api/v1/rooms/room-1/summary");
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({
      status: "ready",
      summaryVersion: 1,
      sourceTranscriptVersion: 1,
      summary: { overview: "讨论围绕测试辩题展开。" },
    });
    const cached = await request(app)
      .post("/api/v1/rooms/room-1/summary/generate")
      .set("Cookie", cookie)
      .set("Idempotency-Key", "summary-2")
      .send({});
    expect(cached.status).toBe(200);
    expect(generate).toHaveBeenCalledOnce();
  });
});
