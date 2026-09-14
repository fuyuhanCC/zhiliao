import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { AccountDialog } from "../components/AccountDialog";
import { AppHeader } from "../components/AppHeader";
import { DebateLogDrawer } from "../features/debate-log/DebateLogDrawer";
import { RoomMaterials } from "../features/room/RoomMaterials";
import { useRoomRealtime, type RoomConnectionStatus } from "../features/room/use-room-realtime";
import { useRoomAudio, type RoomAudioStatus } from "../features/rtc/use-room-audio";
import {
  ApiError,
  generateRoomSummary,
  getRoom,
  getRoomSummary,
  listRoomMaterials,
  listRoomMessages,
  listSpeechTurns,
  type ChatMessage,
  type RoomMaterial,
  type RoomSnapshot,
  type SpeechTurnPage,
  type SummaryResource,
} from "../lib/api-client";
import {
  type RecordedSpeechTurn,
  SpeechTurnRecorder,
  uploadSpeechTurnAudio,
} from "../lib/speech-turn-recorder";
import { useSessionStore } from "../stores/session-store";

type LoadStatus = "loading" | "ready" | "error";
const maximumVisibleMessages = 100;
const maximumVisibleDanmakuMessages = 16;
const danmakuLaneCount = 5;
const rewardAmounts = [5, 10, 50] as const;

interface SpeechRecordingStopTask {
  speechTurnId: string;
  promise: Promise<RecordedSpeechTurn | null>;
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const message of [...current, ...incoming]) {
    if (seen.has(message.messageId)) continue;
    seen.add(message.messageId);
    merged.push(message);
  }
  return merged.slice(-maximumVisibleMessages);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function userInitial(displayName: string): string {
  return displayName.trim().charAt(0) || "知";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function stopMediaStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    return typeof body.error?.message === "string" ? body.error.message : fallback;
  } catch {
    return fallback;
  }
}

function connectionLabel(status: RoomConnectionStatus): string {
  switch (status) {
    case "connected":
      return "实时已连接";
    case "connecting":
      return "实时连接中";
    case "reconnecting":
      return "正在重连";
    case "error":
      return "实时连接失败";
    case "closed":
      return "房间已结束";
    default:
      return "准备实时连接";
  }
}

function audioConnectionLabel(status: RoomAudioStatus, isPublishing: boolean): string {
  if (isPublishing) return "麦克风正在传输";
  switch (status) {
    case "connected":
      return "语音已连接";
    case "connecting":
      return "语音连接中";
    case "unavailable":
      return "语音服务未配置";
    case "error":
      return "语音连接失败";
    default:
      return "准备语音连接";
  }
}

function remainingSeconds(expiresAt: string | undefined, nowMilliseconds: number): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - nowMilliseconds) / 1000));
}

function countdownLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function DanmakuLayer({ messages, enabled }: { messages: ChatMessage[]; enabled: boolean }) {
  if (!enabled || messages.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-14 z-10 h-44 overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-white/75 via-white/30 to-transparent" />
      {messages.map((message, index) => {
        const lane = index % danmakuLaneCount;
        const duration = 9 + (index % 4);
        const stagger = (index % maximumVisibleDanmakuMessages) * 0.55;
        return (
          <span
            className="danmaku-item absolute max-w-[min(72vw,520px)] truncate rounded-full border border-white/80 bg-slate-950/70 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-slate-900/15 backdrop-blur"
            key={message.messageId}
            style={{
              animationDelay: `-${stagger}s`,
              animationDuration: `${duration}s`,
              top: `${lane * 32}px`,
            }}
          >
            <strong className="font-semibold text-sky-200">
              {message.sender?.displayName ?? "知友"}：
            </strong>
            {message.content}
          </span>
        );
      })}
    </div>
  );
}

export function RoomPage() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const currentUser = useSessionStore((state) => state.session?.user);
  const currentUserId = currentUser?.userId;
  const sessionStatus = useSessionStore((state) => state.status);
  const updateAccount = useSessionStore((state) => state.updateAccount);
  const [pageStatus, setPageStatus] = useState<LoadStatus>("loading");
  const [pageError, setPageError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [materials, setMaterials] = useState<RoomMaterial[]>([]);
  const [materialsStatus, setMaterialsStatus] = useState<LoadStatus>("loading");
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesStatus, setMessagesStatus] = useState<LoadStatus>("loading");
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [speechTurnsPage, setSpeechTurnsPage] = useState<SpeechTurnPage | null>(null);
  const [speechTurnsStatus, setSpeechTurnsStatus] = useState<LoadStatus>("loading");
  const [speechTurnsError, setSpeechTurnsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResource | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [danmakuEnabled, setDanmakuEnabled] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const [roomActionNotice, setRoomActionNotice] = useState<string | null>(null);
  const [retryableSpeechTurnIds, setRetryableSpeechTurnIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [clockTick, setClockTick] = useState(() => Date.now());
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const summaryRequestVersion = useRef<number | null>(null);
  const summaryRequestSequence = useRef(0);
  const speechRecorderRef = useRef<SpeechTurnRecorder | null>(null);
  const speechRecordingStreamRef = useRef<MediaStream | null>(null);
  const recordingSpeechTurnIdRef = useRef<string | null>(null);
  const speechRecordingStopTaskRef = useRef<SpeechRecordingStopTask | null>(null);
  const pendingSpeechRecordingsRef = useRef(new Map<string, RecordedSpeechTurn>());
  const speechUploadsInFlightRef = useRef(new Set<string>());
  const speechUploadControllersRef = useRef(new Map<string, AbortController>());
  const realtimeStatusRef = useRef<RoomConnectionStatus>("idle");
  const activeRoomIdRef = useRef(roomId);
  activeRoomIdRef.current = roomId;

  useEffect(() => {
    setRetryableSpeechTurnIds(new Set());
    return () => {
      speechRecorderRef.current?.cancel();
      speechRecorderRef.current = null;
      stopMediaStream(speechRecordingStreamRef.current);
      speechRecordingStreamRef.current = null;
      recordingSpeechTurnIdRef.current = null;
      speechRecordingStopTaskRef.current = null;
      pendingSpeechRecordingsRef.current.clear();
      speechUploadsInFlightRef.current.clear();
      for (const controller of speechUploadControllersRef.current.values()) {
        controller.abort();
      }
      speechUploadControllersRef.current.clear();
    };
  }, [roomId]);

  useEffect(() => {
    const controller = new AbortController();
    summaryRequestVersion.current = null;
    summaryRequestSequence.current += 1;
    setPageStatus("loading");
    setPageError(null);
    setSnapshot(null);
    setMaterials([]);
    setMaterialsStatus("loading");
    setMaterialsError(null);
    setMessages([]);
    setMessagesStatus("loading");
    setMessagesError(null);
    setSpeechTurnsPage(null);
    setSpeechTurnsStatus("loading");
    setSpeechTurnsError(null);
    setSummary(null);
    setSummaryError(null);
    setRoomActionNotice(null);

    async function loadRoom() {
      try {
        const nextSnapshot = await getRoom(roomId, controller.signal);
        if (controller.signal.aborted) return;
        setSnapshot(nextSnapshot);
        setPageStatus("ready");

        void listRoomMaterials(roomId, controller.signal)
          .then((page) => {
            setMaterials(page.items);
            setMaterialsStatus("ready");
          })
          .catch((error: unknown) => {
            if (isAbortError(error)) return;
            setMaterialsStatus("error");
            setMaterialsError(errorMessage(error, "背景资料加载失败"));
          });

        void listRoomMessages(roomId, controller.signal)
          .then((page) => {
            setMessages((current) => mergeMessages(page.items, current));
            setMessagesStatus("ready");
          })
          .catch((error: unknown) => {
            if (isAbortError(error)) return;
            setMessagesStatus("error");
            setMessagesError(errorMessage(error, "公屏历史加载失败"));
          });

        void listSpeechTurns(roomId, controller.signal)
          .then((page) => {
            setSpeechTurnsPage(page);
            setSpeechTurnsStatus("ready");
          })
          .catch((error: unknown) => {
            if (isAbortError(error)) return;
            setSpeechTurnsStatus("error");
            setSpeechTurnsError(errorMessage(error, "发言记录加载失败"));
          });

        void getRoomSummary(roomId, controller.signal)
          .then(setSummary)
          .catch((error: unknown) => {
            if (isAbortError(error)) return;
            setSummaryError(errorMessage(error, "AI 总结加载失败"));
          });
      } catch (error) {
        if (isAbortError(error)) return;
        setPageStatus("error");
        setPageError(
          error instanceof ApiError && error.code === "ROOM_NOT_FOUND"
            ? "房间不存在或已经结束"
            : errorMessage(error, "房间加载失败"),
        );
      }
    }

    void loadRoom();
    return () => {
      controller.abort();
      summaryRequestVersion.current = null;
      summaryRequestSequence.current += 1;
    };
  }, [roomId, reloadVersion]);

  const refreshSummary = useCallback(async () => {
    const requestSequence = ++summaryRequestSequence.current;
    setSummaryError(null);
    try {
      let nextSummary = await generateRoomSummary(roomId);
      if (requestSequence !== summaryRequestSequence.current) return;
      setSummary(nextSummary);

      for (
        let attempt = 0;
        attempt < 8 && (nextSummary.status === "pending" || nextSummary.status === "processing");
        attempt += 1
      ) {
        await wait(750);
        if (requestSequence !== summaryRequestSequence.current) return;
        nextSummary = await getRoomSummary(roomId);
        if (requestSequence !== summaryRequestSequence.current) return;
        setSummary(nextSummary);
      }
    } catch (error) {
      if (requestSequence !== summaryRequestSequence.current) return;
      setSummaryError(errorMessage(error, "AI 总结暂时不可用"));
    }
  }, [roomId]);

  const refreshSpeechTurns = useCallback(async () => {
    setSpeechTurnsError(null);
    try {
      const page = await listSpeechTurns(roomId);
      setSpeechTurnsPage(page);
      setSpeechTurnsStatus("ready");
    } catch (error) {
      setSpeechTurnsStatus("error");
      setSpeechTurnsError(errorMessage(error, "发言记录加载失败"));
    }
  }, [roomId]);

  const refreshRoomSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      setSummary(await getRoomSummary(roomId));
    } catch (error) {
      setSummaryError(errorMessage(error, "AI 总结加载失败"));
    }
  }, [roomId]);

  useEffect(() => {
    const transcriptVersion = speechTurnsPage?.transcriptVersion ?? 0;
    const alreadyCurrent =
      summary?.status === "ready" && summary.sourceTranscriptVersion === transcriptVersion;
    if (
      !logOpen ||
      transcriptVersion === 0 ||
      alreadyCurrent ||
      summaryRequestVersion.current === transcriptVersion
    ) {
      return;
    }

    summaryRequestVersion.current = transcriptVersion;
    void refreshSummary();
  }, [logOpen, refreshSummary, speechTurnsPage?.transcriptVersion, summary]);

  const handleRoomClosed = useCallback(() => {
    navigate("/", { replace: true, state: { notice: "房间已结束" } });
  }, [navigate]);

  const handleChatCreated = useCallback((message: ChatMessage) => {
    setMessages((current) => mergeMessages(current, [message]));
    setMessagesStatus("ready");
    setMessagesError(null);
  }, []);

  const markSpeechTurnRetryable = useCallback((speechTurnId: string, retryable: boolean) => {
    setRetryableSpeechTurnIds((current) => {
      const next = new Set(current);
      if (retryable) next.add(speechTurnId);
      else next.delete(speechTurnId);
      return next;
    });
  }, []);

  const startSpeechRecording = useCallback(
    (speechTurnId: string, stream: MediaStream | undefined): boolean => {
      if (!stream) {
        setRoomActionNotice("麦克风已开启，但浏览器未提供可录制音轨");
        return false;
      }

      try {
        speechRecorderRef.current?.cancel();
        stopMediaStream(speechRecordingStreamRef.current);
        const recorder = new SpeechTurnRecorder();
        recorder.start(stream);
        speechRecorderRef.current = recorder;
        speechRecordingStreamRef.current = stream;
        recordingSpeechTurnIdRef.current = speechTurnId;
        markSpeechTurnRetryable(speechTurnId, false);
        return true;
      } catch (error) {
        stopMediaStream(stream);
        setRoomActionNotice(errorMessage(error, "发言录音启动失败，实时语音仍可继续"));
        return false;
      }
    },
    [markSpeechTurnRetryable],
  );

  const stopSpeechRecording = useCallback(
    async (speechTurnId: string): Promise<RecordedSpeechTurn | null> => {
      const pending = pendingSpeechRecordingsRef.current.get(speechTurnId);
      if (pending) return pending;

      const existingTask = speechRecordingStopTaskRef.current;
      if (existingTask?.speechTurnId === speechTurnId) return existingTask.promise;

      const recorder = speechRecorderRef.current;
      if (!recorder || recordingSpeechTurnIdRef.current !== speechTurnId) return null;

      const stream = speechRecordingStreamRef.current;
      speechRecorderRef.current = null;
      speechRecordingStreamRef.current = null;
      recordingSpeechTurnIdRef.current = null;

      const task: SpeechRecordingStopTask = {
        speechTurnId,
        promise: Promise.resolve(null),
      };
      task.promise = (async () => {
        try {
          const recording = await recorder.stop(speechTurnId);
          if (activeRoomIdRef.current !== roomId) return null;
          pendingSpeechRecordingsRef.current.set(speechTurnId, recording);
          return recording;
        } catch (error) {
          if (activeRoomIdRef.current === roomId) {
            setRoomActionNotice(errorMessage(error, "本次发言录音保存失败"));
          }
          return null;
        } finally {
          stopMediaStream(stream);
          if (speechRecordingStopTaskRef.current === task) {
            speechRecordingStopTaskRef.current = null;
          }
        }
      })();
      speechRecordingStopTaskRef.current = task;
      return task.promise;
    },
    [roomId],
  );

  const uploadPendingSpeechRecording = useCallback(
    async (speechTurnId: string, recording?: RecordedSpeechTurn | null) => {
      const savedRecording = recording ?? pendingSpeechRecordingsRef.current.get(speechTurnId);
      if (!savedRecording || speechUploadsInFlightRef.current.has(speechTurnId)) return;

      const controller = new AbortController();
      speechUploadsInFlightRef.current.add(speechTurnId);
      speechUploadControllersRef.current.set(speechTurnId, controller);
      markSpeechTurnRetryable(speechTurnId, false);
      try {
        const response = await uploadSpeechTurnAudio({
          roomId,
          speechTurnId,
          recording: savedRecording,
          idempotencyKey: crypto.randomUUID(),
          signal: controller.signal,
        });
        if (controller.signal.aborted || activeRoomIdRef.current !== roomId) return;
        if (!response.ok) {
          markSpeechTurnRetryable(speechTurnId, true);
          setRoomActionNotice(await responseErrorMessage(response, "发言录音上传失败"));
          return;
        }
        const result = (await response.json()) as { status?: unknown };
        if (result.status === "ready") {
          pendingSpeechRecordingsRef.current.delete(speechTurnId);
        }
        setRoomActionNotice(
          result.status === "ready" ? "本次发言转写已完成" : "发言录音已上传，正在转写",
        );
      } catch (error) {
        if (!isAbortError(error)) {
          markSpeechTurnRetryable(speechTurnId, true);
          setRoomActionNotice(errorMessage(error, "发言录音上传失败"));
        }
      } finally {
        speechUploadsInFlightRef.current.delete(speechTurnId);
        if (speechUploadControllersRef.current.get(speechTurnId) === controller) {
          speechUploadControllersRef.current.delete(speechTurnId);
        }
        if (!controller.signal.aborted && activeRoomIdRef.current === roomId) {
          void refreshSpeechTurns();
        }
      }
    },
    [markSpeechTurnRetryable, refreshSpeechTurns, roomId],
  );

  const finishSpeechRecording = useCallback(
    async (speechTurnId: string) => {
      const recording = await stopSpeechRecording(speechTurnId);
      if (recording) await uploadPendingSpeechRecording(speechTurnId, recording);
      else if (activeRoomIdRef.current === roomId) void refreshSpeechTurns();
    },
    [refreshSpeechTurns, roomId, stopSpeechRecording, uploadPendingSpeechRecording],
  );

  const realtime = useRoomRealtime({
    roomId,
    enabled: pageStatus === "ready" && sessionStatus === "ready" && snapshot !== null,
    snapshot,
    onSnapshot: setSnapshot,
    onChatCreated: handleChatCreated,
    onSpeechClosed: (event) => {
      if (event.speakerUserId === currentUserId) {
        void finishSpeechRecording(event.speechTurnId);
      } else {
        void refreshSpeechTurns();
      }
    },
    onTranscriptUpdated: (event) => {
      if (event.status === "ready") {
        pendingSpeechRecordingsRef.current.delete(event.speechTurnId);
        markSpeechTurnRetryable(event.speechTurnId, false);
      } else if (
        event.status === "failed" &&
        pendingSpeechRecordingsRef.current.has(event.speechTurnId)
      ) {
        markSpeechTurnRetryable(event.speechTurnId, true);
        setRoomActionNotice("本次发言转写失败，可在辩论日志中重新转写");
      }
      void refreshSpeechTurns();
    },
    onSummaryUpdated: () => {
      void refreshRoomSummary();
    },
    onReactionCreated: () => {
      void refreshSpeechTurns();
    },
    onRewardCreated: () => {
      void refreshSpeechTurns();
    },
    onAccountUpdated: (event) => updateAccount(event.data),
    onRoomClosed: handleRoomClosed,
  });
  realtimeStatusRef.current = realtime.status;

  const currentSeat = snapshot?.seats.find((seat) => seat.occupant?.userId === currentUserId);
  const currentUserQueueEntry = snapshot?.queue.find((entry) => entry.userId === currentUserId);
  const currentCooldown = snapshot?.cooldowns.find((cooldown) => cooldown.userId === currentUserId);
  const currentUserIsSpeaker = snapshot?.speakerLock?.userId === currentUserId;
  const roomAudio = useRoomAudio({
    roomId,
    enabled: realtime.status === "connected" && sessionStatus === "ready" && snapshot !== null,
    isSeated: currentSeat !== undefined,
    isSpeaker: currentUserIsSpeaker,
  });
  const trackedExpiry = `${snapshot?.speakerLock?.expiresAt ?? ""}|${currentCooldown?.expiresAt ?? ""}`;

  useEffect(() => {
    if (realtime.status === "connected") {
      for (const [speechTurnId, recording] of pendingSpeechRecordingsRef.current) {
        void uploadPendingSpeechRecording(speechTurnId, recording);
      }
      return;
    }

    const speechTurnId = recordingSpeechTurnIdRef.current;
    if (speechTurnId) {
      void stopSpeechRecording(speechTurnId).then((recording) => {
        if (recording && realtimeStatusRef.current === "connected") {
          void uploadPendingSpeechRecording(speechTurnId, recording);
        }
      });
    }
  }, [realtime.status, stopSpeechRecording, uploadPendingSpeechRecording]);

  useEffect(() => {
    const speechTurnId = recordingSpeechTurnIdRef.current;
    if (speechTurnId && !currentUserIsSpeaker) void finishSpeechRecording(speechTurnId);
  }, [currentUserIsSpeaker, finishSpeechRecording]);

  useEffect(() => {
    setClockTick(Date.now());
    if (trackedExpiry === "|") return;
    const timer = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [trackedExpiry]);

  useEffect(() => {
    if (messagesStatus !== "ready") return;
    const list = messageListRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [messages.length, messagesStatus]);

  function requireZhihuLogin(): boolean {
    if (currentUser?.identityType === "zhihu") return true;
    realtime.clearActionError();
    setRoomActionNotice("登录知乎后即可上麦和发言");
    setAccountOpen(true);
    return false;
  }

  async function requestSeat() {
    if (!requireZhihuLogin()) return;
    setRoomActionNotice(null);
    const ack = await realtime.requestSeat();
    if (!ack?.ok) return;
    setRoomActionNotice(
      ack.data.status === "seated"
        ? `已进入 ${ack.data.seatNumber} 号麦位`
        : `麦位已满，当前排队第 ${ack.data.queuePosition} 位`,
    );
  }

  async function cancelSeatRequest() {
    setRoomActionNotice(null);
    const ack = await realtime.cancelSeatRequest();
    if (ack?.ok) setRoomActionNotice("已取消上麦排队");
  }

  async function leaveSeat() {
    setRoomActionNotice(null);
    const speechTurnId = recordingSpeechTurnIdRef.current;
    const recordingPromise = speechTurnId
      ? stopSpeechRecording(speechTurnId)
      : Promise.resolve(null);
    await roomAudio.stopPublishing();
    const ack = await realtime.leaveSeat();
    if (ack?.ok) {
      setRoomActionNotice("已下麦");
      if (speechTurnId) {
        const recording = await recordingPromise;
        if (recording) void uploadPendingSpeechRecording(speechTurnId, recording);
      }
    }
  }

  async function acquireSpeaker() {
    if (!requireZhihuLogin()) return;
    if (roomAudio.status !== "connected") {
      setRoomActionNotice(roomAudio.error ?? "实时语音尚未连接，请稍后再试");
      return;
    }
    setRoomActionNotice(null);
    const ack = await realtime.acquireSpeaker();
    if (!ack?.ok) return;

    const published = await roomAudio.startPublishing();
    if (published.ok) {
      const recordingStarted = startSpeechRecording(
        ack.data.speechTurnId,
        published.recordingStream,
      );
      setRoomActionNotice(
        recordingStarted
          ? "已获得发言权，麦克风与发言录音已开启"
          : "已获得发言权，麦克风已开启，但本次发言无法自动转写",
      );
      return;
    }

    await realtime.releaseSpeaker(ack.data.speechTurnId);
    setRoomActionNotice(published.message ?? "麦克风启动失败，已释放发言权");
  }

  async function releaseSpeaker() {
    const speechTurnId = snapshot?.speakerLock?.speechTurnId;
    if (!speechTurnId) return;
    setRoomActionNotice(null);
    const recordingPromise = stopSpeechRecording(speechTurnId);
    await roomAudio.stopPublishing();
    const ack = await realtime.releaseSpeaker(speechTurnId);
    if (ack?.ok) {
      setRoomActionNotice("本轮发言已结束，已进入冷却");
      const recording = await recordingPromise;
      if (recording) void uploadPendingSpeechRecording(speechTurnId, recording);
    }
  }

  async function reloadMaterials() {
    setMaterialsStatus("loading");
    setMaterialsError(null);
    try {
      const result = await listRoomMaterials(roomId);
      setMaterials(result.items);
      setMaterialsStatus("ready");
    } catch (error) {
      setMaterialsStatus("error");
      setMaterialsError(errorMessage(error, "背景资料加载失败"));
    }
  }

  async function sendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = chatDraft.trim();
    if (!content || roomActionDisabled) return;
    const ack = await realtime.sendChat(content);
    if (ack?.ok) setChatDraft("");
  }

  async function likeCurrentSpeaker() {
    const speechTurnId = snapshot?.speakerLock?.speechTurnId;
    if (!speechTurnId || roomActionDisabled) return;
    const ack = await realtime.likeSpeaker(speechTurnId);
    if (ack?.ok) {
      setRoomActionNotice("已赞同当前发言");
      void refreshSpeechTurns();
    }
  }

  async function rewardCurrentSpeaker(amount: (typeof rewardAmounts)[number]) {
    const speechTurnId = snapshot?.speakerLock?.speechTurnId;
    if (!speechTurnId || roomActionDisabled) return;
    const ack = await realtime.sendReward(speechTurnId, amount);
    if (ack?.ok) {
      setRoomActionNotice(`已打赏 ${amount} 知豆，余额 ${ack.data.remainingBalance}`);
      void refreshSpeechTurns();
    }
  }

  const danmakuMessages = useMemo(
    () =>
      messages.filter((message) => message.type === "text").slice(-maximumVisibleDanmakuMessages),
    [messages],
  );

  if (pageStatus === "loading") {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <AppHeader onAccountClick={() => setAccountOpen(true)} />
        <main className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
          <div className="h-28 animate-pulse rounded-3xl bg-white" />
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="h-96 animate-pulse rounded-3xl bg-white" />
            <div className="h-96 animate-pulse rounded-3xl bg-white" />
          </div>
        </main>
        <AccountDialog onClose={() => setAccountOpen(false)} open={accountOpen} />
      </div>
    );
  }

  if (pageStatus === "error" || !snapshot) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <AppHeader onAccountClick={() => setAccountOpen(true)} />
        <main className="mx-auto max-w-xl px-5 py-20 text-center">
          <div className="rounded-3xl border border-rose-100 bg-white p-10 shadow-sm">
            <p className="text-lg font-semibold text-slate-800">无法进入房间</p>
            <p className="mt-3 text-sm text-rose-600">{pageError}</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-700" to="/">
                返回大厅
              </Link>
              <button
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                onClick={() => setReloadVersion((value) => value + 1)}
                type="button"
              >
                重新加载
              </button>
            </div>
          </div>
        </main>
        <AccountDialog onClose={() => setAccountOpen(false)} open={accountOpen} />
      </div>
    );
  }

  const { room, seats, speakerLock } = snapshot;
  const speakerSeat = speakerLock
    ? seats.find((seat) => seat.seatNumber === speakerLock.seatNumber)
    : undefined;
  const speaker = speakerSeat?.occupant ?? null;
  const serverNowMilliseconds = clockTick + realtime.serverClockOffsetMilliseconds;
  const speakerRemainingSeconds = remainingSeconds(speakerLock?.expiresAt, serverNowMilliseconds);
  const cooldownRemainingSeconds = remainingSeconds(
    currentCooldown?.expiresAt,
    serverNowMilliseconds,
  );
  const actionPending = realtime.pendingAction !== null;
  const roomActionDisabled = realtime.status !== "connected" || actionPending;
  const currentSpeechTurnId = speakerLock?.speechTurnId ?? null;
  const speakerActionDisabled = roomActionDisabled || !currentSpeechTurnId || !speaker;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader onAccountClick={() => setAccountOpen(true)} />
      <main className="mx-auto max-w-6xl px-4 py-5 lg:px-8 lg:py-7">
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex min-w-0 items-start gap-3">
            <Link
              aria-label="返回大厅"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
              to="/"
            >
              ←
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold leading-7 text-slate-950">{room.topic.title}</h1>
              <p className="mt-1 text-sm text-slate-500">
                <span
                  className={
                    room.status === "active" ? "mr-2 text-rose-500" : "mr-2 text-amber-500"
                  }
                >
                  ● {room.status === "active" ? "直播中" : "即将关闭"}
                </span>
                {room.onlineCount} 人在线
                {speaker ? ` · ${speaker.displayName}正在发言` : " · 当前无人发言"}
              </p>
              <p
                className={`mt-1 text-xs ${
                  realtime.status === "connected"
                    ? "text-emerald-600"
                    : realtime.status === "error"
                      ? "text-rose-600"
                      : "text-amber-600"
                }`}
              >
                {connectionLabel(realtime.status)}
                {realtime.error ? ` · ${realtime.error}` : ""}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={
                    roomAudio.status === "connected"
                      ? roomAudio.isPublishing
                        ? "text-orange-600"
                        : "text-emerald-600"
                      : roomAudio.status === "error" || roomAudio.status === "unavailable"
                        ? "text-rose-600"
                        : "text-amber-600"
                  }
                >
                  {audioConnectionLabel(roomAudio.status, roomAudio.isPublishing)}
                  {roomAudio.remoteAudioCount > 0
                    ? ` · ${roomAudio.remoteAudioCount} 路远端音频`
                    : ""}
                  {roomAudio.error ? ` · ${roomAudio.error}` : ""}
                </span>
                {roomAudio.playbackBlocked ? (
                  <button
                    className="rounded-lg bg-blue-50 px-2 py-1 font-medium text-blue-600 hover:bg-blue-100"
                    onClick={() => void roomAudio.resumePlayback()}
                    type="button"
                  >
                    点击恢复声音
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <button
              aria-label="打开本场辩论日志"
              className="flex max-w-60 items-end gap-2 rounded-2xl bg-white px-2 py-2 text-left transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-100"
              onClick={() => setLogOpen(true)}
              type="button"
            >
              <img
                alt="AI 刘看山"
                className="h-20 w-20 shrink-0 object-contain"
                src="/characters/liukanshan-log.gif"
              />
              <span className="mb-2 rounded-2xl rounded-bl-sm bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">
                我会把本场发言整理成清晰的辩论日志。
              </span>
            </button>
          </div>
        </header>

        <RoomMaterials
          error={materialsError}
          items={materials}
          loading={materialsStatus === "loading"}
          onRetry={() => void reloadMaterials()}
          onToggle={() => setMaterialsOpen((value) => !value)}
          open={materialsOpen}
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 lg:p-7">
            <DanmakuLayer enabled={danmakuEnabled} messages={danmakuMessages} />
            <div
              className={`relative z-20 flex items-center gap-2 text-sm font-medium ${speaker ? "text-orange-600" : "text-slate-500"}`}
            >
              <span
                className={`size-2 rounded-full ${speaker ? "bg-orange-500" : "bg-slate-300"}`}
              />
              {speaker ? `${speaker.displayName}正在发言` : "等待下一位发言者"}
              {speakerLock ? (
                <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs tabular-nums text-orange-600">
                  {countdownLabel(speakerRemainingSeconds)}
                </span>
              ) : null}
              <span className="ml-auto rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-400">
                {room.seatedCount}/6 上麦
              </span>
            </div>
            <div className="relative z-20 mt-7 grid grid-cols-3 gap-x-4 gap-y-8">
              {seats.map((seat) => {
                const occupant = seat.occupant;
                const speaking = occupant?.userId === speaker?.userId;
                const mine = occupant?.userId === currentUserId;
                return (
                  <div className="text-center" key={seat.seatNumber}>
                    {occupant ? (
                      <>
                        <div
                          className={`relative mx-auto grid size-16 place-items-center overflow-hidden rounded-full text-lg font-semibold text-white ${
                            speaking
                              ? "bg-blue-600 ring-4 ring-orange-200 shadow-lg shadow-orange-100"
                              : mine
                                ? "bg-orange-500 ring-2 ring-blue-400"
                                : "bg-emerald-500"
                          }`}
                        >
                          {occupant.avatarUrl ? (
                            <img
                              alt=""
                              className="size-full object-cover"
                              referrerPolicy="no-referrer"
                              src={occupant.avatarUrl}
                            />
                          ) : (
                            userInitial(occupant.displayName)
                          )}
                          {mine ? (
                            <span className="absolute top-0 right-0 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px]">
                              我
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 truncate text-sm font-medium text-slate-800">
                          {occupant.displayName}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Lv.{occupant.level} {occupant.levelTitle}
                        </p>
                      </>
                    ) : (
                      <>
                        <button
                          aria-label="申请上麦，系统自动分配空麦位"
                          className={`mx-auto grid size-16 place-items-center rounded-full border-2 border-dashed text-xl transition-colors ${
                            currentSeat || currentUserQueueEntry || roomActionDisabled
                              ? "cursor-not-allowed border-slate-200 text-slate-300"
                              : "border-blue-300 text-blue-500 hover:border-blue-500 hover:bg-blue-50"
                          }`}
                          disabled={Boolean(
                            currentSeat || currentUserQueueEntry || roomActionDisabled,
                          )}
                          onClick={() => void requestSeat()}
                          title="系统会自动分配一个空麦位"
                          type="button"
                        >
                          +
                        </button>
                        <p className="mt-2 text-sm text-slate-400">空麦位</p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {currentSeat ? (
              <p className="relative z-20 mt-6 rounded-2xl bg-slate-50 px-4 py-3 text-center text-xs leading-5 text-slate-500">
                {roomAudio.isPublishing
                  ? "麦克风已开启；本轮语音会同步用于实时传输、发言转写和 AI 总结。"
                  : "点击“开始发言”后浏览器会请求麦克风权限；仅获得发言权时录制本轮语音，用于转写和 AI 总结。"}
              </p>
            ) : null}
            {currentUserQueueEntry ? (
              <div className="relative z-20 mt-7 flex items-center justify-center gap-3 rounded-2xl bg-blue-50 p-3 text-sm text-blue-700">
                <span>你当前排在上麦队列第 {currentUserQueueEntry.position} 位</span>
                <button
                  className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={roomActionDisabled}
                  onClick={() => void cancelSeatRequest()}
                  type="button"
                >
                  取消排队
                </button>
              </div>
            ) : null}
          </section>

          <section className="flex min-h-[430px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-800">公屏</h2>
              <p className="mt-1 text-xs text-slate-400">聊天 · 打赏 · 系统消息</p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4" ref={messageListRef}>
              {messagesStatus === "loading" ? (
                <p className="text-sm text-slate-400">正在读取公屏消息…</p>
              ) : null}
              {messagesError ? (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">
                  {messagesError}
                </p>
              ) : null}
              {messagesStatus === "ready" && messages.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">还没有公屏消息</p>
              ) : null}
              {messages.map((message) =>
                message.type === "system" ? (
                  <p
                    className="rounded-xl bg-orange-50 px-3 py-2 text-xs text-orange-700"
                    key={message.messageId}
                  >
                    {message.content}
                  </p>
                ) : (
                  <p className="text-sm leading-6 text-slate-600" key={message.messageId}>
                    <strong className="mr-1 font-medium text-slate-800">
                      {message.sender?.displayName ?? "知友"}：
                    </strong>
                    {message.content}
                  </p>
                ),
              )}
            </div>
            <div className="border-t border-slate-100 p-3">
              <form className="flex gap-2" onSubmit={(event) => void sendChatMessage(event)}>
                <input
                  className="min-w-0 flex-1 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:text-slate-400"
                  disabled={roomActionDisabled}
                  maxLength={200}
                  onChange={(event) => setChatDraft(event.target.value)}
                  placeholder={
                    realtime.status === "connected" ? "说点什么…" : "实时连接后可发送消息"
                  }
                  value={chatDraft}
                />
                <button
                  className="rounded-xl bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  disabled={roomActionDisabled || chatDraft.trim().length === 0}
                  type="submit"
                >
                  发送
                </button>
                <button
                  aria-pressed={danmakuEnabled}
                  className={`rounded-xl px-3 text-sm font-medium transition ${
                    danmakuEnabled
                      ? "bg-orange-500 text-white shadow-sm shadow-orange-100 hover:bg-orange-600"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                  onClick={() => setDanmakuEnabled((value) => !value)}
                  title={danmakuEnabled ? "关闭飘屏弹幕" : "开启飘屏弹幕"}
                  type="button"
                >
                  {danmakuEnabled ? "弹幕开" : "弹幕关"}
                </button>
              </form>
            </div>
          </section>
        </div>

        {roomActionNotice || realtime.actionError ? (
          <div
            className={`mt-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm ${
              realtime.actionError ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            <span>{realtime.actionError ?? roomActionNotice}</span>
            <button
              aria-label="关闭操作提示"
              className="shrink-0 rounded-lg px-2 py-1 hover:bg-white/60"
              onClick={() => {
                setRoomActionNotice(null);
                realtime.clearActionError();
              }}
              type="button"
            >
              ×
            </button>
          </div>
        ) : null}

        <footer className="sticky bottom-4 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl shadow-slate-200/70 backdrop-blur">
          <button
            className="rounded-xl px-4 py-2.5 text-sm text-slate-600 transition hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
            disabled={speakerActionDisabled}
            onClick={() => void likeCurrentSpeaker()}
            type="button"
          >
            △ 赞同
          </button>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" />
          <span className="text-xs text-slate-400">打赏</span>
          {rewardAmounts.map((amount) => (
            <button
              className="rounded-full border border-slate-200 px-3.5 py-2 text-sm text-slate-500 transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:border-slate-200 disabled:hover:bg-transparent"
              disabled={speakerActionDisabled}
              key={amount}
              onClick={() => void rewardCurrentSpeaker(amount)}
              type="button"
            >
              {amount}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {currentSeat ? (
              <>
                <button
                  className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={roomActionDisabled}
                  onClick={() => void leaveSeat()}
                  type="button"
                >
                  {realtime.pendingAction === "leave-seat" ? "下麦中…" : "下麦"}
                </button>
                <button
                  className={`rounded-xl px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                    currentUserIsSpeaker
                      ? "bg-rose-500 hover:bg-rose-600"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                  disabled={
                    roomActionDisabled ||
                    (!currentUserIsSpeaker && Boolean(speakerLock)) ||
                    (!currentUserIsSpeaker && cooldownRemainingSeconds > 0) ||
                    (!currentUserIsSpeaker && roomAudio.status !== "connected")
                  }
                  onClick={() => void (currentUserIsSpeaker ? releaseSpeaker() : acquireSpeaker())}
                  type="button"
                >
                  {realtime.pendingAction === "acquire-speaker"
                    ? "申请中…"
                    : realtime.pendingAction === "release-speaker"
                      ? "结束中…"
                      : currentUserIsSpeaker
                        ? `结束发言 ${countdownLabel(speakerRemainingSeconds)}`
                        : speaker
                          ? `等待 ${speaker.displayName}`
                          : cooldownRemainingSeconds > 0
                            ? `冷却 ${cooldownRemainingSeconds}s`
                            : roomAudio.status === "connecting"
                              ? "语音连接中…"
                              : roomAudio.status !== "connected"
                                ? "语音不可用"
                                : "开始发言"}
                </button>
              </>
            ) : (
              <button
                className={`rounded-xl px-6 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  currentUserQueueEntry
                    ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
                disabled={roomActionDisabled}
                onClick={() => void (currentUserQueueEntry ? cancelSeatRequest() : requestSeat())}
                type="button"
              >
                {realtime.pendingAction === "request-seat"
                  ? "申请中…"
                  : realtime.pendingAction === "cancel-seat"
                    ? "取消中…"
                    : currentUserQueueEntry
                      ? `取消排队（第 ${currentUserQueueEntry.position} 位）`
                      : currentUser?.identityType === "guest"
                        ? "登录后上麦"
                        : "上麦"}
              </button>
            )}
          </div>
        </footer>
      </main>

      {logOpen ? (
        <DebateLogDrawer
          onClose={() => setLogOpen(false)}
          onRetryTranscript={(speechTurnId) => {
            void uploadPendingSpeechRecording(speechTurnId);
          }}
          onRetrySummary={() => {
            summaryRequestVersion.current = speechTurnsPage?.transcriptVersion ?? null;
            void refreshSummary();
          }}
          retryableSpeechTurnIds={retryableSpeechTurnIds}
          speechTurns={speechTurnsPage?.items ?? []}
          speechTurnsError={speechTurnsError}
          speechTurnsLoading={speechTurnsStatus === "loading"}
          summary={summary}
          summaryError={summaryError}
        />
      ) : null}
      {logOpen ? (
        <button
          aria-label="关闭辩论日志遮罩"
          className="fixed inset-0 z-30 bg-slate-950/20"
          onClick={() => setLogOpen(false)}
          type="button"
        />
      ) : null}
      <AccountDialog onClose={() => setAccountOpen(false)} open={accountOpen} />
    </div>
  );
}
