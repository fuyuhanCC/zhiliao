import { describe, expect, it } from "vitest";

import type { RoomSnapshot } from "../../lib/api-client";
import {
  advanceRoomVersion,
  applyCooldownUpdate,
  applyPresenceUpdate,
  applyQueueUpdate,
  applySeatUpdate,
  applySpeakerUpdate,
  classifyRoomEvent,
} from "./realtime-room-state";

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

  it("updates a seat and derives the seated count", () => {
    const snapshot = roomSnapshot();
    const occupant: NonNullable<RoomSnapshot["seats"][number]["occupant"]> = {
      userId: "user-1",
      identityType: "zhihu" as const,
      displayName: "知友一号",
      avatarUrl: null,
      level: 2,
      levelTitle: "破土",
    };

    const updated = applySeatUpdate(snapshot, 5, { seatNumber: 2, occupant });

    expect(updated.room).toMatchObject({ seatedCount: 1, version: 5 });
    expect(updated.seats[1]?.occupant).toEqual(occupant);
    expect(snapshot.seats[1]?.occupant).toBeNull();
  });

  it("replaces the queue with the order from the server", () => {
    const snapshot = roomSnapshot();
    const queue = [
      {
        position: 1,
        userId: "user-2",
        displayName: "排队用户",
        enqueuedAt: "2026-09-13T08:01:10.000Z",
      },
    ];

    const updated = applyQueueUpdate(snapshot, 5, { queue });

    expect(updated.room.version).toBe(5);
    expect(updated.queue).toEqual(queue);
  });

  it("sets and releases the speaker lock", () => {
    const snapshot = roomSnapshot();
    const speakerLock = {
      speechTurnId: "turn-1",
      userId: "user-1",
      seatNumber: 1,
      acquiredAt: "2026-09-13T08:02:00.000Z",
      expiresAt: "2026-09-13T08:04:00.000Z",
    };

    const speaking = applySpeakerUpdate(snapshot, 5, {
      speakerLock,
      releaseReason: null,
    });
    const released = applySpeakerUpdate(speaking, 6, {
      speakerLock: null,
      releaseReason: "user_finished",
    });

    expect(speaking.speakerLock).toEqual(speakerLock);
    expect(released.speakerLock).toBeNull();
    expect(released.room.version).toBe(6);
  });

  it("adds, replaces and clears a cooldown", () => {
    const snapshot = roomSnapshot();
    const expiresAt = "2026-09-13T08:05:00.000Z";
    const active = applyCooldownUpdate(snapshot, 5, { userId: "user-1", expiresAt });
    const replaced = applyCooldownUpdate(active, 6, {
      userId: "user-1",
      expiresAt: "2026-09-13T08:06:00.000Z",
    });
    const cleared = applyCooldownUpdate(replaced, 7, {
      userId: "user-1",
      expiresAt: null,
    });

    expect(active.cooldowns).toEqual([{ userId: "user-1", expiresAt }]);
    expect(replaced.cooldowns).toHaveLength(1);
    expect(replaced.cooldowns[0]?.expiresAt).toBe("2026-09-13T08:06:00.000Z");
    expect(cleared.cooldowns).toEqual([]);
  });

  it("advances the version for handled events without snapshot fields", () => {
    const snapshot = roomSnapshot();
    const updated = advanceRoomVersion(snapshot, 5);

    expect(updated.room.version).toBe(5);
    expect(snapshot.room.version).toBe(4);
  });
});
