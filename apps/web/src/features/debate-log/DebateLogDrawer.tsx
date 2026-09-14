import type { SpeechTurn, SummaryResource } from "../../lib/api-client";

interface DebateLogDrawerProps {
  speechTurns: SpeechTurn[];
  speechTurnsLoading: boolean;
  speechTurnsError: string | null;
  summary: SummaryResource | null;
  summaryError: string | null;
  retryableSpeechTurnIds: ReadonlySet<string>;
  onClose: () => void;
  onRetryTranscript: (speechTurnId: string) => void;
  onRetrySummary: () => void;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function transcriptText(turn: SpeechTurn): string {
  if (!turn.endedAt) {
    return "正在发言，结束后将生成语音转写。";
  }
  if (!turn.transcript || turn.transcript.status === "pending") {
    return "等待上传本次发言录音。";
  }
  if (turn.transcript.status === "processing") {
    return "语音正在转写中…";
  }
  if (turn.transcript.status === "failed") {
    return "本次发言转写失败。";
  }
  return turn.transcript.text?.trim() || "本次发言没有识别出文字。";
}

function SummaryContent({ summary }: { summary: SummaryResource | null }) {
  if (!summary || summary.status === "empty") {
    return (
      <section className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
        暂无可总结的转写内容。
      </section>
    );
  }

  if (summary.status === "pending" || summary.status === "processing") {
    return (
      <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
        AI 正在梳理本场讨论，请稍候…
      </section>
    );
  }

  if (summary.status === "failed" || !summary.summary) {
    return (
      <section className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-600">
        本场总结暂时生成失败。
      </section>
    );
  }

  const content = summary.summary;
  return (
    <section className="space-y-4 rounded-2xl border border-orange-100 bg-orange-50 p-4">
      <div>
        <h3 className="font-semibold text-orange-700">AI 总结</h3>
        <p className="mt-2 text-sm leading-7 text-orange-800/80">{content.overview}</p>
      </div>
      {content.viewpoints.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-orange-700">主要观点</h4>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-orange-800/80">
            {content.viewpoints.map((viewpoint) => (
              <li key={viewpoint.speaker.userId}>
                <strong>{viewpoint.speaker.displayName}：</strong>
                {viewpoint.summary}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {content.agreements.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-orange-700">共识</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-orange-800/80">
            {content.agreements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {content.disagreements.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-orange-700">分歧</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-orange-800/80">
            {content.disagreements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {content.openQuestions.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-orange-700">待讨论</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-orange-800/80">
            {content.openQuestions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function DebateLogDrawer({
  speechTurns,
  speechTurnsLoading,
  speechTurnsError,
  summary,
  summaryError,
  retryableSpeechTurnIds,
  onClose,
  onRetryTranscript,
  onRetrySummary,
}: DebateLogDrawerProps) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-2xl lg:top-0">
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 p-5 backdrop-blur">
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
          发言结束后会在这里展示语音转写，并根据有效转写整理讨论要点。
        </p>
      </div>
      <div className="space-y-5 p-5">
        {speechTurnsLoading ? (
          <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">正在读取发言记录…</p>
        ) : null}
        {speechTurnsError ? (
          <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-600">
            发言记录加载失败：{speechTurnsError}
          </p>
        ) : null}
        {!speechTurnsLoading && !speechTurnsError && speechTurns.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">
            还没有人完成发言。
          </p>
        ) : null}
        {speechTurns.map((turn, index) => (
          <article className="relative pl-10" key={turn.speechTurnId}>
            <span className="absolute left-0 grid size-7 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
              {index + 1}
            </span>
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold text-slate-800">{turn.speaker.displayName}</h3>
              <time className="text-xs text-slate-400">{formatTime(turn.startedAt)}</time>
              <span className="ml-auto text-xs text-slate-400">{turn.likeCount} 赞同</span>
            </div>
            <p className="mt-2 rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">
              {transcriptText(turn)}
            </p>
            {retryableSpeechTurnIds.has(turn.speechTurnId) ? (
              <button
                className="mt-2 text-xs font-semibold text-blue-600 hover:underline"
                onClick={() => onRetryTranscript(turn.speechTurnId)}
                type="button"
              >
                {turn.transcript?.status === "failed" ? "重新转写本次发言" : "重新上传本次录音"}
              </button>
            ) : null}
          </article>
        ))}

        {summaryError ? (
          <section className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-600">
            <p>AI 总结暂时不可用：{summaryError}</p>
            <button
              className="mt-2 font-semibold hover:underline"
              onClick={onRetrySummary}
              type="button"
            >
              重试
            </button>
          </section>
        ) : (
          <SummaryContent summary={summary} />
        )}

        <section className="flex items-end justify-center gap-3 pt-2">
          <img
            alt="AI 刘看山"
            className="h-32 w-32 shrink-0 object-contain"
            src="/characters/liukanshan-log.gif"
          />
          <p className="mb-5 max-w-40 rounded-2xl rounded-bl-sm bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-700">
            我会把本场发言整理成清晰的辩论日志。
          </p>
        </section>
      </div>
    </aside>
  );
}
