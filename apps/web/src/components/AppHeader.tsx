import { Link } from "react-router-dom";

export type LobbyTab = "official" | "private";

interface AppHeaderProps {
  activeTab?: LobbyTab;
  onTabChange?: (tab: LobbyTab) => void;
  onAccountClick: () => void;
}

export function AppHeader({ activeTab, onTabChange, onAccountClick }: AppHeaderProps) {
  return (
    <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 lg:px-8">
        <Link className="flex items-center gap-3" to="/">
          <span className="grid size-9 place-items-center rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm shadow-blue-200">
            知
          </span>
          <span>
            <strong className="text-lg tracking-tight text-slate-950">知了</strong>
            <small className="ml-1.5 text-xs text-slate-400">ZhiLiao</small>
          </span>
        </Link>

        {activeTab && onTabChange ? (
          <nav className="rounded-xl bg-slate-100 p-1" aria-label="房间分类">
            {(["official", "private"] as const).map((tab) => (
              <button
                className={`rounded-lg px-5 py-2 text-sm font-medium transition ${
                  activeTab === tab
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                key={tab}
                onClick={() => onTabChange(tab)}
                type="button"
              >
                {tab === "official" ? "官方房" : "私人房"}
              </button>
            ))}
          </nav>
        ) : (
          <span className="hidden text-sm text-slate-400 sm:block">实时语音知识讨论</span>
        )}

        <button
          className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-slate-100"
          onClick={onAccountClick}
          type="button"
        >
          <span className="hidden sm:block">
            <span className="block text-xs text-slate-500">100 知豆</span>
            <span className="block text-xs font-medium text-blue-600">Lv.3 蜕壳</span>
          </span>
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 font-semibold text-white">
            余
          </span>
        </button>
      </div>
    </header>
  );
}
