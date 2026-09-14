import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AccountDialog } from "../components/AccountDialog";
import { AppHeader, type LobbyTab } from "../components/AppHeader";
import {
  ApiError,
  createRoom,
  getZhihuAuthorizeUrl,
  listRooms,
  type Room,
} from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";

interface CreateRoomDialogProps {
  open: boolean;
  error: string | null;
  isSubmitting: boolean;
  requiresLogin: boolean;
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
  onLogin: () => void;
}

function CreateRoomDialog({
  open,
  error,
  isSubmitting,
  requiresLogin,
  onClose,
  onCreate,
  onLogin,
}: CreateRoomDialogProps) {
  const [title, setTitle] = useState("");
  if (!open) return null;
  const normalizedTitle = title.trim();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <section
        aria-labelledby="create-room-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-950" id="create-room-title">
              创建辩论房间
            </h2>
            <p className="mt-1 text-sm text-slate-500">发起一场公开的知识讨论</p>
          </div>
          <button
            aria-label="关闭创建房间弹窗"
            className="grid size-9 place-items-center rounded-full text-xl text-slate-400 hover:bg-slate-100"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        {requiresLogin ? (
          <div className="mt-5 rounded-2xl bg-blue-50 p-4 text-sm text-blue-700">
            <p>游客可以浏览和旁听，创建房间需要先登录知乎。</p>
            <button className="mt-3 font-semibold hover:underline" onClick={onLogin} type="button">
              登录知乎 →
            </button>
          </div>
        ) : null}

        <label className="mt-6 block text-sm font-medium text-slate-700" htmlFor="room-title">
          辩题 / 话题标题
        </label>
        <textarea
          autoFocus
          className="mt-2 h-28 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          disabled={isSubmitting}
          id="room-title"
          maxLength={30}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：AI 会让人类更自由吗？"
          value={title}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <span>创建后会展示在私人房列表，所有人均可加入</span>
          <span>{title.length}/30</span>
        </div>
        {error ? (
          <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="mt-6 w-full rounded-2xl bg-blue-600 py-3.5 font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          disabled={!normalizedTitle || isSubmitting || requiresLogin}
          onClick={() => void onCreate(normalizedTitle)}
          type="button"
        >
          {isSubmitting ? "正在创建…" : "创建并加入房间"}
        </button>
      </section>
    </div>
  );
}

function userInitial(displayName: string): string {
  return displayName.trim().charAt(0) || "知";
}

function RoomCard({ room, onEnter }: { room: Room; onEnter: () => void }) {
  const creatorName = room.creator?.displayName ?? "知乎热榜";

  return (
    <button
      className="group rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-100/60"
      onClick={onEnter}
      type="button"
    >
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-600">
          {room.type === "hot" && room.topic.hotRank
            ? `热榜第 ${room.topic.hotRank} 位`
            : "用户发起"}
        </span>
        <span className="text-xs text-slate-400">{room.seatedCount}/6 上麦</span>
      </div>
      <h3 className="mt-5 min-h-14 text-lg font-semibold leading-7 text-slate-900 group-hover:text-blue-600">
        {room.topic.title}
      </h3>
      <div className="mt-5 flex items-center gap-2">
        {room.creator?.avatarUrl ? (
          <img
            alt=""
            className="size-8 rounded-full object-cover"
            referrerPolicy="no-referrer"
            src={room.creator.avatarUrl}
          />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-slate-500 text-xs font-medium text-white">
            {userInitial(creatorName)}
          </span>
        )}
        <span className="text-sm text-slate-600">{creatorName}</span>
        {room.creator ? (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
            Lv.{room.creator.level} {room.creator.levelTitle}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">{room.onlineCount} 人在线</span>
      </div>
      <div
        className="mt-5 grid grid-cols-6 gap-1.5"
        aria-label={`${room.seatedCount} 个麦位已占用`}
      >
        {Array.from({ length: 6 }, (_, index) => (
          <span
            className={`h-1.5 rounded-full ${index < room.seatedCount ? "bg-blue-500" : "bg-slate-100"}`}
            key={index}
          />
        ))}
      </div>
    </button>
  );
}

function RoomListSkeleton() {
  return (
    <div className="contents" aria-label="正在加载房间">
      {[0, 1, 2, 3].map((item) => (
        <div
          className="h-56 animate-pulse rounded-3xl border border-slate-200 bg-white p-5"
          key={item}
        >
          <div className="h-6 w-24 rounded-full bg-slate-100" />
          <div className="mt-6 h-5 w-4/5 rounded bg-slate-100" />
          <div className="mt-3 h-5 w-3/5 rounded bg-slate-100" />
          <div className="mt-7 h-8 w-2/5 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const session = useSessionStore((state) => state.session);
  const sessionStatus = useSessionStore((state) => state.status);
  const [activeTab, setActiveTab] = useState<LobbyTab>("official");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsStatus, setRoomsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [createRoomError, setCreateRoomError] = useState<string | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setRooms([]);
    setRoomsStatus("loading");
    setRoomsError(null);

    void listRooms(activeTab === "official" ? "hot" : "custom", controller.signal)
      .then((page) => {
        setRooms(page.items);
        setRoomsStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setRoomsError(error instanceof Error ? error.message : "房间列表加载失败");
        setRoomsStatus("error");
      });

    return () => controller.abort();
  }, [activeTab, reloadVersion]);

  const featuredRoom = activeTab === "official" ? rooms[0] : undefined;
  const requiresLogin = sessionStatus === "ready" && !session?.permissions.canCreateRoom;

  function openCreateRoomDialog() {
    setCreateRoomError(null);
    setCreateRoomOpen(true);
  }

  function startZhihuLogin() {
    window.location.assign(getZhihuAuthorizeUrl("/"));
  }

  async function handleCreateRoom(title: string) {
    if (sessionStatus !== "ready") {
      setCreateRoomError("用户会话仍在初始化，请稍后再试");
      return;
    }
    if (!session?.permissions.canCreateRoom) {
      setCreateRoomError("需要登录知乎后才能创建房间");
      return;
    }

    setIsCreatingRoom(true);
    setCreateRoomError(null);
    try {
      const result = await createRoom(title);
      setCreateRoomOpen(false);
      navigate(`/rooms/${result.room.roomId}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "ZHIHU_LOGIN_REQUIRED") {
        setCreateRoomError("登录状态已失效，请重新登录知乎");
      } else {
        setCreateRoomError(error instanceof Error ? error.message : "房间创建失败");
      }
    } finally {
      setIsCreatingRoom(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader
        activeTab={activeTab}
        onAccountClick={() => setAccountOpen(true)}
        onTabChange={setActiveTab}
      />
      <main className="mx-auto max-w-6xl px-5 py-7 lg:px-8 lg:py-10">
        {activeTab === "official" ? (
          <section className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 p-7 text-white shadow-xl shadow-blue-200/60 lg:p-10">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-blue-100">
                {featuredRoom?.topic.hotRank
                  ? `今日知乎热榜第 ${featuredRoom.topic.hotRank} 位`
                  : "知乎热榜讨论房"}
              </p>
              <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">
                {featuredRoom?.topic.title ??
                  (roomsStatus === "loading" ? "正在加载今日话题…" : "来聊聊今天的热门话题")}
              </h1>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <span className="text-sm text-blue-100">
                  {featuredRoom ? `${featuredRoom.onlineCount} 人正在房间` : "每天同步知乎热榜"}
                </span>
                {featuredRoom ? (
                  <button
                    className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                    onClick={() => navigate(`/rooms/${featuredRoom.roomId}`)}
                    type="button"
                  >
                    进入辩论 →
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <section className="flex flex-wrap items-end justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-6">
            <div>
              <p className="text-sm font-medium text-blue-600">私人房</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">知友发起的公开讨论</h1>
              <p className="mt-2 text-sm text-slate-500">
                选择感兴趣的话题加入，或者创建一个新房间。
              </p>
            </div>
            <button
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
              onClick={openCreateRoomDialog}
              type="button"
            >
              + 创建房间
            </button>
          </section>
        )}

        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="房间列表">
          {roomsStatus === "loading" ? <RoomListSkeleton /> : null}
          {roomsStatus === "error" ? (
            <div className="col-span-full rounded-3xl border border-rose-100 bg-white p-8 text-center">
              <p className="font-medium text-slate-800">暂时无法读取房间</p>
              <p className="mt-2 text-sm text-rose-600">{roomsError}</p>
              <button
                className="mt-5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                onClick={() => setReloadVersion((version) => version + 1)}
                type="button"
              >
                重新加载
              </button>
            </div>
          ) : null}
          {roomsStatus === "ready" && rooms.length === 0 ? (
            <div className="col-span-full rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="font-medium text-slate-700">
                {activeTab === "private" ? "还没有私人房" : "今天的热榜房还未生成"}
              </p>
              {activeTab === "private" ? (
                <button
                  className="mt-4 text-sm font-semibold text-blue-600 hover:underline"
                  onClick={openCreateRoomDialog}
                  type="button"
                >
                  创建第一个房间
                </button>
              ) : null}
            </div>
          ) : null}
          {rooms.map((room) => (
            <RoomCard
              key={room.roomId}
              onEnter={() => navigate(`/rooms/${room.roomId}`)}
              room={room}
            />
          ))}
        </section>
      </main>

      <button
        aria-label="创建私人房"
        className="fixed right-6 bottom-6 grid size-14 place-items-center rounded-full bg-blue-600 text-2xl text-white shadow-xl shadow-blue-300 transition hover:scale-105 hover:bg-blue-700"
        onClick={openCreateRoomDialog}
        type="button"
      >
        +
      </button>
      <CreateRoomDialog
        error={createRoomError}
        isSubmitting={isCreatingRoom}
        onClose={() => setCreateRoomOpen(false)}
        onCreate={handleCreateRoom}
        onLogin={startZhihuLogin}
        open={createRoomOpen}
        requiresLogin={requiresLogin}
      />
      <AccountDialog onClose={() => setAccountOpen(false)} open={accountOpen} />
    </div>
  );
}
