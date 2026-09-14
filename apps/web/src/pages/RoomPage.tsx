import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import { AccountDialog } from "../components/AccountDialog";
import { AppHeader } from "../components/AppHeader";

const roomTitles: Record<string, string> = {
  "ai-programmers": "AI 是否会全面取代初级程序员？",
  "new-energy": "中国新能源车出海：机遇还是泡沫？",
  "college-career": "大学生创业 vs 先就业再创业，哪条路更优？",
  education: "教育内卷：父母应该让孩子躺平吗？",
  metaverse: "元宇宙：下一个互联网还是下一个泡沫？",
  "indie-developer": "独立开发者的黄金时代真的来了吗？",
  "new-room": "AI 会让人类更自由吗？",
};

const materials = [
  { title: "AI 对编程岗位影响的行业观察", meta: "知乎回答 · 2.3 万赞" },
  { title: "程序员真的会失业吗？来自一线工程师的实践", meta: "知乎回答 · 1.8 万赞" },
  { title: "AI 时代，初级工程师的成长路径", meta: "知乎文章 · 9200 赞" },
];

interface SeatData {
  initial: string;
  name: string;
  level: string;
  speaking?: boolean;
  mine?: boolean;
}

const seats: Array<SeatData | null> = [
  { initial: "林", name: "林知秋", level: "Lv.6 知秋", speaking: true },
  { initial: "余", name: "我", level: "Lv.3 蜕壳", mine: true },
  { initial: "徐", name: "徐振翅", level: "Lv.4 振翅" },
  { initial: "周", name: "周鸣夏", level: "Lv.5 鸣夏" },
  null,
  null,
];

const messages = [
  { type: "system", content: "知音人打赏了当前发言者 50 知豆" },
  { type: "text", author: "程序猿老张", content: "AI 会压缩重复编码工作，但不会替代需求理解。" },
  { type: "text", author: "Ivy_UX", content: "同意，编码只是解决问题的一种手段。" },
  { type: "system", content: "晓风升级到了「破土」" },
  { type: "text", author: "独立开发者", content: "人与 AI 协作可能会成为更普遍的工作方式。" },
] as const;

const transcriptItems = [
  {
    name: "林知秋",
    time: "14:10",
    content: "AI 目前仍然是工具，复杂业务中的沟通、判断和需求理解短期内很难被替代。",
  },
  {
    name: "徐振翅",
    time: "14:14",
    content: "入门级编码工作会减少，但新的测试、监督和 AI 协作岗位也在出现。",
  },
  {
    name: "周鸣夏",
    time: "14:18",
    content: "关键不是职位是否消失，而是初级程序员的工作边界会被重新定义。",
  },
];

function DebateLogDrawer({ onClose }: { onClose: () => void }) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-2xl lg:top-0">
      <div className="sticky top-0 border-b border-slate-100 bg-white/95 p-5 backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-blue-600">AI 刘看山</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">本场辩论日志</h2>
          </div>
          <button
            aria-label="关闭辩论日志"
            className="grid size-9 place-items-center rounded-full text-xl text-slate-400 hover:bg-slate-100"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <p className="mt-4 rounded-2xl bg-blue-50 p-3 text-sm leading-6 text-blue-700">
          已根据当前完成的发言转写整理讨论要点。
        </p>
      </div>
      <div className="space-y-5 p-5">
        {transcriptItems.map((item, index) => (
          <article className="relative pl-10" key={item.time}>
            <span className="absolute left-0 grid size-7 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
              {index + 1}
            </span>
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold text-slate-800">{item.name}</h3>
              <time className="text-xs text-slate-400">{item.time}</time>
            </div>
            <p className="mt-2 rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">
              {item.content}
            </p>
          </article>
        ))}
        <section className="rounded-2xl border border-orange-100 bg-orange-50 p-4">
          <h3 className="font-semibold text-orange-700">AI 总结</h3>
          <p className="mt-2 text-sm leading-7 text-orange-700/80">
            当前共识是 AI
            会改变初级程序员的工作内容；主要分歧在于岗位总量会下降，还是会由新角色补足。
          </p>
        </section>
      </div>
    </aside>
  );
}

export function RoomPage() {
  const { roomId = "" } = useParams();
  const location = useLocation();
  const createdRoomTitle = (location.state as { title?: unknown } | null)?.title;
  const title = useMemo(
    () =>
      (typeof createdRoomTitle === "string" ? createdRoomTitle : null) ??
      roomTitles[roomId] ??
      "一场正在进行的知识讨论",
    [createdRoomTitle, roomId],
  );
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [seatState, setSeatState] = useState<"audience" | "seated">("audience");

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
              <h1 className="text-xl font-semibold leading-7 text-slate-950">{title}</h1>
              <p className="mt-1 text-sm text-slate-500">
                <span className="mr-2 text-rose-500">● 直播中</span>116 人在线 · 林知秋正在发言
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-xl bg-orange-50 px-4 py-2 text-sm text-orange-600"
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

        <section className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white">
          <button
            aria-expanded={materialsOpen}
            className="flex w-full items-center justify-between p-4 text-left"
            onClick={() => setMaterialsOpen((value) => !value)}
            type="button"
          >
            <span className="font-medium text-slate-700">知乎精选背景资料</span>
            <span className="text-sm text-slate-400">3 篇 · {materialsOpen ? "收起" : "展开"}</span>
          </button>
          {materialsOpen ? (
            <div className="grid gap-3 border-t border-slate-100 p-4 md:grid-cols-3">
              {materials.map((material, index) => (
                <a
                  className="rounded-2xl bg-slate-50 p-4 transition hover:bg-blue-50"
                  href="https://www.zhihu.com/"
                  key={material.title}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="text-xs font-semibold text-blue-600">资料 {index + 1}</span>
                  <h2 className="mt-2 text-sm font-medium leading-6 text-slate-800">
                    {material.title}
                  </h2>
                  <p className="mt-2 text-xs text-slate-400">{material.meta}</p>
                </a>
              ))}
            </div>
          ) : null}
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 lg:p-7">
            <div className="flex items-center gap-2 text-sm font-medium text-orange-600">
              <span className="size-2 rounded-full bg-orange-500" />
              林知秋正在发言
              <span className="ml-auto rounded-full bg-orange-50 px-3 py-1 text-xs">01:24</span>
            </div>
            <div className="mt-7 grid grid-cols-3 gap-x-4 gap-y-8">
              {seats.map((seat, index) => (
                <div className="text-center" key={index}>
                  {seat ? (
                    <>
                      <div
                        className={`relative mx-auto grid size-16 place-items-center rounded-full text-lg font-semibold text-white ${
                          seat.speaking
                            ? "bg-blue-600 ring-4 ring-orange-200 shadow-lg shadow-orange-100"
                            : seat.mine
                              ? "bg-orange-500 ring-2 ring-blue-400"
                              : "bg-emerald-500"
                        }`}
                      >
                        {seat.initial}
                        {seat.mine ? (
                          <span className="absolute -top-1 -right-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px]">
                            我
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-800">{seat.name}</p>
                      <p className="mt-1 text-xs text-slate-400">{seat.level}</p>
                    </>
                  ) : (
                    <>
                      <button
                        aria-label={`申请占用 ${index + 1} 号麦位`}
                        className="mx-auto grid size-16 place-items-center rounded-full border-2 border-dashed border-slate-200 text-xl text-slate-300 hover:border-blue-300 hover:text-blue-500"
                        onClick={() => setSeatState("seated")}
                        type="button"
                      >
                        +
                      </button>
                      <p className="mt-2 text-sm text-slate-400">空麦位</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-[430px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-800">公屏</h2>
              <p className="mt-1 text-xs text-slate-400">聊天 · 打赏 · 系统消息</p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((message, index) =>
                message.type === "system" ? (
                  <p
                    className="rounded-xl bg-orange-50 px-3 py-2 text-xs text-orange-700"
                    key={index}
                  >
                    {message.content}
                  </p>
                ) : (
                  <p className="text-sm leading-6 text-slate-600" key={index}>
                    <strong className="mr-1 font-medium text-slate-800">{message.author}：</strong>
                    {message.content}
                  </p>
                ),
              )}
            </div>
            <div className="border-t border-slate-100 p-3">
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="说点什么…"
                  value={chatInput}
                />
                <button
                  className="rounded-xl bg-blue-600 px-4 text-sm font-medium text-white"
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
            className="rounded-xl px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100"
            type="button"
          >
            △ 赞同
          </button>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" />
          <span className="text-xs text-slate-400">打赏</span>
          {[5, 10, 50].map((amount) => (
            <button
              className="rounded-full border border-orange-200 px-3.5 py-2 text-sm text-orange-600 hover:bg-orange-50"
              key={amount}
              type="button"
            >
              {amount}
            </button>
          ))}
          <button
            className="ml-auto rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-200 hover:bg-orange-600"
            onClick={() => setSeatState((state) => (state === "audience" ? "seated" : "audience"))}
            type="button"
          >
            {seatState === "audience" ? "上麦" : "下麦"}
          </button>
        </footer>
      </main>

      {logOpen ? <DebateLogDrawer onClose={() => setLogOpen(false)} /> : null}
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
