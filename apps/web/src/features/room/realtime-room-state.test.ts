import { describe, expect, it } from "vitest";

import type { RoomSnapshot } from "../../lib/api-client";
import { applyPresenceUpdate, classifyRoomEvent } from "./realtime-room-state";

function roomSnapshot(version = 4): RoomSnapshot {
  return {
    room: {
      roomId: "room-1",
      type: "custom",
      status: "active",
      visibility: "public",
      topic: {
        source: "manual",
        title: "测试房间",
        zhihuQuestionId: null,
        zhihuUrl: null,
        excerpt: null,
        imageUrl: null,
        answerExcerpts: [],
        hotRank: null,
      },
      creator: null,
      onlineCount: 1,
      seatedCount: 0,
      createdAt: "2026-09-14T00:00:00.000Z",
      version,
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

describe("realtime room state", () => {
  it("classifies duplicate, continuous and missing room events", () => {
    const snapshot = roomSnapshot();

    expect(classifyRoomEvent(snapshot, 4)).toBe("stale");
    expect(classifyRoomEvent(snapshot, 5)).toBe("next");
    expect(classifyRoomEvent(snapshot, 7)).toBe("gap");
    expect(classifyRoomEvent(null, 1)).toBe("gap");
  });

  it("applies presence without mutating the previous snapshot", () => {
    const snapshot = roomSnapshot();
    const updated = applyPresenceUpdate(snapshot, 5, 3);

    expect(updated.room).toMatchObject({ onlineCount: 3, version: 5 });
    expect(snapshot.room).toMatchObject({ onlineCount: 1, version: 4 });
  });
});
