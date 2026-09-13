import type { components } from "@zhiliao/shared/openapi";

export type SummaryResource = components["schemas"]["SummaryResource"];

export interface SummaryStore {
  get(roomId: string): SummaryResource | undefined;
  save(roomId: string, summary: SummaryResource): void;
}
