import type { PublicUser } from "@zhiliao/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { MemoryChatStore } from "../../stores/memory/chat-store.js";
import { MemoryAccountStore } from "../../stores/memory/account-store.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";
import { createRoomSnapshot } from "../../test/room-fixture.js";

const sender: PublicUser = {
  userId: "user-1",
  identityType: "zhihu",
  displayName: "测试知友",
  avatarUrl: null,
  level: 1,
  levelTitle: "蛰伏",
};

function createTestContext() {
  const roomStore = new MemoryRoomStore();
  const chatStore = new MemoryChatStore();
  const speechTurnStore = new MemorySpeechTurnStore();
  const snapshot = createRoomSnapshot("room-history");
  roomStore.save(snapshot);
  const app = createApp({
    sessionStore: new MemorySessionStore(),
    accountStore: new MemoryAccountStore(),
    roomStore,
    chatStore,
    speechTurnStore,
    zhihuOAuthService: null,
    rtcCredentialService: null,
    sessionSecret: "test-session-secret-with-at-least-32-characters",
    secureCookies: false,
    webOrigin: "http://localhost:5173",
  });
  return { app, chatStore, speechTurnStore };
}

describe("room history routes", () => {
  it("returns recent chat messages in chronological order and paginates older entries", async () => {
    const { app, chatStore } = createTestContext();
    for (let index = 1; index <= 3; index += 1) {
      chatStore.append("room-history", {
        messageId: `message-${index}`,
        clientMessageId: `client-message-${index}`,
        type: "text",
        sender,
        content: `消息 ${index}`,
        createdAt: `2026-09-13T08:00:0${index}.000Z`,
      });
    }

    const recent = await request(app).get("/api/v1/rooms/room-history/messages?limit=2");
    expect(recent.status).toBe(200);
    expect(recent.body.items.map((item: { messageId: string }) => item.messageId)).toEqual([
      "message-2",
      "message-3",
    ]);
    expect(recent.body.nextCursor).toBe("message-2");

    const older = await request(app).get(
      `/api/v1/rooms/room-history/messages?limit=2&cursor=${recent.body.nextCursor}`,
    );
    expect(older.status).toBe(200);
    expect(older.body.items.map((item: { messageId: string }) => item.messageId)).toEqual([
      "message-1",
    ]);
    expect(older.body.nextCursor).toBeNull();
  });

  it("returns speech turns with transcript version metadata", async () => {
    const { app, speechTurnStore } = createTestContext();
    speechTurnStore.create("room-history", {
      speechTurnId: "turn-1",
      speaker: sender,
      startedAt: "2026-09-13T08:00:00.000Z",
      endedAt: "2026-09-13T08:01:00.000Z",
      releaseReason: "user_finished",
      likeCount: 2,
      transcript: {
        status: "pending",
        source: null,
        text: null,
        failureCode: null,
        updatedAt: "2026-09-13T08:01:00.000Z",
      },
    });

    const response = await request(app).get("/api/v1/rooms/room-history/speech-turns");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      items: [
        {
          speechTurnId: "turn-1",
          speaker: { userId: "user-1" },
          likeCount: 2,
          transcript: { status: "pending" },
        },
      ],
      nextCursor: null,
      transcriptVersion: 0,
    });
  });

  it("hides missing rooms", async () => {
    const { app } = createTestContext();
    const missingRoom = await request(app).get("/api/v1/rooms/missing/messages");
    expect(missingRoom.status).toBe(404);
    expect(missingRoom.body.error.code).toBe("ROOM_NOT_FOUND");
  });
});
