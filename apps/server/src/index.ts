import "dotenv/config";

import { createServer } from "node:http";

import { Server } from "socket.io";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const app = createApp();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  path: "/socket.io",
  cors: {
    origin: env.webOrigin,
    credentials: true,
  },
});

httpServer.listen(env.port, "0.0.0.0", () => {
  logger.info({ port: env.port }, "知了服务已启动");
});

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, "正在关闭服务");
  io.close(() => {
    logger.info("服务已关闭");
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
