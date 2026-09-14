import "./config/load-root-env.js";

import { createServer } from "node:http";

import {
  SOCKET_IO_PATH,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@zhiliao/shared";
import { Server } from "socket.io";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { createAppDependencies } from "./dependencies.js";
import { logger } from "./lib/logger.js";
import { registerRealtimeGateway } from "./realtime/realtime-gateway.js";

const dependencies = createAppDependencies();
const app = createApp(dependencies);
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  path: SOCKET_IO_PATH,
  cors: {
    origin: env.webOrigin,
    credentials: true,
  },
});
const realtimeGateway = registerRealtimeGateway(io, {
  sessionStore: dependencies.sessionStore,
  accountStore: dependencies.accountStore,
  roomStore: dependencies.roomStore,
  chatStore: dependencies.chatStore,
  speechTurnStore: dependencies.speechTurnStore,
  ...(dependencies.roomEventBus ? { roomEventBus: dependencies.roomEventBus } : {}),
  sessionSecret: dependencies.sessionSecret,
  disconnectGraceMilliseconds: env.realtimeDisconnectGraceMilliseconds,
  roomEmptyReclaimMilliseconds: env.roomEmptyReclaimMilliseconds,
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
  realtimeGateway.close();
  io.close(() => {
    logger.info("服务已关闭");
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
