import type { components } from "@zhiliao/shared/openapi";

export type ChatMessage = components["schemas"]["ChatMessage"];
export type ChatMessagePage = components["schemas"]["ChatMessagePage"];

export interface ListChatMessagesOptions {
  cursor?: string;
  limit: number;
}

export interface ChatStore {
  append(roomId: string, message: ChatMessage): void;
  list(roomId: string, options: ListChatMessagesOptions): ChatMessagePage;
}
