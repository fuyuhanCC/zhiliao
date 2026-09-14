import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { AccountDialog } from "../components/AccountDialog";
import { AppHeader, type LobbyTab } from "../components/AppHeader";

interface RoomCardData {
  roomId: string;
  title: string;
  rank?: number;
  creator: string;
  creatorInitial: string;
  level: string;
  seatedCount: number;
  onlineCount: number;
}

const officialRooms: RoomCardData[] = [
  {
    roomId: "ai-programmers",
    title: "AI 是否会全面取代初级程序员？",
    rank: 1,
    creator: "林知秋",
    creatorInitial: "林",
    level: "Lv.6 知秋",
    seatedCount: 4,
    onlineCount: 116,
  },
  {
    roomId: "new-energy",
    title: "中国新能源车出海：机遇还是泡沫？",
    rank: 2,
    creator: "徐振翅",
    creatorInitial: "徐",
    level: "Lv.4 振翅",
    seatedCount: 3,
    onlineCount: 89,
  },
  {
    roomId: "college-career",
    title: "大学生创业 vs 先就业再创业，哪条路更优？",
    rank: 3,
    creator: "周鸣夏",
    creatorInitial: "周",
    level: "Lv.5 鸣夏",
    seatedCount: 6,
    onlineCount: 43,
  },
  {
    roomId: "education",
    title: "教育内卷：父母应该让孩子躺平吗？",
    rank: 4,
    creator: "陈蜕壳",
    creatorInitial: "陈",
    level: "Lv.3 蜕壳",
    seatedCount: 2,
    onlineCount: 32,
  },
];

const privateRooms: RoomCardData[] = [
  {
    roomId: "metaverse",
    title: "元宇宙：下一个互联网还是下一个泡沫？",
    creator: "知友小李",
    creatorInitial: "知",
    level: "Lv.2 破土",
    seatedCount: 2,
    onlineCount: 18,
  },
  {
    roomId: "indie-developer",
    title: "独立开发者的黄金时代真的来了吗？",
    creator: "极客老王",
    creatorInitial: "极",
    level: "Lv.4 振翅",
    seatedCount: 1,
    onlineCount: 9,
  },
];

interface CreateRoomDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string) => void;
}

function CreateRoomDialog({ open, onClose, onCreate }: CreateRoomDialogProps) {
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
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <label className="mt-6 block text-sm font-medium text-slate-700" htmlFor="room-title">
          辩题 / 话题标题
        </label>
        <textarea
          autoFocus
          className="mt-2 h-28 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
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
        <button
          className="mt-6 w-full rounded-2xl bg-blue-600 py-3.5 font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          disabled={!normalizedTitle}
          onClick={() => onCreate(normalizedTitle)}
          type="button"
        >
          创建并加入房间
        </button>
      </section>
    </div>
  );
}

function RoomCard({ room, onEnter }: { room: RoomCardData; onEnter: () => void }) {
  return (
    <button
      className="group rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-100/60"
      onClick={onEnter}
      type="button"
    >
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-600">
          {room.rank ? `热榜第 ${room.rank} 位` : "用户发起"}
        </span>
        <span className="text-xs text-slate-400">{room.seatedCount}/6 上麦</span>
      </div>
      <h3 className="mt-5 min-h-14 text-lg font-semibold leading-7 text-slate-900 group-hover:text-blue-600">
        {room.title}
      </h3>
      <div className="mt-5 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-full bg-slate-500 text-xs font-medium text-white">
          {room.creatorInitial}
        </span>
        <span className="text-sm text-slate-600">{room.creator}</span>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
          {room.level}
        </span>
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

export function HomePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<LobbyTab>("official");
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const rooms = activeTab === "official" ? officialRooms : privateRooms;

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
              <p className="text-sm font-medium text-blue-100">今日知乎热榜第 1 位</p>
              <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">
                AI 是否会全面取代初级程序员？
              </h1>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <span className="text-sm text-blue-100">116 人正在讨论</span>
                <button
                  className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                  onClick={() => navigate("/rooms/ai-programmers")}
                  type="button"
                >
                  进入辩论 →
                </button>
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
              onClick={() => setCreateRoomOpen(true)}
              type="button"
            >
              + 创建房间
            </button>
          </section>
        )}

        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label="房间列表">
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
        onClick={() => setCreateRoomOpen(true)}
        type="button"
      >
        +
      </button>
      <CreateRoomDialog
        onClose={() => setCreateRoomOpen(false)}
        onCreate={(title) => navigate("/rooms/new-room", { state: { title } })}
        open={createRoomOpen}
      />
      <AccountDialog onClose={() => setAccountOpen(false)} open={accountOpen} />
    </div>
  );
}
