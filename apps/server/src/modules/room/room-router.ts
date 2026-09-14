import { Router } from "express";
import { z } from "zod";

import { RoomService } from "../../domain/room/room-service.js";
import { sendApiError } from "../../http/api-error.js";
import type { RoomStore } from "../../stores/room-store.js";
import { readSession } from "../auth/session.js";
import type { SessionStore } from "../../stores/session-store.js";
import type { HotTopicRoomService } from "../zhihu-gateway/hot-topic-room-service.js";

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

const createRoomBodySchema = z
  .object({
    topic: z
      .object({
        source: z.literal("manual"),
        title: z.string().trim().min(1).max(30),
      })
      .strict(),
  })
  .strict();

const idempotencyKeySchema = z.string().min(8).max(100);

export interface RoomRouterOptions {
  sessionStore: SessionStore;
  roomStore: RoomStore;
  webOrigin: string;
  hotTopicRoomService?: HotTopicRoomService;
  roomService?: RoomService;
}

export function createRoomRouter(options: RoomRouterOptions): Router {
  const router = Router();
  const roomService =
    options.roomService ??
    new RoomService({
      roomStore: options.roomStore,
    });

  router.get("/rooms", async (request, response) => {
    const parsedQuery = listRoomsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        issues: parsedQuery.error.issues,
      });
      return;
    }

    if (
      options.hotTopicRoomService &&
      (parsedQuery.data.type === undefined || parsedQuery.data.type === "hot")
    ) {
      try {
        await options.hotTopicRoomService.ensureRooms();
      } catch {
        // The lobby remains usable with the last synchronized rooms if an upstream refresh fails.
      }
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
    if (!parsedParams.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        params: parsedParams.success ? [] : parsedParams.error.issues,
      });
      return;
    }

    const room = options.roomStore.get(parsedParams.data.roomId);
    if (!room || room.room.status === "closed") {
      sendApiError(response, 404, "ROOM_NOT_FOUND", "房间不存在或已回收");
      return;
    }

    response.json(room);
  });

  return router;
}
