import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import { MemoryAccountStore } from "../../stores/memory/account-store.js";
import { MemoryChatStore } from "../../stores/memory/chat-store.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySessionStore } from "../../stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";
import { HotTopicRoomService } from "./hot-topic-room-service.js";
import type { ZhihuHotListClient } from "./zhihu-hot-list-client.js";

function createTestApp() {
  const roomStore = new MemoryRoomStore();
  const client: ZhihuHotListClient = {
    list: vi.fn(async () => ({
      total: 1,
      items: [
        {
          title: "知乎热榜测试问题",
          url: "https://www.zhihu.com/question/123456789",
          thumbnailUrl: "https://picx.zhimg.com/hot.jpg",
          summary: "测试摘要",
        },
      ],
    })),
  };
  const hotTopicRoomService = new HotTopicRoomService({ roomStore, client });

  return createApp({
    sessionStore: new MemorySessionStore(),
    accountStore: new MemoryAccountStore(),
    roomStore,
    chatStore: new MemoryChatStore(),
    speechTurnStore: new MemorySpeechTurnStore(),
    zhihuOAuthService: null,
    hotTopicRoomService,
    rtcCredentialService: null,
    sessionSecret: "test-session-secret-with-at-least-32-characters",
    secureCookies: false,
    webOrigin: "http://localhost:5173",
  });
}

describe("hot topic and official room routes", () => {
  it("returns Zhihu hot topics and exposes their synchronized official rooms", async () => {
    const app = createTestApp();

    const topics = await request(app).get("/api/v1/topics/hot?limit=10");
    expect(topics.status).toBe(200);
    expect(topics.body).toMatchObject({
      source: "zhihu",
      items: [{ source: "zhihu_hot", title: "知乎热榜测试问题", hotRank: 1 }],
    });

    const rooms = await request(app).get("/api/v1/rooms?type=hot");
    expect(rooms.status).toBe(200);
    expect(rooms.body.items).toMatchObject([
      {
        type: "hot",
        visibility: "public",
        creator: null,
        topic: { title: "知乎热榜测试问题", hotRank: 1 },
      },
    ]);
  });

  it("synchronizes official rooms when the lobby endpoint is called first", async () => {
    const response = await request(createTestApp()).get("/api/v1/rooms?type=hot");

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].topic.source).toBe("zhihu_hot");
  });

  it("rejects invalid hot-topic cursors", async () => {
    const response = await request(createTestApp()).get("/api/v1/topics/hot?cursor=invalid");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
