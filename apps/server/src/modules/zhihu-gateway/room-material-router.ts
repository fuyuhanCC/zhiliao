import { Router } from "express";
import { z } from "zod";

import { sendApiError } from "../../http/api-error.js";
import type { RoomStore } from "../../stores/room-store.js";
import type { RoomMaterialService } from "./room-material-service.js";

const roomParamsSchema = z.object({
  roomId: z.string().min(1),
});

const materialQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(10).default(5),
  })
  .strict();

export interface RoomMaterialRouterOptions {
  roomStore: RoomStore;
  materialService: RoomMaterialService | null | undefined;
}

export function createRoomMaterialRouter(options: RoomMaterialRouterOptions): Router {
  const router = Router();

  router.get("/rooms/:roomId/materials", async (request, response) => {
    const parsedParams = roomParamsSchema.safeParse(request.params);
    const parsedQuery = materialQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        params: parsedParams.success ? [] : parsedParams.error.issues,
        query: parsedQuery.success ? [] : parsedQuery.error.issues,
      });
      return;
    }

    const { roomId } = parsedParams.data;
    const snapshot = options.roomStore.get(roomId);
    if (!snapshot || snapshot.room.status === "closed") {
      sendApiError(response, 404, "ROOM_NOT_FOUND", "房间不存在或已回收");
      return;
    }

    if (!options.materialService) {
      sendApiError(response, 502, "ZHIHU_API_UNAVAILABLE", "知乎内容接口尚未配置");
      return;
    }

    try {
      response.json(
        await options.materialService.list(roomId, snapshot.room.topic, parsedQuery.data.limit),
      );
    } catch {
      sendApiError(response, 502, "ZHIHU_API_UNAVAILABLE", "知乎内容接口暂时不可用");
    }
  });

  return router;
}
