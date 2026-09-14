import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { AccountDialog } from "../components/AccountDialog";
import { AppHeader } from "../components/AppHeader";
import { DebateLogDrawer } from "../features/debate-log/DebateLogDrawer";
import { RoomMaterials } from "../features/room/RoomMaterials";
import { useRoomRealtime, type RoomConnectionStatus } from "../features/room/use-room-realtime";
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
import { useSessionStore } from "../stores/session-store";

type LoadStatus = "loading" | "ready" | "error";

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

export function RoomPage() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const currentUserId = useSessionStore((state) => state.session?.user.userId);
  const sessionStatus = useSessionStore((state) => state.status);
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
  const [speechTurnsPage, setSpeechTurnsPage] = useState<SpeechTurnPage | null>(null);
  const [speechTurnsStatus, setSpeechTurnsStatus] = useState<LoadStatus>("loading");
  const [speechTurnsError, setSpeechTurnsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResource | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const summaryRequestVersion = useRef<number | null>(null);
  const summaryRequestSequence = useRef(0);

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
            setMessages(page.items);
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

  const realtime = useRoomRealtime({
    roomId,
    enabled: pageStatus === "ready" && sessionStatus === "ready" && snapshot !== null,
    snapshot,
    onSnapshot: setSnapshot,
    onRoomClosed: handleRoomClosed,
  });

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

  const { room, seats, queue, speakerLock } = snapshot;
  const speakerSeat = speakerLock
    ? seats.find((seat) => seat.seatNumber === speakerLock.seatNumber)
    : undefined;
  const speaker = speakerSeat?.occupant ?? null;
  const currentUserQueueEntry = queue.find((entry) => entry.userId === currentUserId);

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
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="cursor-not-allowed rounded-xl bg-orange-50 px-4 py-2 text-sm text-orange-400"
              disabled
              title="弹幕开关将在实时房间阶段接入"
              type="button"
            >
              弹幕
            </button>
            <button
              className="rounded-xl bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100"
              onClick={() => setLogOpen(true)}
              type="button"
            >
              辩论日志
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
          <section className="rounded-3xl border border-slate-200 bg-white p-5 lg:p-7">
            <div
              className={`flex items-center gap-2 text-sm font-medium ${speaker ? "text-orange-600" : "text-slate-500"}`}
            >
              <span
                className={`size-2 rounded-full ${speaker ? "bg-orange-500" : "bg-slate-300"}`}
              />
              {speaker ? `${speaker.displayName}正在发言` : "等待下一位发言者"}
              <span className="ml-auto rounded-full bg-slate-50 px-3 py-1 text-xs text-slate-400">
                {room.seatedCount}/6 上麦
              </span>
            </div>
            <div className="mt-7 grid grid-cols-3 gap-x-4 gap-y-8">
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
                          aria-label={`${seat.seatNumber} 号空麦位`}
                          className="mx-auto grid size-16 cursor-not-allowed place-items-center rounded-full border-2 border-dashed border-slate-200 text-xl text-slate-300"
                          disabled
                          title="麦位操作将在实时房间阶段接入"
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
            {currentUserQueueEntry ? (
              <p className="mt-7 rounded-2xl bg-blue-50 p-3 text-center text-sm text-blue-700">
                你当前排在上麦队列第 {currentUserQueueEntry.position} 位
              </p>
            ) : null}
          </section>

          <section className="flex min-h-[430px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-800">公屏</h2>
              <p className="mt-1 text-xs text-slate-400">聊天 · 打赏 · 系统消息</p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
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
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 cursor-not-allowed rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-400"
                  disabled
                  placeholder="实时连接后可发送消息"
                />
                <button
                  className="cursor-not-allowed rounded-xl bg-slate-200 px-4 text-sm font-medium text-slate-400"
                  disabled
                  type="button"
                >
                  发送
                </button>
              </div>
            </div>
          </section>
        </div>

        <footer className="sticky bottom-4 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl shadow-slate-200/70 backdrop-blur">
          <button
            className="cursor-not-allowed rounded-xl px-4 py-2.5 text-sm text-slate-400"
            disabled
            type="button"
          >
            △ 赞同
          </button>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" />
          <span className="text-xs text-slate-400">打赏</span>
          {[5, 10, 50].map((amount) => (
            <button
              className="cursor-not-allowed rounded-full border border-slate-200 px-3.5 py-2 text-sm text-slate-300"
              disabled
              key={amount}
              type="button"
            >
              {amount}
            </button>
          ))}
          <button
            className="ml-auto cursor-not-allowed rounded-xl bg-slate-200 px-6 py-3 text-sm font-semibold text-slate-400"
            disabled
            title="上麦将在实时房间阶段接入"
            type="button"
          >
            上麦
          </button>
        </footer>
      </main>

      {logOpen ? (
        <DebateLogDrawer
          onClose={() => setLogOpen(false)}
          onRetrySummary={() => {
            summaryRequestVersion.current = speechTurnsPage?.transcriptVersion ?? null;
            void refreshSummary();
          }}
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
