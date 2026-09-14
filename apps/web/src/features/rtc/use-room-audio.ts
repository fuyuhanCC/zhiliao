import { useCallback, useEffect, useRef, useState } from "react";
import type TrtcClient from "trtc-sdk-v5";

import { ApiError, createRtcCredentials } from "../../lib/api-client";

export type RoomAudioStatus = "idle" | "connecting" | "connected" | "unavailable" | "error";

interface UseRoomAudioOptions {
  roomId: string;
  enabled: boolean;
  isSeated: boolean;
  isSpeaker: boolean;
}

interface AudioActionResult {
  ok: boolean;
  message?: string;
  recordingStream?: MediaStream;
}

interface UseRoomAudioResult {
  status: RoomAudioStatus;
  error: string | null;
  isPublishing: boolean;
  playbackBlocked: boolean;
  remoteAudioCount: number;
  startPublishing: () => Promise<AudioActionResult>;
  stopPublishing: () => Promise<AudioActionResult>;
  resumePlayback: () => Promise<void>;
}

function audioErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === "TRTC_UNAVAILABLE") {
    return "实时语音服务尚未配置";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "麦克风权限未开启，请在浏览器设置中允许访问麦克风";
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function startLocalAudioWhileRequested(
  startLocalAudio: () => Promise<void>,
  stopLocalAudio: () => Promise<void>,
  isRequested: () => boolean,
): Promise<boolean> {
  if (!isRequested()) return false;
  await startLocalAudio();
  if (isRequested()) return true;
  await stopLocalAudio();
  return false;
}

export function createSpeechRecordingStream(
  localAudioTrack: MediaStreamTrack | null,
  createStream: (track: MediaStreamTrack) => MediaStream = (track) => new MediaStream([track]),
): MediaStream | undefined {
  if (!localAudioTrack) return undefined;
  return createStream(localAudioTrack.clone());
}

export function useRoomAudio({
  roomId,
  enabled,
  isSeated,
  isSpeaker,
}: UseRoomAudioOptions): UseRoomAudioResult {
  const [status, setStatus] = useState<RoomAudioStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [remoteAudioCount, setRemoteAudioCount] = useState(0);
  const trtcRef = useRef<TrtcClient | null>(null);
  const enteredRef = useRef(false);
  const localAudioStartedRef = useRef(false);
  const publishingRequestedRef = useRef(false);
  const roleRef = useRef<"anchor" | "audience">("audience");
  const wasSpeakerRef = useRef(isSpeaker);
  const pendingPlaybackResumesRef = useRef(new Map<string, () => Promise<void>>());

  const stopPublishing = useCallback(async (): Promise<AudioActionResult> => {
    publishingRequestedRef.current = false;
    const trtc = trtcRef.current;
    if (!trtc || !localAudioStartedRef.current) {
      setIsPublishing(false);
      return { ok: true };
    }

    try {
      await trtc.stopLocalAudio();
      localAudioStartedRef.current = false;
      setIsPublishing(false);
      return { ok: true };
    } catch (stopError) {
      const message = audioErrorMessage(stopError, "关闭麦克风失败");
      setError(message);
      return { ok: false, message };
    }
  }, []);

  const startPublishing = useCallback(async (): Promise<AudioActionResult> => {
    const trtc = trtcRef.current;
    if (!trtc || !enteredRef.current) {
      const message = "实时语音尚未连接，请稍后再试";
      setError(message);
      return { ok: false, message };
    }
    if (localAudioStartedRef.current) return { ok: true };

    publishingRequestedRef.current = true;
    setError(null);
    try {
      if (roleRef.current !== "anchor") {
        const { default: TRTC } = await import("trtc-sdk-v5");
        await trtc.switchRole(TRTC.TYPE.ROLE_ANCHOR);
        roleRef.current = "anchor";
      }
      if (!publishingRequestedRef.current) {
        return { ok: false, message: "发言权已失效，请重新开始发言" };
      }
      const started = await startLocalAudioWhileRequested(
        () =>
          trtc.startLocalAudio({
            option: {
              profile: "standard",
              echoCancellation: "all",
              autoGainControl: true,
              noiseSuppression: true,
            },
          }),
        () => trtc.stopLocalAudio(),
        () => publishingRequestedRef.current,
      );
      localAudioStartedRef.current = started;
      if (!started) {
        localAudioStartedRef.current = false;
        setIsPublishing(false);
        return { ok: false, message: "发言权已失效，麦克风已关闭" };
      }
      const recordingStream = createSpeechRecordingStream(trtc.getAudioTrack());
      setIsPublishing(true);
      return { ok: true, ...(recordingStream ? { recordingStream } : {}) };
    } catch (publishError) {
      const message = audioErrorMessage(publishError, "麦克风启动失败");
      publishingRequestedRef.current = false;
      localAudioStartedRef.current = false;
      setIsPublishing(false);
      setError(message);
      return { ok: false, message };
    }
  }, []);

  const resumePlayback = useCallback(async () => {
    const pendingResumes = [...pendingPlaybackResumesRef.current.values()];
    if (pendingResumes.length === 0) {
      setPlaybackBlocked(false);
      return;
    }

    const results = await Promise.allSettled(pendingResumes.map((resume) => resume()));
    if (results.some((result) => result.status === "rejected")) {
      setError("浏览器仍阻止声音播放，请检查自动播放设置");
      return;
    }
    pendingPlaybackResumesRef.current.clear();
    setPlaybackBlocked(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (isSeated || !enteredRef.current) return;

    void (async () => {
      await stopPublishing();
      const trtc = trtcRef.current;
      if (!trtc || !enteredRef.current || roleRef.current !== "anchor") return;
      try {
        const { default: TRTC } = await import("trtc-sdk-v5");
        await trtc.switchRole(TRTC.TYPE.ROLE_AUDIENCE);
        roleRef.current = "audience";
      } catch (roleError) {
        setError(audioErrorMessage(roleError, "切换为听众失败"));
      }
    })();
  }, [isSeated, stopPublishing]);

  useEffect(() => {
    if (!isSpeaker && wasSpeakerRef.current) void stopPublishing();
    wasSpeakerRef.current = isSpeaker;
  }, [isSpeaker, stopPublishing]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setError(null);
      setPlaybackBlocked(false);
      setRemoteAudioCount(0);
      return;
    }

    const controller = new AbortController();
    let disposed = false;
    let destroyed = false;
    let createdTrtc: TrtcClient | null = null;

    async function destroyTrtc() {
      if (destroyed || !createdTrtc) return;
      destroyed = true;
      if (localAudioStartedRef.current) {
        try {
          await createdTrtc.stopLocalAudio();
        } catch {
          // Room shutdown continues even when the SDK already stopped capture.
        }
      }
      if (enteredRef.current) {
        try {
          await createdTrtc.exitRoom();
        } catch {
          // The SDK may already be disconnected while the page is closing.
        }
      }
      createdTrtc.destroy();
      if (trtcRef.current === createdTrtc) trtcRef.current = null;
      enteredRef.current = false;
      localAudioStartedRef.current = false;
      publishingRequestedRef.current = false;
      pendingPlaybackResumesRef.current.clear();
    }

    async function connect() {
      setStatus("connecting");
      setError(null);
      setIsPublishing(false);
      publishingRequestedRef.current = false;
      setPlaybackBlocked(false);
      setRemoteAudioCount(0);

      try {
        const [credentials, { default: TRTC }] = await Promise.all([
          createRtcCredentials(roomId, controller.signal),
          import("trtc-sdk-v5"),
        ]);
        if (disposed) return;

        const support = await TRTC.isSupported();
        if (!support.result) {
          setStatus("unavailable");
          setError("当前浏览器不支持实时语音，请使用最新版 Chrome、Edge 或 Safari");
          return;
        }

        const trtc = TRTC.create({ enableAutoPlayDialog: false });
        createdTrtc = trtc;
        trtcRef.current = trtc;
        const remoteAudioUsers = new Set<string>();

        trtc.on(TRTC.EVENT.ERROR, (rtcError) => {
          if (!disposed) setError(audioErrorMessage(rtcError, "实时语音发生错误"));
        });
        trtc.on(TRTC.EVENT.KICKED_OUT, () => {
          if (disposed) return;
          enteredRef.current = false;
          setStatus("error");
          setError("实时语音连接已断开，请刷新页面重试");
        });
        trtc.on(TRTC.EVENT.CONNECTION_STATE_CHANGED, ({ state }) => {
          if (disposed) return;
          if (state === "CONNECTED" || state === "RECONNECTED") setStatus("connected");
          if (state === "CONNECTING" || state === "RECONNECTING") setStatus("connecting");
        });
        trtc.on(TRTC.EVENT.AUTOPLAY_FAILED, ({ userId, mediaType, resume }) => {
          if (disposed || mediaType !== "audio") return;
          pendingPlaybackResumesRef.current.set(userId, resume);
          setPlaybackBlocked(true);
        });
        trtc.on(TRTC.EVENT.REMOTE_AUDIO_AVAILABLE, ({ userId }) => {
          remoteAudioUsers.add(userId);
          if (!disposed) setRemoteAudioCount(remoteAudioUsers.size);
        });
        trtc.on(TRTC.EVENT.REMOTE_AUDIO_UNAVAILABLE, ({ userId }) => {
          remoteAudioUsers.delete(userId);
          pendingPlaybackResumesRef.current.delete(userId);
          if (!disposed) {
            setRemoteAudioCount(remoteAudioUsers.size);
            setPlaybackBlocked(pendingPlaybackResumesRef.current.size > 0);
          }
        });
        trtc.on(TRTC.EVENT.PUBLISH_STATE_CHANGED, ({ mediaType, state }) => {
          if (disposed || mediaType !== "audio") return;
          const publishing = state === "started" && publishingRequestedRef.current;
          localAudioStartedRef.current = publishing;
          setIsPublishing(publishing);
        });

        const initialRole =
          credentials.role === "speaker" ? TRTC.TYPE.ROLE_ANCHOR : TRTC.TYPE.ROLE_AUDIENCE;
        roleRef.current = initialRole;
        await trtc.enterRoom({
          sdkAppId: credentials.sdkAppId,
          strRoomId: credentials.trtcRoomId,
          userId: credentials.trtcUserId,
          userSig: credentials.userSig,
          scene: TRTC.TYPE.SCENE_LIVE,
          role: initialRole,
          autoReceiveAudio: true,
          autoReceiveVideo: false,
          enableAutoPlayDialog: false,
        });
        enteredRef.current = true;

        if (disposed) {
          await destroyTrtc();
          return;
        }
        setStatus("connected");
      } catch (connectError) {
        if (
          disposed ||
          (connectError instanceof DOMException && connectError.name === "AbortError")
        ) {
          return;
        }
        const message = audioErrorMessage(connectError, "实时语音连接失败");
        setStatus(
          connectError instanceof ApiError && connectError.code === "TRTC_UNAVAILABLE"
            ? "unavailable"
            : "error",
        );
        setError(message);
        await destroyTrtc();
      }
    }

    void connect();
    return () => {
      disposed = true;
      controller.abort();
      void destroyTrtc();
    };
  }, [enabled, roomId]);

  return {
    status,
    error,
    isPublishing,
    playbackBlocked,
    remoteAudioCount,
    startPublishing,
    stopPublishing,
    resumePlayback,
  };
}
