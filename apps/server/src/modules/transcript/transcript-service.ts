import type { TranscriptUpdatedData } from "@zhiliao/shared";
import type { components } from "@zhiliao/shared/openapi";

import type { RoomEventBus } from "../../realtime/room-event-bus.js";
import type { RoomStore } from "../../stores/room-store.js";
import type { SpeechTurnStore } from "../../stores/speech-turn-store.js";
import type {
  SpeechRecognitionClient,
  TencentFlashAudioFormat,
} from "./tencent-flash-asr-client.js";

type TranscriptStatusResponse = components["schemas"]["TranscriptStatusResponse"];

export class TranscriptRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TranscriptRequestError";
  }
}

export interface TranscriptServiceOptions {
  roomStore: RoomStore;
  speechTurnStore: SpeechTurnStore;
  client: SpeechRecognitionClient;
  eventBus?: RoomEventBus;
  now?: () => Date;
  onBackgroundError?: (error: unknown) => void;
}

export interface StartTranscriptInput {
  roomId: string;
  speechTurnId: string;
  userId: string;
  idempotencyKey: string;
  audio: Uint8Array;
  format: TencentFlashAudioFormat;
}

export class TranscriptService {
  private readonly now: () => Date;
  private readonly idempotentResponses = new Map<string, TranscriptStatusResponse>();

  constructor(private readonly options: TranscriptServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(input: StartTranscriptInput): TranscriptStatusResponse {
    const cacheKey = `${input.userId}:${input.roomId}:${input.speechTurnId}:${input.idempotencyKey}`;
    const cached = this.idempotentResponses.get(cacheKey);
    if (cached) {
      return structuredClone(cached);
    }

    const snapshot = this.options.roomStore.get(input.roomId);
    if (!snapshot || snapshot.room.status === "closed") {
      throw new TranscriptRequestError(404, "ROOM_NOT_FOUND", "房间不存在或已回收");
    }
    const turn = this.options.speechTurnStore.get(input.roomId, input.speechTurnId);
    if (!turn) {
      throw new TranscriptRequestError(404, "SPEECH_TURN_NOT_FOUND", "发言记录不存在");
    }
    if (turn.speaker.userId !== input.userId) {
      throw new TranscriptRequestError(403, "FORBIDDEN", "只能上传本人的发言音频");
    }
    if (turn.endedAt === null) {
      throw new TranscriptRequestError(409, "SPEECH_TURN_ACTIVE", "请在本次发言结束后上传音频");
    }

    if (turn.transcript?.status === "ready" || turn.transcript?.status === "processing") {
      const response = {
        speechTurnId: turn.speechTurnId,
        status: turn.transcript.status,
      } satisfies TranscriptStatusResponse;
      this.remember(cacheKey, response);
      return response;
    }

    const processingTurn = {
      ...turn,
      transcript: {
        status: "processing" as const,
        source: "asr" as const,
        text: null,
        failureCode: null,
        updatedAt: this.now().toISOString(),
      },
    };
    this.options.speechTurnStore.update(input.roomId, processingTurn);
    this.publish(input.roomId, processingTurn.speechTurnId, processingTurn.transcript);

    const response = {
      speechTurnId: turn.speechTurnId,
      status: "processing" as const,
    } satisfies TranscriptStatusResponse;
    this.remember(cacheKey, response);

    const audio = Uint8Array.from(input.audio);
    void this.process(input.roomId, input.speechTurnId, audio, input.format).catch((error) => {
      this.options.onBackgroundError?.(error);
    });
    return response;
  }

  private async process(
    roomId: string,
    speechTurnId: string,
    audio: Uint8Array,
    format: TencentFlashAudioFormat,
  ): Promise<void> {
    try {
      const text = await this.options.client.transcribe({ audio, format });
      this.finish(roomId, speechTurnId, {
        status: "ready",
        source: "asr",
        text,
        failureCode: null,
        updatedAt: this.now().toISOString(),
      });
    } catch (error) {
      this.finish(roomId, speechTurnId, {
        status: "failed",
        source: "asr",
        text: null,
        failureCode: "ASR_FAILED",
        updatedAt: this.now().toISOString(),
      });
      throw error;
    }
  }

  private finish(
    roomId: string,
    speechTurnId: string,
    transcript: NonNullable<components["schemas"]["SpeechTurn"]["transcript"]>,
  ): void {
    const turn = this.options.speechTurnStore.get(roomId, speechTurnId);
    if (!turn) {
      return;
    }
    this.options.speechTurnStore.update(roomId, { ...turn, transcript });
    this.publish(roomId, speechTurnId, transcript);
  }

  private publish(
    roomId: string,
    speechTurnId: string,
    transcript: NonNullable<components["schemas"]["SpeechTurn"]["transcript"]>,
  ): void {
    const data: TranscriptUpdatedData = {
      speechTurnId,
      status: transcript.status,
      source: transcript.source,
      text: transcript.text,
      failureCode: transcript.failureCode,
    };
    this.options.eventBus?.publish({ name: "transcript:updated", roomId, data });
  }

  private remember(key: string, response: TranscriptStatusResponse): void {
    this.idempotentResponses.set(key, structuredClone(response));
    if (this.idempotentResponses.size > 2000) {
      const oldestKey = this.idempotentResponses.keys().next().value as string | undefined;
      if (oldestKey) {
        this.idempotentResponses.delete(oldestKey);
      }
    }
  }
}
