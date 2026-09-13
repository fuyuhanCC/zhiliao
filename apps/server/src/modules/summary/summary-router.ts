import { Router } from "express";
import { z } from "zod";

import { sendApiError } from "../../http/api-error.js";
import type { RoomStore } from "../../stores/room-store.js";
import type { SessionStore } from "../../stores/session-store.js";
import { readSession } from "../auth/session.js";
import { SummaryRequestError, type SummaryService } from "./summary-service.js";

const generateBodySchema = z.object({ inviteCode: z.string().min(6).max(100).optional() }).strict();
const idempotencyKeySchema = z.string().min(1).max(200);

export interface SummaryRouterOptions {
  sessionStore: SessionStore;
  roomStore: RoomStore;
  service: SummaryService;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function checkRoomAccess(
  roomStore: RoomStore,
  roomId: string,
  inviteCode: string | undefined,
): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const snapshot = roomStore.get(roomId);
  if (!snapshot || snapshot.room.status === "closed") {
    return { ok: false, status: 404, code: "ROOM_NOT_FOUND", message: "房间不存在或已回收" };
  }
  if (!roomStore.canAccess(roomId, inviteCode)) {
    return {
      ok: false,
      status: 403,
      code: inviteCode ? "INVALID_INVITE_CODE" : "INVITE_REQUIRED",
      message: "无权进入该房间",
    };
  }
  return { ok: true };
}

export function createSummaryRouter(options: SummaryRouterOptions): Router {
  const router = Router();

  router.get("/rooms/:roomId/summary", (request, response) => {
    const roomId = request.params.roomId;
    const inviteCode = readOptionalString(request.query.inviteCode);
    const access = checkRoomAccess(options.roomStore, roomId, inviteCode);
    if (!access.ok) {
      sendApiError(response, access.status, access.code, access.message);
      return;
    }
    response.json(options.service.get(roomId));
  });

  router.post("/rooms/:roomId/summary/generate", (request, response) => {
    const session = readSession(request, options.sessionStore);
    if (!session) {
      sendApiError(response, 401, "AUTH_REQUIRED", "缺少或失效会话");
      return;
    }
    const body = generateBodySchema.safeParse(request.body ?? {});
    const idempotencyKey = idempotencyKeySchema.safeParse(request.header("Idempotency-Key"));
    if (!body.success || !idempotencyKey.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求体或 Idempotency-Key 不合法");
      return;
    }
    const roomId = request.params.roomId;
    const access = checkRoomAccess(options.roomStore, roomId, body.data.inviteCode);
    if (!access.ok) {
      sendApiError(response, access.status, access.code, access.message);
      return;
    }

    try {
      const result = options.service.start(roomId);
      response.status(result.statusCode).json(result.resource);
    } catch (error) {
      if (error instanceof SummaryRequestError) {
        sendApiError(response, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
  });

  return router;
}
