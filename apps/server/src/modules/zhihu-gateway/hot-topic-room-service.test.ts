import { describe, expect, it, vi } from "vitest";

import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { HotTopicRoomService, InvalidHotTopicCursorError } from "./hot-topic-room-service.js";
import type { ZhihuHotListClient } from "./zhihu-hot-list-client.js";

function successfulClient(): ZhihuHotListClient {
  return {
    list: vi.fn(async () => ({
      total: 2,
      items: [
        {
          title: "热点问题",
          url: "https://www.zhihu.com/question/123456789?utm_source=openapi",
          thumbnailUrl: "https://picx.zhimg.com/hot.jpg",
          summary: "热点问题摘要",
        },
        {
          title: "热点文章",
          url: "https://zhuanlan.zhihu.com/p/987654321",
          thumbnailUrl: "",
          summary: "",
        },
      ],
    })),
  };
}

describe("HotTopicRoomService", () => {
  it("maps Zhihu hot topics and synchronizes stable official rooms", async () => {
    const roomStore = new MemoryRoomStore();
    const client = successfulClient();
    const service = new HotTopicRoomService({
      roomStore,
      client,
      now: () => new Date("2026-09-13T08:00:00.000Z"),
    });

    const first = await service.list({ limit: 1 });
    expect(first).toMatchObject({
      source: "zhihu",
      fetchedAt: "2026-09-13T08:00:00.000Z",
      items: [
        {
          source: "zhihu_hot",
          title: "热点问题",
          zhihuQuestionId: "123456789",
          hotRank: 1,
        },
      ],
    });
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await service.list({ cursor: first.nextCursor!, limit: 1 });
    expect(second).toMatchObject({
      source: "cache",
      items: [{ title: "热点文章", hotRank: 2, imageUrl: null }],
      nextCursor: null,
    });
    expect(client.list).toHaveBeenCalledOnce();

    const officialRooms = roomStore.list({ type: "hot", limit: 20 }).items;
    expect(officialRooms).toHaveLength(2);
    expect(officialRooms[0]).toMatchObject({
      type: "hot",
      visibility: "public",
      creator: null,
      topic: { source: "zhihu_hot", hotRank: 1 },
    });
    expect(roomStore.get(officialRooms[0]!.roomId)?.seats).toHaveLength(6);

    await service.ensureRooms();
    expect(roomStore.list({ type: "hot", limit: 20 }).items.map((room) => room.roomId)).toEqual(
      officialRooms.map((room) => room.roomId),
    );
  });

  it("uses preset official rooms when the upstream is unavailable", async () => {
    const roomStore = new MemoryRoomStore();
    const client: ZhihuHotListClient = {
      list: vi.fn(async () => {
        throw new Error("upstream unavailable");
      }),
    };
    const service = new HotTopicRoomService({
      roomStore,
      client,
      now: () => new Date("2026-09-13T08:00:00.000Z"),
    });

    const page = await service.list({ limit: 20 });

    expect(page.source).toBe("fallback");
    expect(page.items).toHaveLength(5);
    expect(page.items.every((topic) => topic.source === "manual")).toBe(true);
    expect(roomStore.list({ type: "hot", limit: 20 }).items).toHaveLength(5);
  });

  it("rejects malformed pagination cursors", async () => {
    const service = new HotTopicRoomService({
      roomStore: new MemoryRoomStore(),
      client: null,
    });

    await expect(service.list({ cursor: "not-a-cursor", limit: 1 })).rejects.toBeInstanceOf(
      InvalidHotTopicCursorError,
    );
  });
});
