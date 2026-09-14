import { describe, expect, it, vi } from "vitest";

import { startLocalAudioWhileRequested } from "./use-room-audio";

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
