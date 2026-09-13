import type { SummaryResource, SummaryStore } from "../summary-store.js";

export class MemorySummaryStore implements SummaryStore {
  private readonly summaries = new Map<string, SummaryResource>();

  get(roomId: string): SummaryResource | undefined {
    const summary = this.summaries.get(roomId);
    return summary ? structuredClone(summary) : undefined;
  }

  save(roomId: string, summary: SummaryResource): void {
    this.summaries.set(roomId, structuredClone(summary));
  }
}
