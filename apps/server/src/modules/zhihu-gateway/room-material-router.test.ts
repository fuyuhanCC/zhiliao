import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import { MemoryChatStore } from "../../stores/memory/chat-store.js";
import { MemoryAccountStore } from "../../stores/memory/account-store.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";
import { createRoomSnapshot } from "../../test/room-fixture.js";
import { RoomMaterialService } from "./room-material-service.js";
import type { ZhihuSearchClient } from "./zhihu-search-client.js";

function createTestApp(options: { configured?: boolean; visibility?: "public" | "invite" } = {}) {
  const roomStore = new MemoryRoomStore();
  const snapshot = createRoomSnapshot("room-materials");
  snapshot.room.topic.title = "测试主题";
  snapshot.room.visibility = options.visibility ?? "public";
  roomStore.save(
    snapshot,
    options.visibility === "invite" ? { inviteCode: "invite-code" } : undefined,
  );
  const client: ZhihuSearchClient = {
    search: vi.fn(async () => ({
      items: [
        {
          title: "测试资料",
          contentType: "Answer",
          contentId: "answer-1",
          contentText: "测试摘要",
          url: "https://www.zhihu.com/question/1/answer/2?utm_source=openapi",
          commentCount: 1,
          voteUpCount: 2,
          authorName: "测试用户",
          authorAvatarUrl: null,
          editTimeSeconds: null,
        },
      ],
      hasMore: false,
      searchHashId: "search-1",
    })),
  };

  return createApp({
    sessionStore: new MemorySessionStore(),
    accountStore: new MemoryAccountStore(),
    roomStore,
    chatStore: new MemoryChatStore(),
    speechTurnStore: new MemorySpeechTurnStore(),
    zhihuOAuthService: null,
    roomMaterialService: options.configured === false ? null : new RoomMaterialService({ client }),
    rtcCredentialService: null,
    sessionSecret: "test-session-secret-with-at-least-32-characters",
    secureCookies: false,
    webOrigin: "http://localhost:5173",
  });
}

describe("room material route", () => {
  it("returns related Zhihu materials for a public room", async () => {
    const response = await request(createTestApp()).get(
      "/api/v1/rooms/room-materials/materials?limit=1",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      roomId: "room-materials",
      query: "测试主题",
      source: "zhihu",
      items: [
        {
          title: "测试资料",
          zhihuUrl: "https://www.zhihu.com/question/1/answer/2?utm_source=openapi",
        },
      ],
    });
  });

  it("enforces invite access before calling Zhihu", async () => {
    const app = createTestApp({ visibility: "invite" });

    const denied = await request(app).get("/api/v1/rooms/room-materials/materials");
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("INVITE_REQUIRED");

    const allowed = await request(app).get(
      "/api/v1/rooms/room-materials/materials?inviteCode=invite-code",
    );
    expect(allowed.status).toBe(200);
  });

  it("reports missing configuration without exposing credentials", async () => {
    const response = await request(createTestApp({ configured: false })).get(
      "/api/v1/rooms/room-materials/materials",
    );

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("ZHIHU_API_UNAVAILABLE");
  });
});
