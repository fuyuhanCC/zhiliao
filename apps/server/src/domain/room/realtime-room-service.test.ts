import type { PublicUser } from "@zhiliao/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemoryAccountStore } from "../../stores/memory/account-store.js";
import { MemoryChatStore } from "../../stores/memory/chat-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";
import { createRoomSnapshot } from "../../test/room-fixture.js";
import {
  RealtimeRoomService,
  type RealtimeStateEvent,
  type RoomParticipant,
} from "./realtime-room-service.js";

function participant(
  index: number,
  identityType: PublicUser["identityType"] = "zhihu",
): RoomParticipant {
  return {
    sessionId: `session-${index}`,
    user: {
      userId: `user-${index}`,
      identityType,
      displayName: `用户 ${index}`,
      avatarUrl: null,
      level: 1,
      levelTitle: "蛰伏",
    },
  };
}

describe("RealtimeRoomService", () => {
  const roomId = "room_realtime";
  let roomStore: MemoryRoomStore;
  let accountStore: MemoryAccountStore;
  let chatStore: MemoryChatStore;
  let speechTurnStore: MemorySpeechTurnStore;
  let events: RealtimeStateEvent[];
  let service: RealtimeRoomService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T08:00:00.000Z"));
    roomStore = new MemoryRoomStore();
    accountStore = new MemoryAccountStore();
    chatStore = new MemoryChatStore();
    speechTurnStore = new MemorySpeechTurnStore();
    roomStore.save(createRoomSnapshot(roomId));
    events = [];
    service = new RealtimeRoomService({
      roomStore,
      accountStore,
      chatStore,
      speechTurnStore,
      emit: (event) => events.push(event),
      emitAccountUpdate: vi.fn(),
      generateId: () => `id-${events.length + 1}`,
      speechLimitMilliseconds: 120_000,
      cooldownMilliseconds: 60_000,
      speakerTickMilliseconds: 5000,
      disconnectGraceMilliseconds: 10_000,
    });
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  it("fills six seats, queues the seventh user and promotes FIFO", () => {
    const users = Array.from({ length: 7 }, (_, index) => participant(index + 1));
    for (const user of users) {
      expect(service.join(roomId, user).ok).toBe(true);
    }

    for (const [index, user] of users.entries()) {
      const result = service.requestSeat(roomId, user);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe(index < 6 ? "seated" : "queued");
      }
    }

    const fullSnapshot = roomStore.get(roomId)!;
    expect(fullSnapshot.room.seatedCount).toBe(6);
    expect(fullSnapshot.queue).toMatchObject([{ position: 1, userId: "user-7" }]);

    const leaveResult = service.leaveSeat(roomId, users[0]!);
    expect(leaveResult.ok).toBe(true);
    const promotedSnapshot = roomStore.get(roomId)!;
    expect(promotedSnapshot.seats[0]?.occupant?.userId).toBe("user-7");
    expect(promotedSnapshot.queue).toEqual([]);
    expect(promotedSnapshot.room.seatedCount).toBe(6);
  });

  it("requires Zhihu login for seats and enforces the unique speaker lock", () => {
    const guest = participant(1, "guest");
    const firstSpeaker = participant(2);
    const secondSpeaker = participant(3);
    service.join(roomId, guest);
    service.join(roomId, firstSpeaker);
    service.join(roomId, secondSpeaker);

    const guestSeat = service.requestSeat(roomId, guest);
    expect(guestSeat).toMatchObject({ ok: false, error: { code: "ZHIHU_LOGIN_REQUIRED" } });
    service.requestSeat(roomId, firstSpeaker);
    service.requestSeat(roomId, secondSpeaker);

    const acquired = service.acquireSpeaker(roomId, firstSpeaker);
    expect(acquired.ok).toBe(true);
    const locked = service.acquireSpeaker(roomId, secondSpeaker);
    expect(locked).toMatchObject({
      ok: false,
      error: { code: "SPEAKER_LOCKED", details: { speakerUserId: "user-2" } },
    });
  });

  it("closes a speech at the time limit and clears cooldown after sixty seconds", async () => {
    const speaker = participant(1);
    service.join(roomId, speaker);
    service.requestSeat(roomId, speaker);
    const acquired = service.acquireSpeaker(roomId, speaker);
    expect(acquired.ok).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(roomStore.get(roomId)?.speakerLock).toBeNull();
    expect(roomStore.get(roomId)?.cooldowns).toHaveLength(1);
    expect(events.some((event) => event.name === "speaker:tick")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.name === "speech:closed" && event.event.data.releaseReason === "time_limit",
      ),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(roomStore.get(roomId)?.cooldowns).toEqual([]);
    expect(
      events.some(
        (event) => event.name === "cooldown:updated" && event.event.data.expiresAt === null,
      ),
    ).toBe(true);
  });

  it("deduplicates likes per session and releases a disconnected speaker immediately", () => {
    const speaker = participant(1);
    const audience = participant(2, "guest");
    service.join(roomId, speaker);
    service.join(roomId, audience);
    service.requestSeat(roomId, speaker);
    const acquired = service.acquireSpeaker(roomId, speaker);
    if (!acquired.ok) {
      throw new Error("expected speaker acquisition to succeed");
    }

    expect(service.likeSpeaker(roomId, audience, acquired.data.speechTurnId).ok).toBe(true);
    expect(service.likeSpeaker(roomId, audience, acquired.data.speechTurnId)).toMatchObject({
      ok: false,
      error: { code: "ALREADY_LIKED" },
    });

    service.disconnect(roomId, speaker.sessionId);
    expect(roomStore.get(roomId)?.speakerLock).toBeNull();
    expect(roomStore.get(roomId)?.seats[0]?.occupant?.userId).toBe(speaker.user.userId);
    expect(
      events.some(
        (event) =>
          event.name === "speech:closed" && event.event.data.releaseReason === "disconnected",
      ),
    ).toBe(true);
  });

  it("persists chat and closes the speech turn with its like count", () => {
    const speaker = participant(1);
    const audience = participant(2, "guest");
    service.join(roomId, speaker);
    service.join(roomId, audience);
    service.requestSeat(roomId, speaker);
    const acquired = service.acquireSpeaker(roomId, speaker);
    if (!acquired.ok) {
      throw new Error("expected speaker acquisition to succeed");
    }

    service.sendChat(roomId, audience, "client-message-1", "一条公屏消息");
    service.likeSpeaker(roomId, audience, acquired.data.speechTurnId);
    service.releaseSpeakerByUser(roomId, speaker, acquired.data.speechTurnId);

    expect(chatStore.list(roomId, { limit: 30 })).toMatchObject({
      items: [{ content: "一条公屏消息", sender: { userId: "user-2" } }],
      nextCursor: null,
    });
    expect(speechTurnStore.list(roomId, { limit: 50 })).toMatchObject({
      items: [
        {
          speechTurnId: acquired.data.speechTurnId,
          speaker: { userId: "user-1" },
          endedAt: "2026-09-13T08:00:00.000Z",
          releaseReason: "user_finished",
          likeCount: 1,
          transcript: { status: "pending", source: null, text: null },
        },
      ],
      nextCursor: null,
      transcriptVersion: 0,
    });
  });

  it("rewards only the active speaker and never double charges an idempotent request", () => {
    const speaker = participant(1);
    const audience = participant(2, "guest");
    service.join(roomId, speaker);
    service.join(roomId, audience);
    service.requestSeat(roomId, speaker);
    const acquired = service.acquireSpeaker(roomId, speaker);
    if (!acquired.ok) {
      throw new Error("expected speaker acquisition to succeed");
    }

    const first = service.rewardSpeaker(
      roomId,
      audience,
      acquired.data.speechTurnId,
      10,
      "session-2:reward:req-1",
    );
    const replay = service.rewardSpeaker(
      roomId,
      audience,
      acquired.data.speechTurnId,
      10,
      "session-2:reward:req-1",
    );

    expect(first).toMatchObject({
      ok: true,
      data: {
        amount: 10,
        recipientUserId: "user-1",
        remainingBalance: 90,
      },
    });
    expect(replay).toEqual(first);
    expect(accountStore.get("user-1")).toMatchObject({ coinBalance: 110, experience: 2 });
    expect(accountStore.get("user-2")?.coinBalance).toBe(90);
    expect(events.filter((event) => event.name === "reward:created")).toHaveLength(1);
    expect(chatStore.list(roomId, { limit: 30 }).items).toMatchObject([
      {
        type: "system",
        sender: null,
        content: "用户 2 打赏了 用户 1 10 知豆",
      },
    ]);

    expect(
      service.rewardSpeaker(
        roomId,
        speaker,
        acquired.data.speechTurnId,
        5,
        "session-1:reward:req-self",
      ),
    ).toMatchObject({ ok: false, error: { code: "SELF_REWARD_NOT_ALLOWED" } });
  });

  it("keeps a seat during the disconnect grace period and cleans it afterwards", async () => {
    const speaker = participant(1);
    service.join(roomId, speaker);
    service.requestSeat(roomId, speaker);

    service.disconnect(roomId, speaker.sessionId);
    await vi.advanceTimersByTimeAsync(9999);
    expect(roomStore.get(roomId)?.seats[0]?.occupant?.userId).toBe(speaker.user.userId);

    await vi.advanceTimersByTimeAsync(1);
    expect(roomStore.get(roomId)?.seats[0]?.occupant).toBeNull();
    expect(roomStore.get(roomId)?.room.onlineCount).toBe(0);
  });

  it("cancels disconnect cleanup when the same session rejoins", async () => {
    const speaker = participant(1);
    service.join(roomId, speaker);
    service.requestSeat(roomId, speaker);

    service.disconnect(roomId, speaker.sessionId);
    await vi.advanceTimersByTimeAsync(5000);
    expect(service.join(roomId, speaker).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(roomStore.get(roomId)?.seats[0]?.occupant?.userId).toBe(speaker.user.userId);
    expect(roomStore.get(roomId)?.room.onlineCount).toBe(1);
  });
});
