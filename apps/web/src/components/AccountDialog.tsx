import { USER_LEVELS } from "@zhiliao/shared";

import { getZhihuAuthorizeUrl } from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";

interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
}

const levels = USER_LEVELS.map((item, index) => {
  const nextLevel = USER_LEVELS.at(index + 1);
  return {
    ...item,
    range: nextLevel
      ? `${item.minimumExperience}–${nextLevel.minimumExperience} EXP`
      : `${item.minimumExperience}+ EXP`,
  };
});

export function AccountDialog({ open, onClose }: AccountDialogProps) {
  const session = useSessionStore((state) => state.session);
  const status = useSessionStore((state) => state.status);
  const error = useSessionStore((state) => state.error);

  if (!open) {
    return null;
  }

  const displayName = session?.user.displayName ?? "访客";
  const initial = displayName.trim().charAt(0) || "知";
  const experience = session?.account.experience ?? 0;
  const nextLevelExperience = session?.account.nextLevelExperience ?? null;
  const currentLevelMinimum =
    levels.find((item) => item.level === session?.account.level)?.minimumExperience ?? 0;
  const progress = !session
    ? 0
    : nextLevelExperience === null
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            ((experience - currentLevelMinimum) / (nextLevelExperience - currentLevelMinimum)) *
              100,
          ),
        );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <section
        aria-labelledby="account-title"
        aria-modal="true"
        className="max-h-[86vh] w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
        role="dialog"
      >
        <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-6 text-white">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-full bg-orange-500 text-lg font-semibold">
                {initial}
              </span>
              <div>
                <h2 className="font-semibold" id="account-title">
                  {displayName}
                </h2>
                <p className="mt-1 text-sm text-blue-100">
                  {session ? `知豆余额 · ${session.account.coinBalance}` : "正在读取账户…"}
                </p>
              </div>
            </div>
            <button
              aria-label="关闭账户信息"
              className="grid size-8 place-items-center rounded-full bg-white/15 text-lg hover:bg-white/25"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="mt-5 rounded-2xl bg-white/10 p-4">
            <div className="flex justify-between text-sm">
              <span>
                {session
                  ? `Lv.${session.account.level} ${session.account.levelTitle}`
                  : "尚未建立会话"}
              </span>
              <span>
                {nextLevelExperience === null
                  ? `${experience} EXP`
                  : `${experience} / ${nextLevelExperience} EXP`}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-orange-400 transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-blue-100">
              {!session
                ? "等待后端返回账户信息"
                : nextLevelExperience === null
                  ? "已达到当前最高等级"
                  : `再获得 ${Math.max(0, nextLevelExperience - experience)} EXP 升级`}
            </p>
          </div>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-5">
          {status === "error" ? (
            <p className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-600">
              后端连接失败：{error}
            </p>
          ) : null}
          {session?.user.identityType === "guest" ? (
            <button
              className="mb-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
              onClick={() => {
                window.location.assign(
                  getZhihuAuthorizeUrl(`${window.location.pathname}${window.location.search}`),
                );
              }}
              type="button"
            >
              登录知乎以创建房间和上麦
            </button>
          ) : null}
          <p className="mb-3 text-sm font-medium text-slate-700">成长路线 · 六大等级</p>
          <div className="space-y-2">
            {levels.map((item) => (
              <div
                className={`flex items-center gap-3 rounded-2xl border p-3 ${
                  item.level === session?.account.level
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-100 bg-slate-50"
                }`}
                key={item.level}
              >
                <span
                  className={`grid size-9 place-items-center rounded-full font-semibold ${
                    item.level > (session?.account.level ?? 0)
                      ? "bg-slate-200 text-slate-400"
                      : "bg-blue-600 text-white"
                  }`}
                >
                  {item.level}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{item.title}</p>
                  <p className="text-xs text-slate-400">{item.range}</p>
                </div>
                <span className="text-xs font-medium text-slate-400">
                  {item.level < (session?.account.level ?? 0)
                    ? "已达成"
                    : item.level === session?.account.level
                      ? "当前"
                      : "未解锁"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
