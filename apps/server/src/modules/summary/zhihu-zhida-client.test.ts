import { describe, expect, it, vi } from "vitest";

import type { SpeechTurn } from "../../stores/speech-turn-store.js";
import { HttpZhihuZhidaClient } from "./zhihu-zhida-client.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

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
    status: "ready",
    source: "asr",
    text: "我支持这个观点。",
    failureCode: null,
    updatedAt: "2026-09-14T00:00:11.000Z",
  },
};

describe("HttpZhihuZhidaClient", () => {
  it("calls the official chat completions endpoint and parses fenced JSON", async () => {
    const draft = {
      overview: "双方围绕主题展开讨论。",
      viewpoints: [{ speakerUserId: "user-1", summary: "支持", speechTurnIds: ["turn-1"] }],
      agreements: [],
      disagreements: ["是否支持"],
      openQuestions: [],
      timeline: [{ speechTurnId: "turn-1", summary: "表达支持" }],
    };
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchInit) =>
      Response.json({
        choices: [
          {
            message: { role: "assistant", content: `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\`` },
          },
        ],
      }),
    );
    const client = new HttpZhihuZhidaClient({
      apiUrl: "https://developer.zhihu.com/v1/chat/completions",
      accessSecret: "access-secret",
      now: () => new Date("2026-09-14T00:00:00.000Z"),
      fetchImpl,
    });

    await expect(client.generate("测试主题", [turn])).resolves.toEqual(draft);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://developer.zhihu.com/v1/chat/completions");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-secret");
    expect(new Headers(init?.headers).get("X-Request-Timestamp")).toBe("1789344000");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: "zhida-fast-1p5",
      stream: false,
    });
  });
});
