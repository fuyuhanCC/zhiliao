import { Router } from "express";

import { sendApiError } from "../../http/api-error.js";
import type { ChatStore } from "../../stores/chat-store.js";
import type { RoomStore } from "../../stores/room-store.js";
import type { SpeechTurnStore } from "../../stores/speech-turn-store.js";

export interface RoomHistoryRouterOptions {
  roomStore: RoomStore;
  chatStore: ChatStore;
  speechTurnStore: SpeechTurnStore;
}

function readOptionalQueryValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readLimit(value: unknown, defaultValue: number, maximum: number): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return defaultValue;
  }
  return Math.min(maximum, Math.max(1, Number(value)));
}

function canReadRoom(
  options: RoomHistoryRouterOptions,
  roomId: string,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const snapshot = options.roomStore.get(roomId);
  if (!snapshot || snapshot.room.status === "closed") {
    return {
      ok: false,
      status: 404,
      code: "ROOM_NOT_FOUND",
      message: "房间不存在或已回收",
    };
  }
  return { ok: true };
}

export function createRoomHistoryRouter(options: RoomHistoryRouterOptions): Router {
  const router = Router();

  router.get("/rooms/:roomId/messages", (request, response) => {
    const roomId = request.params.roomId;
    const access = canReadRoom(options, roomId);
    if (!access.ok) {
      sendApiError(response, access.status, access.code, access.message);
      return;
    }

    const cursor = readOptionalQueryValue(request.query.cursor);
    response.json(
      options.chatStore.list(roomId, {
        limit: readLimit(request.query.limit, 30, 50),
        ...(cursor ? { cursor } : {}),
      }),
    );
  });

  router.get("/rooms/:roomId/speech-turns", (request, response) => {
    const roomId = request.params.roomId;
    const access = canReadRoom(options, roomId);
    if (!access.ok) {
      sendApiError(response, access.status, access.code, access.message);
      return;
    }

    const cursor = readOptionalQueryValue(request.query.cursor);
    response.json(
      options.speechTurnStore.list(roomId, {
        limit: readLimit(request.query.limit, 50, 100),
        ...(cursor ? { cursor } : {}),
      }),
    );
  });

  return router;
}
