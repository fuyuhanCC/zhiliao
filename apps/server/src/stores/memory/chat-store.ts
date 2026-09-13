import type {
  ChatMessage,
  ChatMessagePage,
  ChatStore,
  ListChatMessagesOptions,
} from "../chat-store.js";

export class MemoryChatStore implements ChatStore {
  private readonly messagesByRoom = new Map<string, ChatMessage[]>();

  append(roomId: string, message: ChatMessage): void {
    const messages = this.messagesByRoom.get(roomId) ?? [];
    messages.push(structuredClone(message));
    this.messagesByRoom.set(roomId, messages);
  }

  list(roomId: string, options: ListChatMessagesOptions): ChatMessagePage {
    const messages = this.messagesByRoom.get(roomId) ?? [];
    const cursorIndex = options.cursor
      ? messages.findIndex((message) => message.messageId === options.cursor)
      : messages.length;
    const endIndex = cursorIndex >= 0 ? cursorIndex : messages.length;
    const startIndex = Math.max(0, endIndex - options.limit);
    const items = messages.slice(startIndex, endIndex);

    return {
      items: structuredClone(items),
      nextCursor: startIndex > 0 ? (items[0]?.messageId ?? null) : null,
    };
  }
}
