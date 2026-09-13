import { describe, expect, it, vi } from "vitest";

import { MemoryRoomStore } from "../../stores/memory/room-store.js";
import { MemorySpeechTurnStore } from "../../stores/memory/speech-turn-store.js";
import { MemorySummaryStore } from "../../stores/memory/summary-store.js";
import type { SpeechTurn } from "../../stores/speech-turn-store.js";
import { createRoomSnapshot } from "../../test/room-fixture.js";
import { SummaryService } from "./summary-service.js";

describe("SummaryService", () => {
  it("generates once per transcript version and trusts server-owned identity fields", async () => {
    const roomStore = new MemoryRoomStore();
    roomStore.save(createRoomSnapshot("room-1"));
    const speechTurnStore = new MemorySpeechTurnStore();
    const pendingTurn: SpeechTurn = {
      speechTurnId: "turn-1",
      speaker: {
        userId: "user-1",
        identityType: "zhihu",
        displayName: "真实昵称",
        avatarUrl: null,
        level: 2,
        levelTitle: "破土",
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
    speechTurnStore.create("room-1", pendingTurn);
    speechTurnStore.update("room-1", {
      ...pendingTurn,
      transcript: {
        status: "ready",
        source: "asr",
        text: "我的观点。",
        failureCode: null,
        updatedAt: "2026-09-14T00:00:11.000Z",
      },
    });
    const generate = vi.fn(async () => ({
      overview: "讨论概览",
      viewpoints: [{ speakerUserId: "user-1", summary: "主要观点", speechTurnIds: ["turn-1"] }],
      agreements: ["一项共识"],
      disagreements: [],
      openQuestions: [],
      timeline: [{ speechTurnId: "turn-1", summary: "首段发言" }],
    }));
    const service = new SummaryService({
      roomStore,
      speechTurnStore,
      summaryStore: new MemorySummaryStore(),
      client: { generate },
    });

    expect(service.start("room-1")).toMatchObject({
      statusCode: 202,
      resource: { status: "processing" },
    });
    await vi.waitFor(() => expect(service.get("room-1").status).toBe("ready"));
    expect(service.get("room-1")).toMatchObject({
      summaryVersion: 1,
      sourceTranscriptVersion: 1,
      summary: {
        topicTitle: "测试辩题",
        viewpoints: [{ speaker: { displayName: "真实昵称", level: 2 }, speechTurnIds: ["turn-1"] }],
        timeline: [{ speechTurnId: "turn-1", speaker: { userId: "user-1" } }],
      },
    });
    expect(service.start("room-1").statusCode).toBe(200);
    expect(generate).toHaveBeenCalledOnce();
  });
});
