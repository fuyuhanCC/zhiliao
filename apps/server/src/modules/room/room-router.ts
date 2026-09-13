import { Router } from "express";
import { z } from "zod";

import { RoomService } from "../../domain/room/room-service.js";
import { sendApiError } from "../../http/api-error.js";
import type { RoomStore } from "../../stores/room-store.js";
import { readSession } from "../auth/session.js";
import type { SessionStore } from "../../stores/session-store.js";

const roomParamsSchema = z.object({
  roomId: z.string().min(1),
});

const listRoomsQuerySchema = z
  .object({
    type: z.enum(["hot", "custom"]).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const getRoomQuerySchema = z
  .object({
    inviteCode: z.string().min(6).max(100).optional(),
  })
  .strict();

const zhihuQuestionUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.hostname === "zhihu.com" || url.hostname.endsWith(".zhihu.com")) &&
    /\/question\/\d+/.test(url.pathname)
  );
}, "必须是知乎问题链接");

const createRoomBodySchema = z
  .object({
    visibility: z.enum(["public", "invite"]),
    topic: z.discriminatedUnion("source", [
      z
        .object({
          source: z.literal("manual"),
          title: z.string().trim().min(1).max(30),
        })
        .strict(),
      z
        .object({
          source: z.literal("zhihu_question"),
          questionUrl: zhihuQuestionUrlSchema,
          title: z.string().trim().min(1).max(200),
        })
        .strict(),
    ]),
  })
  .strict();

const idempotencyKeySchema = z.string().min(8).max(100);

export interface RoomRouterOptions {
  sessionStore: SessionStore;
  roomStore: RoomStore;
  webOrigin: string;
  roomService?: RoomService;
}

export function createRoomRouter(options: RoomRouterOptions): Router {
  const router = Router();
  const roomService =
    options.roomService ??
    new RoomService({
      roomStore: options.roomStore,
      webOrigin: options.webOrigin,
    });

  router.get("/rooms", (request, response) => {
    const parsedQuery = listRoomsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        issues: parsedQuery.error.issues,
      });
      return;
    }

    response.json(
      options.roomStore.list({
        limit: parsedQuery.data.limit,
        ...(parsedQuery.data.type ? { type: parsedQuery.data.type } : {}),
        ...(parsedQuery.data.cursor ? { cursor: parsedQuery.data.cursor } : {}),
      }),
    );
  });

  router.post("/rooms", (request, response) => {
    const session = readSession(request, options.sessionStore);
    if (!session) {
      sendApiError(response, 401, "AUTH_REQUIRED", "缺少或失效会话");
      return;
    }

    if (session.user.identityType !== "zhihu") {
      sendApiError(response, 403, "ZHIHU_LOGIN_REQUIRED", "需要登录知乎后才能创建房间");
      return;
    }

    const parsedBody = createRoomBodySchema.safeParse(request.body);
    const parsedIdempotencyKey = idempotencyKeySchema.safeParse(request.header("Idempotency-Key"));
    if (!parsedBody.success || !parsedIdempotencyKey.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        body: parsedBody.success ? [] : parsedBody.error.issues,
        idempotencyKey: parsedIdempotencyKey.success ? [] : parsedIdempotencyKey.error.issues,
      });
      return;
    }

    const result = roomService.create({
      user: session.user,
      request: parsedBody.data,
      idempotencyKey: parsedIdempotencyKey.data,
    });
    response.status(201).json(result);
  });

  router.get("/rooms/:roomId", (request, response) => {
    const parsedParams = roomParamsSchema.safeParse(request.params);
    const parsedQuery = getRoomQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        params: parsedParams.success ? [] : parsedParams.error.issues,
        query: parsedQuery.success ? [] : parsedQuery.error.issues,
      });
      return;
    }

    const room = options.roomStore.get(parsedParams.data.roomId);
    if (!room || room.room.status === "closed") {
      sendApiError(response, 404, "ROOM_NOT_FOUND", "房间不存在或已回收");
      return;
    }

    if (!options.roomStore.canAccess(parsedParams.data.roomId, parsedQuery.data.inviteCode)) {
      const errorCode = parsedQuery.data.inviteCode ? "INVALID_INVITE_CODE" : "INVITE_REQUIRED";
      sendApiError(response, 403, errorCode, "无权进入该房间");
      return;
    }

    response.json(room);
  });

  return router;
}
