import type { RoomSnapshot } from "../stores/room-store.js";

export function createRoomSnapshot(roomId = "room_123"): RoomSnapshot {
  return {
    room: {
      roomId,
      type: "custom",
      status: "active",
      visibility: "public",
      topic: {
        source: "manual",
        title: "测试辩题",
        zhihuQuestionId: null,
        zhihuUrl: null,
        excerpt: null,
        imageUrl: null,
        answerExcerpts: [],
        hotRank: null,
      },
      creator: null,
      onlineCount: 0,
      seatedCount: 0,
      createdAt: "2026-09-13T00:00:00.000Z",
      version: 1,
    },
    seats: Array.from({ length: 6 }, (_, index) => ({
      seatNumber: index + 1,
      occupant: null,
    })),
    queue: [],
    speakerLock: null,
    cooldowns: [],
  };
}
