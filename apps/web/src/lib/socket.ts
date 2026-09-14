import type { ClientToServerEvents, ServerToClientEvents } from "@zhiliao/shared";
import { io, type Socket } from "socket.io-client";

import { runtimeConfig } from "./runtime-config";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createAppSocket(): AppSocket {
  return io("/", {
    path: runtimeConfig.socketPath,
    withCredentials: true,
    autoConnect: false,
    ...(runtimeConfig.socketTransport === "polling"
      ? { transports: ["polling"] as ["polling"] }
      : {}),
  });
}
