import path from "node:path";

import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { sendApiError } from "../../http/api-error.js";
import type { SessionStore } from "../../stores/session-store.js";
import { readSession } from "../auth/session.js";
import type { TencentFlashAudioFormat } from "./tencent-flash-asr-client.js";
import { TranscriptRequestError, type TranscriptService } from "./transcript-service.js";

const maximumAudioBytes = 20 * 1024 * 1024;
const durationSchema = z.coerce.number().int().min(1).max(120_000);
const idempotencyKeySchema = z.string().min(1).max(200);
const uploadOptions = {
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumAudioBytes, files: 1, fields: 1 },
};
const upload = multer(uploadOptions);

export interface TranscriptRouterOptions {
  sessionStore: SessionStore;
  service: TranscriptService | null;
}

function audioFormat(file: Express.Multer.File): TencentFlashAudioFormat | undefined {
  const mimeType = file.mimetype.toLowerCase().split(";", 1)[0];
  const extension = path.extname(file.originalname).toLowerCase();
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav" || extension === ".wav") {
    return "wav";
  }
  if (mimeType === "audio/mpeg" || mimeType === "audio/mp3" || extension === ".mp3") {
    return "mp3";
  }
  if (
    mimeType === "audio/mp4" ||
    mimeType === "audio/x-m4a" ||
    extension === ".m4a" ||
    extension === ".mp4"
  ) {
    return "m4a";
  }
  if (mimeType === "audio/ogg" || extension === ".ogg" || extension === ".opus") {
    return "ogg-opus";
  }
  if (mimeType === "audio/aac" || extension === ".aac") {
    return "aac";
  }
  if (mimeType === "audio/amr" || extension === ".amr") {
    return "amr";
  }
  return undefined;
}

export function createTranscriptRouter(options: TranscriptRouterOptions): Router {
  const router = Router();

  router.post("/rooms/:roomId/speech-turns/:speechTurnId/audio", (request, response) => {
    const session = readSession(request, options.sessionStore);
    if (!session) {
      sendApiError(response, 401, "AUTH_REQUIRED", "缺少或失效会话");
      return;
    }
    if (session.user.identityType !== "zhihu") {
      sendApiError(response, 403, "ZHIHU_LOGIN_REQUIRED", "需要登录知乎后才能上传发言音频");
      return;
    }
    if (!options.service) {
      sendApiError(response, 502, "ASR_UNAVAILABLE", "语音转写服务尚未配置");
      return;
    }

    upload.single("audio")(request, response, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          sendApiError(response, 413, "AUDIO_TOO_LARGE", "音频不能超过 20 MiB");
          return;
        }
        sendApiError(response, 400, "VALIDATION_ERROR", "音频表单不合法");
        return;
      }
      if (error) {
        sendApiError(response, 400, "VALIDATION_ERROR", "无法读取上传音频");
        return;
      }

      const duration = durationSchema.safeParse(request.body.durationMs);
      const idempotencyKey = idempotencyKeySchema.safeParse(request.header("Idempotency-Key"));
      const file = request.file;
      if (!duration.success || !idempotencyKey.success || !file || file.size === 0) {
        sendApiError(
          response,
          400,
          "VALIDATION_ERROR",
          "必须提供有效的 audio、durationMs 和 Idempotency-Key",
        );
        return;
      }
      const format = audioFormat(file);
      if (!format) {
        sendApiError(
          response,
          400,
          "UNSUPPORTED_AUDIO_FORMAT",
          "音频格式必须为 wav、mp3、m4a、ogg-opus、aac 或 amr",
        );
        return;
      }

      try {
        const result = options.service!.start({
          roomId: request.params.roomId,
          speechTurnId: request.params.speechTurnId,
          userId: session.user.userId,
          idempotencyKey: idempotencyKey.data,
          audio: file.buffer,
          format,
        });
        response.status(202).json(result);
      } catch (startError) {
        if (startError instanceof TranscriptRequestError) {
          sendApiError(response, startError.status, startError.code, startError.message);
          return;
        }
        throw startError;
      }
    });
  });

  return router;
}
