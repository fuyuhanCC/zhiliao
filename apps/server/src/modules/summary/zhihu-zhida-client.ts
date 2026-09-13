import { z } from "zod";

import type { SpeechTurn } from "../../stores/speech-turn-store.js";

const draftSchema = z.object({
  overview: z.string().trim().min(1).max(3000),
  viewpoints: z
    .array(
      z.object({
        speakerUserId: z.string().min(1),
        summary: z.string().trim().min(1).max(1000),
        speechTurnIds: z.array(z.string().min(1)).max(100),
      }),
    )
    .max(20),
  agreements: z.array(z.string().trim().min(1).max(500)).max(20),
  disagreements: z.array(z.string().trim().min(1).max(500)).max(20),
  openQuestions: z.array(z.string().trim().min(1).max(500)).max(20),
  timeline: z
    .array(
      z.object({
        speechTurnId: z.string().min(1),
        summary: z.string().trim().min(1).max(500),
      }),
    )
    .max(200),
});

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

export type SummaryDraft = z.infer<typeof draftSchema>;

export interface ZhidaSummaryClient {
  generate(topicTitle: string, turns: SpeechTurn[]): Promise<SummaryDraft>;
}

export interface HttpZhihuZhidaClientOptions {
  apiUrl: string;
  accessSecret: string;
  model?: "zhida-fast-1p5" | "zhida-thinking-1p5" | "zhida-agent";
  requestTimeoutMilliseconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class ZhihuZhidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZhihuZhidaError";
  }
}

export class HttpZhihuZhidaClient implements ZhidaSummaryClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly requestTimeoutMilliseconds: number;

  constructor(private readonly options: HttpZhihuZhidaClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.requestTimeoutMilliseconds = options.requestTimeoutMilliseconds ?? 30_000;
  }

  async generate(topicTitle: string, turns: SpeechTurn[]): Promise<SummaryDraft> {
    const transcriptInput = turns.map((turn) => ({
      speechTurnId: turn.speechTurnId,
      speakerUserId: turn.speaker.userId,
      speakerDisplayName: turn.speaker.displayName,
      startedAt: turn.startedAt,
      text: turn.transcript?.text,
    }));
    const prompt = [
      "你是多人语音讨论的客观记录员。只根据给出的转写内容总结，不补充外部事实，不判断输赢。",
      "请只返回一个 JSON 对象，不要使用 Markdown 代码块。字段必须为：",
      '{"overview":"总览","viewpoints":[{"speakerUserId":"用户ID","summary":"观点","speechTurnIds":["发言ID"]}],"agreements":["共识"],"disagreements":["分歧"],"openQuestions":["待讨论问题"],"timeline":[{"speechTurnId":"发言ID","summary":"该段摘要"}]}',
      "speechTurnId 和 speakerUserId 必须原样使用输入中的值；每条 timeline 对应一个输入发言。",
      `讨论主题：${topicTitle}`,
      `发言记录：${JSON.stringify(transcriptInput)}`,
    ].join("\n");

    let response: Response;
    try {
      response = await this.fetchImpl(this.options.apiUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.options.accessSecret}`,
          "Content-Type": "application/json",
          "X-Request-Timestamp": String(Math.floor(this.now().getTime() / 1000)),
        },
        body: JSON.stringify({
          model: this.options.model ?? "zhida-fast-1p5",
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(this.requestTimeoutMilliseconds),
      });
    } catch {
      throw new ZhihuZhidaError("知乎直答请求失败");
    }
    if (!response.ok) {
      throw new ZhihuZhidaError(`知乎直答返回 HTTP ${response.status}`);
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new ZhihuZhidaError("知乎直答返回了无效 JSON");
    }
    const parsedResponse = responseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new ZhihuZhidaError("知乎直答响应结构不完整");
    }

    const content = parsedResponse.data.choices[0]!.message.content.trim();
    const withoutFence = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const firstBrace = withoutFence.indexOf("{");
    const lastBrace = withoutFence.lastIndexOf("}");
    const jsonText =
      firstBrace >= 0 && lastBrace >= firstBrace
        ? withoutFence.slice(firstBrace, lastBrace + 1)
        : withoutFence;
    let draft: unknown;
    try {
      draft = JSON.parse(jsonText);
    } catch {
      throw new ZhihuZhidaError("知乎直答未返回有效的结构化总结");
    }
    const parsedDraft = draftSchema.safeParse(draft);
    if (!parsedDraft.success) {
      throw new ZhihuZhidaError("知乎直答总结字段不完整");
    }
    return parsedDraft.data;
  }
}
