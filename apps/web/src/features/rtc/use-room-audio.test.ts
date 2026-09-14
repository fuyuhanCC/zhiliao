import { describe, expect, it, vi } from "vitest";

import { createSpeechRecordingStream, startLocalAudioWhileRequested } from "./use-room-audio";

describe("startLocalAudioWhileRequested", () => {
  it("stops audio if the publishing request is cancelled while permission is pending", async () => {
    let finishPermissionRequest: (() => void) | undefined;
    let requested = true;
    const startLocalAudio = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPermissionRequest = resolve;
        }),
    );
    const stopLocalAudio = vi.fn(async () => undefined);

    const result = startLocalAudioWhileRequested(startLocalAudio, stopLocalAudio, () => requested);
    requested = false;
    finishPermissionRequest?.();

    await expect(result).resolves.toBe(false);
    expect(stopLocalAudio).toHaveBeenCalledOnce();
  });

  it("keeps audio running while the publishing request remains active", async () => {
    const startLocalAudio = vi.fn(async () => undefined);
    const stopLocalAudio = vi.fn(async () => undefined);

    await expect(
      startLocalAudioWhileRequested(startLocalAudio, stopLocalAudio, () => true),
    ).resolves.toBe(true);
    expect(stopLocalAudio).not.toHaveBeenCalled();
  });
});

describe("createSpeechRecordingStream", () => {
  it("records from a cloned track so TRTC can stop its own track independently", () => {
    const clonedTrack = { id: "recording-track" } as MediaStreamTrack;
    const localTrack = { clone: vi.fn(() => clonedTrack) } as unknown as MediaStreamTrack;
    const recordingStream = { id: "recording-stream" } as unknown as MediaStream;
    const createStream = vi.fn(() => recordingStream);

    expect(createSpeechRecordingStream(localTrack, createStream)).toBe(recordingStream);
    expect(localTrack.clone).toHaveBeenCalledOnce();
    expect(createStream).toHaveBeenCalledWith(clonedTrack);
  });

  it("keeps realtime audio usable when the SDK cannot expose a local track", () => {
    const createStream = vi.fn();

    expect(createSpeechRecordingStream(null, createStream)).toBeUndefined();
    expect(createStream).not.toHaveBeenCalled();
  });
});
