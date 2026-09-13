import { Router } from "express";
import { z } from "zod";

import { sendApiError } from "../../http/api-error.js";
import { readSession } from "../auth/session.js";
import type { RoomStore } from "../../stores/room-store.js";
import type { SessionStore } from "../../stores/session-store.js";
import type { RtcCredentialService } from "./rtc-credential-service.js";

const paramsSchema = z.object({
  roomId: z.string().min(1),
});

const bodySchema = z
  .object({
    inviteCode: z.string().min(6).max(100).optional(),
  })
  .strict();

const idempotencyKeySchema = z.string().min(8).max(100);

export interface RtcCredentialRouterOptions {
  sessionStore: SessionStore;
  roomStore: RoomStore;
  credentialService: RtcCredentialService | null;
}

export function createRtcCredentialRouter(options: RtcCredentialRouterOptions): Router {
  const router = Router();

  router.post("/rooms/:roomId/rtc-credentials", (request, response) => {
    const session = readSession(request, options.sessionStore);
    if (!session) {
      sendApiError(response, 401, "AUTH_REQUIRED", "缺少或失效会话");
      return;
    }

    const parsedParams = paramsSchema.safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body ?? {});
    const parsedIdempotencyKey = idempotencyKeySchema.safeParse(request.header("Idempotency-Key"));

    if (!parsedParams.success || !parsedBody.success || !parsedIdempotencyKey.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        params: parsedParams.success ? [] : parsedParams.error.issues,
        body: parsedBody.success ? [] : parsedBody.error.issues,
        idempotencyKey: parsedIdempotencyKey.success ? [] : parsedIdempotencyKey.error.issues,
      });
      return;
    }

    const room = options.roomStore.get(parsedParams.data.roomId);
    if (!room || room.room.status === "closed") {
      sendApiError(response, 404, "ROOM_NOT_FOUND", "房间不存在或已回收");
      return;
    }

    if (!options.roomStore.canAccess(parsedParams.data.roomId, parsedBody.data.inviteCode)) {
      const errorCode = parsedBody.data.inviteCode ? "INVALID_INVITE_CODE" : "INVITE_REQUIRED";
      sendApiError(response, 403, errorCode, "无权进入该房间");
      return;
    }

    if (!options.credentialService) {
      sendApiError(response, 502, "TRTC_UNAVAILABLE", "TRTC 服务尚未配置");
      return;
    }

    let credentials;
    try {
      credentials = options.credentialService.create({
        roomId: parsedParams.data.roomId,
        user: session.user,
        isSeated: options.roomStore.isSeated(parsedParams.data.roomId, session.user.userId),
        idempotencyKey: parsedIdempotencyKey.data,
      });
    } catch {
      sendApiError(response, 502, "TRTC_UNAVAILABLE", "TRTC 凭证签发失败");
      return;
    }

    response.json(credentials);
  });

  return router;
}
