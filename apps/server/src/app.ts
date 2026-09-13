import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { APP_VERSION } from "@zhiliao/shared";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { createAppDependencies, type AppDependencies } from "./dependencies.js";
import { sendApiError } from "./http/api-error.js";
import { createAuthRouter } from "./modules/auth/auth-router.js";
import { createRoomRouter } from "./modules/room/room-router.js";
import { createRoomHistoryRouter } from "./modules/room-history/room-history-router.js";
import { createRtcCredentialRouter } from "./modules/rtc-credential/rtc-credential-router.js";
import { createHotTopicRouter } from "./modules/zhihu-gateway/hot-topic-router.js";
import { createRoomMaterialRouter } from "./modules/zhihu-gateway/room-material-router.js";

const publicDirectory = path.resolve(import.meta.dirname, "../public");
const webEntryFile = path.join(publicDirectory, "index.html");

export function createApp(dependencies: AppDependencies = createAppDependencies()): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser(dependencies.sessionSecret));

  app.use((_request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    next();
  });

  app.get("/api/v1/health", (_request, response) => {
    response.json({
      status: "ok",
      version: APP_VERSION,
      serverTime: new Date().toISOString(),
    });
  });

  app.use(
    "/api/v1/auth",
    createAuthRouter({
      sessionStore: dependencies.sessionStore,
      accountStore: dependencies.accountStore,
      secureCookies: dependencies.secureCookies,
      zhihuOAuthService: dependencies.zhihuOAuthService,
    }),
  );
  app.use(
    "/api/v1",
    createRoomRouter({
      sessionStore: dependencies.sessionStore,
      roomStore: dependencies.roomStore,
      webOrigin: dependencies.webOrigin,
      ...(dependencies.hotTopicRoomService
        ? { hotTopicRoomService: dependencies.hotTopicRoomService }
        : {}),
    }),
  );
  if (dependencies.hotTopicRoomService) {
    app.use(
      "/api/v1",
      createHotTopicRouter({
        service: dependencies.hotTopicRoomService,
      }),
    );
  }
  app.use(
    "/api/v1",
    createRoomHistoryRouter({
      roomStore: dependencies.roomStore,
      chatStore: dependencies.chatStore,
      speechTurnStore: dependencies.speechTurnStore,
    }),
  );
  app.use(
    "/api/v1",
    createRoomMaterialRouter({
      roomStore: dependencies.roomStore,
      materialService: dependencies.roomMaterialService,
    }),
  );
  app.use(
    "/api/v1",
    createRtcCredentialRouter({
      sessionStore: dependencies.sessionStore,
      roomStore: dependencies.roomStore,
      credentialService: dependencies.rtcCredentialService,
    }),
  );

  app.use("/api", (_request, response) => {
    sendApiError(response, 404, "ROUTE_NOT_FOUND", "接口不存在");
  });

  if (existsSync(webEntryFile)) {
    app.use(express.static(publicDirectory));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/socket.io")) {
        next();
        return;
      }

      response.sendFile(webEntryFile);
    });
  }

  return app;
}
