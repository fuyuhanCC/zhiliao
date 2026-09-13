import { describe, expect, it, vi } from "vitest";

import { RoomEventBus } from "../../realtime/room-event-bus.js";
import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";
import type { SpeechTurn } from "../../stores/speech-turn-store.js";
import { createRoomSnapshot } from "../../test/room-fixture.js";
import { TranscriptRequestError, TranscriptService } from "./transcript-service.js";

const turn: SpeechTurn = {
  speechTurnId: "turn-1",
  speaker: {
    userId: "user-1",
    identityType: "zhihu",
    displayName: "知友一",
    avatarUrl: null,
    level: 1,
    levelTitle: "蛰伏",
  },
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
};

describe("TranscriptService", () => {
  it("moves a speech turn through processing to ready and increments the transcript version", async () => {
    const roomStore = new MemoryRoomStore();
    roomStore.save(createRoomSnapshot("room-1"));
    const speechTurnStore = new MemorySpeechTurnStore();
    speechTurnStore.create("room-1", turn);
    const eventBus = new RoomEventBus();
    const events: string[] = [];
    eventBus.subscribe((event) => events.push(`${event.name}:${event.data.status}`));
    const transcribe = vi.fn(async () => "转写完成。");
    const service = new TranscriptService({
      roomStore,
      speechTurnStore,
      eventBus,
      client: { transcribe },
    });

    expect(
      service.start({
        roomId: "room-1",
        speechTurnId: "turn-1",
        userId: "user-1",
        idempotencyKey: "upload-1",
        audio: Uint8Array.from([1, 2, 3]),
        format: "m4a",
      }),
    ).toEqual({ speechTurnId: "turn-1", status: "processing" });

    await vi.waitFor(() => {
      expect(speechTurnStore.get("room-1", "turn-1")?.transcript).toMatchObject({
        status: "ready",
        source: "asr",
        text: "转写完成。",
      });
    });
    expect(speechTurnStore.getTranscriptVersion("room-1")).toBe(1);
    expect(events).toEqual(["transcript:updated:processing", "transcript:updated:ready"]);
    expect(transcribe).toHaveBeenCalledOnce();
  });

  it("rejects uploads from anyone except the recorded speaker", () => {
    const roomStore = new MemoryRoomStore();
    roomStore.save(createRoomSnapshot("room-1"));
    const speechTurnStore = new MemorySpeechTurnStore();
    speechTurnStore.create("room-1", turn);
    const service = new TranscriptService({
      roomStore,
      speechTurnStore,
      client: { transcribe: vi.fn() },
    });

    expect(() =>
      service.start({
        roomId: "room-1",
        speechTurnId: "turn-1",
        userId: "user-2",
        idempotencyKey: "upload-1",
        audio: Uint8Array.from([1]),
        format: "wav",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<TranscriptRequestError>>({
        status: 403,
        code: "FORBIDDEN",
      }),
    );
  });
});
