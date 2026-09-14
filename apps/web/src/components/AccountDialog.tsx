interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
}

const levels = [
  { level: 1, name: "蛰伏", range: "0–100 EXP", status: "done" },
  { level: 2, name: "破土", range: "100–200 EXP", status: "done" },
  { level: 3, name: "蜕壳", range: "200–500 EXP", status: "current" },
  { level: 4, name: "振翅", range: "500–1000 EXP", status: "locked" },
  { level: 5, name: "鸣夏", range: "1000–2000 EXP", status: "locked" },
  { level: 6, name: "知秋", range: "2000+ EXP", status: "locked" },
] as const;

export function AccountDialog({ open, onClose }: AccountDialogProps) {
  if (!open) {
    return null;
  }

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
                余
              </span>
              <div>
                <h2 className="font-semibold" id="account-title">
                  余蜕壳
                </h2>
                <p className="mt-1 text-sm text-blue-100">知豆余额 · 100</p>
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
              <span>Lv.3 蜕壳</span>
              <span>320 / 500 EXP</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
              <div className="h-full w-3/5 rounded-full bg-orange-400" />
            </div>
            <p className="mt-2 text-xs text-blue-100">再获得 180 EXP 解锁「振翅」</p>
          </div>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-5">
          <p className="mb-3 text-sm font-medium text-slate-700">成长路线 · 六大等级</p>
          <div className="space-y-2">
            {levels.map((item) => (
              <div
                className={`flex items-center gap-3 rounded-2xl border p-3 ${
                  item.status === "current"
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-100 bg-slate-50"
                }`}
                key={item.level}
              >
                <span
                  className={`grid size-9 place-items-center rounded-full font-semibold ${
                    item.status === "locked"
                      ? "bg-slate-200 text-slate-400"
                      : "bg-blue-600 text-white"
                  }`}
                >
                  {item.level}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{item.name}</p>
                  <p className="text-xs text-slate-400">{item.range}</p>
                </div>
                <span className="text-xs font-medium text-slate-400">
                  {item.status === "done"
                    ? "已达成"
                    : item.status === "current"
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
