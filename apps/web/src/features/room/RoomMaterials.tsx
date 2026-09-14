import type { RoomMaterial } from "../../lib/api-client";

interface RoomMaterialsProps {
  error: string | null;
  items: RoomMaterial[];
  loading: boolean;
  open: boolean;
  onRetry: () => void;
  onToggle: () => void;
}

const compactNumber = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function materialTypeLabel(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("answer")) return "知乎回答";
  if (normalized.includes("article")) return "知乎文章";
  if (normalized.includes("question")) return "知乎问题";
  return "知乎内容";
}

function materialMeta(material: RoomMaterial): string {
  const parts = [materialTypeLabel(material.contentType)];
  if (material.authorName) parts.push(material.authorName);
  if (material.voteUpCount !== null)
    parts.push(`${compactNumber.format(material.voteUpCount)} 赞同`);
  if (material.commentCount !== null)
    parts.push(`${compactNumber.format(material.commentCount)} 评论`);
  return parts.join(" · ");
}

export function RoomMaterials({
  error,
  items,
  loading,
  open,
  onRetry,
  onToggle,
}: RoomMaterialsProps) {
  const statusLabel = loading ? "加载中" : error ? "暂不可用" : `${items.length} 篇`;

  return (
    <section className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between p-4 text-left"
        onClick={onToggle}
        type="button"
      >
        <span className="font-medium text-slate-700">知乎精选背景资料</span>
        <span className="text-sm text-slate-400">
          {statusLabel} · {open ? "收起" : "展开"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 p-4">
          {loading ? <p className="text-sm text-slate-500">正在查询与话题相关的知乎内容…</p> : null}
          {error ? (
            <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-600">
              <p>{error}</p>
              <button
                className="mt-2 font-semibold hover:underline"
                onClick={onRetry}
                type="button"
              >
                重新加载
              </button>
            </div>
          ) : null}
          {!loading && !error && items.length === 0 ? (
            <p className="text-sm text-slate-500">暂未找到相关知乎资料。</p>
          ) : null}
          {items.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-3">
              {items.map((material, index) => (
                <a
                  className="rounded-2xl bg-slate-50 p-4 transition hover:bg-blue-50"
                  href={material.zhihuUrl}
                  key={material.materialId}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span className="text-xs font-semibold text-blue-600">资料 {index + 1}</span>
                  <h2 className="mt-2 text-sm font-medium leading-6 text-slate-800">
                    {material.title}
                  </h2>
                  {material.excerpt ? (
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">
                      {material.excerpt}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs text-slate-400">{materialMeta(material)}</p>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
