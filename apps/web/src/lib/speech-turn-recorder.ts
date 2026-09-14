export interface RecordedSpeechTurn {
  blob: Blob;
  durationMs: number;
  fileName: string;
}

export const supportedSpeechRecordingTypes = [
  { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "m4a" },
  { mimeType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  { mimeType: "audio/ogg", extension: "ogg" },
] as const;

export function selectSpeechRecordingType(
  isTypeSupported: (mimeType: string) => boolean,
): (typeof supportedSpeechRecordingTypes)[number] {
  const selected = supportedSpeechRecordingTypes.find(({ mimeType }) => isTypeSupported(mimeType));
  if (!selected) {
    throw new Error("当前浏览器无法录制服务端 ASR 支持的 m4a 或 ogg-opus 音频");
  }
  return selected;
}

export class SpeechTurnRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private extension = "";

  start(stream: MediaStream): void {
    if (this.recorder) {
      throw new Error("已有发言录音正在进行");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new Error("当前浏览器不支持发言录音");
    }
    const recordingType = selectSpeechRecordingType((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    );
    const recorder = new MediaRecorder(stream, { mimeType: recordingType.mimeType });
    this.recorder = recorder;
    this.chunks = [];
    this.extension = recordingType.extension;
    this.startedAt = performance.now();
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    recorder.start();
  }

  async stop(speechTurnId: string): Promise<RecordedSpeechTurn> {
    const recorder = this.recorder;
    if (!recorder) {
      throw new Error("当前没有正在进行的发言录音");
    }
    const durationMs = Math.max(
      1,
      Math.min(120_000, Math.round(performance.now() - this.startedAt)),
    );
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener("error", () => reject(new Error("录音失败")), { once: true });
    });
    recorder.stop();
    await stopped;
    const blob = new Blob(this.chunks, { type: recorder.mimeType });
    if (blob.size === 0) {
      this.reset();
      throw new Error("本次发言没有录制到有效音频");
    }
    const fileName = `${speechTurnId}.${this.extension}`;
    this.reset();
    return { blob, durationMs, fileName };
  }

  cancel(): void {
    if (this.recorder?.state !== "inactive") {
      this.recorder?.stop();
    }
    this.reset();
  }

  private reset(): void {
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.extension = "";
  }
}

export async function uploadSpeechTurnAudio(input: {
  roomId: string;
  speechTurnId: string;
  recording: RecordedSpeechTurn;
  idempotencyKey: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const form = new FormData();
  form.append(
    "audio",
    new File([input.recording.blob], input.recording.fileName, {
      type: input.recording.blob.type,
    }),
  );
  form.append("durationMs", String(input.recording.durationMs));
  return fetch(
    `/api/v1/rooms/${encodeURIComponent(input.roomId)}/speech-turns/${encodeURIComponent(input.speechTurnId)}/audio`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: form,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
}
