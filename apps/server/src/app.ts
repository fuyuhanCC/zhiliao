import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { APP_VERSION } from "@zhiliao/shared";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";

const publicDirectory = path.resolve(import.meta.dirname, "../public");
const webEntryFile = path.join(publicDirectory, "index.html");

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

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

  app.use("/api", (_request, response) => {
    response.status(404).json({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "接口不存在",
        details: {},
        requestId: response.locals.requestId,
      },
    });
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
