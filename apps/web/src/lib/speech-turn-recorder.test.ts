import { describe, expect, it, vi } from "vitest";

import { selectSpeechRecordingType, supportedSpeechRecordingTypes } from "./speech-turn-recorder";

describe("selectSpeechRecordingType", () => {
  it("prefers AAC in an MP4 container when the browser supports it", () => {
    const isTypeSupported = vi.fn((mimeType: string) =>
      ["audio/mp4;codecs=mp4a.40.2", "audio/ogg;codecs=opus"].includes(mimeType),
    );

    expect(selectSpeechRecordingType(isTypeSupported)).toEqual({
      mimeType: "audio/mp4;codecs=mp4a.40.2",
      extension: "m4a",
    });
  });

  it("falls back to ogg-opus without selecting unsupported WebM", () => {
    const isTypeSupported = vi.fn((mimeType: string) => mimeType === "audio/ogg;codecs=opus");

    expect(selectSpeechRecordingType(isTypeSupported)).toEqual({
      mimeType: "audio/ogg;codecs=opus",
      extension: "ogg",
    });
    expect(supportedSpeechRecordingTypes.some(({ mimeType }) => mimeType.includes("webm"))).toBe(
      false,
    );
  });

  it("explains when none of the server-supported formats are available", () => {
    expect(() => selectSpeechRecordingType(() => false)).toThrow(
      "当前浏览器无法录制服务端 ASR 支持的 m4a 或 ogg-opus 音频",
    );
  });
});
