import { createHmac } from "node:crypto";

import { z } from "zod";

const flashResponseSchema = z.object({
  code: z.coerce.number().int(),
  message: z.string().optional(),
  request_id: z.string().optional(),
  flash_result: z
    .array(
      z.object({
        channel_id: z.coerce.number().int(),
        text: z.string(),
      }),
    )
    .optional(),
});

export const TENCENT_FLASH_AUDIO_FORMATS = ["wav", "mp3", "m4a", "ogg-opus", "aac", "amr"] as const;

export type TencentFlashAudioFormat = (typeof TENCENT_FLASH_AUDIO_FORMATS)[number];

export interface SpeechRecognitionInput {
  audio: Uint8Array;
  format: TencentFlashAudioFormat;
}

export interface SpeechRecognitionClient {
  transcribe(input: SpeechRecognitionInput): Promise<string>;
}

export interface TencentFlashAsrClientOptions {
  appId: number;
  secretId: string;
  secretKey: string;
  engineType?: string;
  endpoint?: string;
  requestTimeoutMilliseconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class TencentFlashAsrError extends Error {
  constructor(
    message: string,
    readonly upstreamCode: number | null = null,
  ) {
    super(message);
    this.name = "TencentFlashAsrError";
  }
}

export class TencentFlashAsrClient implements SpeechRecognitionClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly requestTimeoutMilliseconds: number;

  constructor(private readonly options: TencentFlashAsrClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.requestTimeoutMilliseconds = options.requestTimeoutMilliseconds ?? 30_000;
  }

  async transcribe(input: SpeechRecognitionInput): Promise<string> {
    const endpoint = new URL(
      `/asr/flash/v1/${this.options.appId}`,
      this.options.endpoint ?? "https://asr.cloud.tencent.com",
    );
    const parameters: Record<string, string> = {
      convert_num_mode: "1",
      engine_type: this.options.engineType ?? "16k_zh",
      filter_dirty: "0",
      filter_modal: "0",
      filter_punc: "0",
      first_channel_only: "1",
      secretid: this.options.secretId,
      speaker_diarization: "0",
      timestamp: String(Math.floor(this.now().getTime() / 1000)),
      voice_format: input.format,
      word_info: "0",
    };
    for (const key of Object.keys(parameters).sort()) {
      endpoint.searchParams.set(key, parameters[key]!);
    }

    const signatureSource = `POST${endpoint.host}${endpoint.pathname}?${endpoint.searchParams.toString()}`;
    const signature = createHmac("sha1", this.options.secretKey)
      .update(signatureSource)
      .digest("base64");

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: signature,
          "Content-Type": "application/octet-stream",
        },
        body: Buffer.from(input.audio),
        redirect: "error",
        signal: AbortSignal.timeout(this.requestTimeoutMilliseconds),
      });
    } catch {
      throw new TencentFlashAsrError("腾讯云语音识别请求失败");
    }

    if (!response.ok) {
      throw new TencentFlashAsrError(`腾讯云语音识别返回 HTTP ${response.status}`);
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new TencentFlashAsrError("腾讯云语音识别返回了无效 JSON");
    }
    const parsed = flashResponseSchema.safeParse(responseBody);
    if (!parsed.success) {
      throw new TencentFlashAsrError("腾讯云语音识别响应结构不完整");
    }
    if (parsed.data.code !== 0) {
      throw new TencentFlashAsrError(
        parsed.data.message || "腾讯云语音识别返回业务错误",
        parsed.data.code,
      );
    }

    const text = (parsed.data.flash_result ?? [])
      .sort((left, right) => left.channel_id - right.channel_id)
      .map((result) => result.text.trim())
      .filter(Boolean)
      .join("\n");
    if (!text) {
      throw new TencentFlashAsrError("腾讯云语音识别未返回文本");
    }
    return text;
  }
}
