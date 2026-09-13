import { APP_VERSION, PRODUCT_NAME } from "@zhiliao/shared";

export function HomePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-6 text-slate-100">
      <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-sky-950/40 backdrop-blur">
        <p className="text-sm font-medium tracking-[0.2em] text-sky-300">
          ZHILIAO · v{APP_VERSION}
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{PRODUCT_NAME}</h1>
        <p className="mt-4 leading-7 text-slate-300">
          前后端工程骨架已经就绪。产品页面将依据 PRD 与接口契约在这里逐步实现。
        </p>
        <a
          className="mt-8 inline-flex rounded-full bg-sky-400 px-5 py-2.5 font-medium text-slate-950 transition hover:bg-sky-300"
          href="/api/v1/health"
        >
          查看服务健康状态
        </a>
      </section>
    </main>
  );
}
