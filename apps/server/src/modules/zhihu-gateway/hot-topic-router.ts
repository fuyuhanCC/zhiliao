import { Router } from "express";
import { z } from "zod";

import { sendApiError } from "../../http/api-error.js";
import { HotTopicRoomService, InvalidHotTopicCursorError } from "./hot-topic-room-service.js";

const hotTopicQuerySchema = z
  .object({
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export interface HotTopicRouterOptions {
  service: HotTopicRoomService;
}

export function createHotTopicRouter(options: HotTopicRouterOptions): Router {
  const router = Router();

  router.get("/topics/hot", async (request, response) => {
    const parsedQuery = hotTopicQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      sendApiError(response, 400, "VALIDATION_ERROR", "请求参数不合法", {
        query: parsedQuery.error.issues,
      });
      return;
    }

    try {
      response.json(
        await options.service.list({
          limit: parsedQuery.data.limit,
          ...(parsedQuery.data.cursor ? { cursor: parsedQuery.data.cursor } : {}),
        }),
      );
    } catch (error) {
      if (error instanceof InvalidHotTopicCursorError) {
        sendApiError(response, 400, "VALIDATION_ERROR", "热榜游标无效");
        return;
      }
      sendApiError(response, 502, "ZHIHU_API_UNAVAILABLE", "知乎热榜暂时不可用");
    }
  });

  return router;
}
