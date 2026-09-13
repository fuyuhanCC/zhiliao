import type { components } from "@zhiliao/shared/openapi";

export type SpeechTurn = components["schemas"]["SpeechTurn"];
export type SpeechTurnPage = components["schemas"]["SpeechTurnPage"];

export interface ListSpeechTurnsOptions {
  cursor?: string;
  limit: number;
}

export interface SpeechTurnStore {
  create(roomId: string, speechTurn: SpeechTurn): void;
  get(roomId: string, speechTurnId: string): SpeechTurn | undefined;
  update(roomId: string, speechTurn: SpeechTurn): boolean;
  list(roomId: string, options: ListSpeechTurnsOptions): SpeechTurnPage;
}
