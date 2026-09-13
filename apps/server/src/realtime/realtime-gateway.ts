import { randomUUID } from "node:crypto";

import type {
  AckCallback,
  ClientToServerEvents,
  CommandAck,
  CommandError,
  RoomEvent,
  RoomJoinCommand,
  RoomResyncCommand,
  ServerToClientEvents,
} from "@zhiliao/shared";
import cookieParser from "cookie-parser";
import type { Server, Socket } from "socket.io";
import { z } from "zod";

import {
  RealtimeRoomService,
  type RealtimeCommandResult,
  type RealtimeStateEvent,
  type RoomParticipant,
} from "../domain/room/realtime-room-service.js";
import { SESSION_COOKIE_NAME } from "../modules/auth/session.js";
import type { ChatStore } from "../stores/chat-store.js";
import type { RoomStore, RoomSnapshot } from "../stores/room-store.js";
import type { SessionStore, UserSession } from "../stores/session-store.js";
import type { SpeechTurnStore } from "../stores/speech-turn-store.js";

interface InterServerEvents {}

interface SocketData {
  session: UserSession;
  roomId?: string;
}

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

interface CachedAck {
  expiresAt: number;
  ack: CommandAck<unknown>;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

export interface RealtimeGatewayOptions {
  sessionStore: SessionStore;
  roomStore: RoomStore;
  chatStore: ChatStore;
  speechTurnStore: SpeechTurnStore;
  sessionSecret: string;
  disconnectGraceMilliseconds?: number;
  speechLimitMilliseconds?: number;
  cooldownMilliseconds?: number;
  speakerTickMilliseconds?: number;
  now?: () => Date;
}

export interface RealtimeGateway {
  close(): void;
}

const requestIdSchema = z.string().min(1).max(100);
const roomIdSchema = z.string().min(1).max(200);
const roomCommandSchema = z
  .object({
    requestId: requestIdSchema,
    roomId: roomIdSchema,
  })
  .strict();
const roomJoinSchema = roomCommandSchema.extend({
  lastKnownVersion: z.number().int().nonnegative().nullable(),
  inviteCode: z.string().min(6).max(100).nullable(),
});
const roomResyncSchema = roomCommandSchema.extend({
  lastKnownVersion: z.number().int().nonnegative(),
});
const speakerReleaseSchema = roomCommandSchema.extend({
  speechTurnId: z.string().min(1).max(200),
  reason: z.literal("user_finished"),
});
const chatSendSchema = roomCommandSchema.extend({
  clientMessageId: z.string().min(1).max(200),
  content: z.string().trim().min(1).max(200),
});
const reactionLikeSchema = roomCommandSchema.extend({
  speechTurnId: z.string().min(1).max(200),
});

const rateLimits: Partial<
  Record<keyof ClientToServerEvents, { maximum: number; windowMilliseconds: number }>
> = {
  "chat:send": { maximum: 5, windowMilliseconds: 10_000 },
  "reaction:like": { maximum: 10, windowMilliseconds: 10_000 },
  "seat:request": { maximum: 3, windowMilliseconds: 10_000 },
  "speaker:acquire": { maximum: 3, windowMilliseconds: 5000 },
};

function parseCookieHeader(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader?.split(";") ?? []) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function readSessionFromHandshake(
  socket: RealtimeSocket,
  sessionStore: SessionStore,
  sessionSecret: string,
): UserSession | undefined {
  const signedValue = parseCookieHeader(socket.handshake.headers.cookie).get(SESSION_COOKIE_NAME);
  if (!signedValue) {
    return undefined;
  }
  const sessionId = cookieParser.signedCookie(signedValue, sessionSecret);
  return typeof sessionId === "string" ? sessionStore.get(sessionId) : undefined;
}

function authenticationError(): Error & { data?: CommandError } {
  const error = new Error("缺少或失效会话") as Error & { data?: CommandError };
  error.data = { code: "AUTH_REQUIRED", message: "缺少或失效会话" };
  return error;
}

function requestIdFrom(rawCommand: unknown): string {
  if (
    typeof rawCommand === "object" &&
    rawCommand !== null &&
    "requestId" in rawCommand &&
    typeof rawCommand.requestId === "string"
  ) {
    return rawCommand.requestId;
  }
  return "unknown";
}

function roomIdFrom(rawCommand: unknown): string | undefined {
  if (
    typeof rawCommand === "object" &&
    rawCommand !== null &&
    "roomId" in rawCommand &&
    typeof rawCommand.roomId === "string"
  ) {
    return rawCommand.roomId;
  }
  return undefined;
}

function callAck<T>(acknowledge: AckCallback<T> | undefined, ack: CommandAck<T>): void {
  if (typeof acknowledge === "function") {
    acknowledge(ack);
  }
}

export function registerRealtimeGateway(
  io: RealtimeServer,
  options: RealtimeGatewayOptions,
): RealtimeGateway {
  const now = options.now ?? (() => new Date());
  const activeSocketBySession = new Map<string, string>();
  const acknowledgements = new Map<string, CachedAck>();
  const rateWindows = new Map<string, RateWindow>();
  let isClosed = false;
  const service = new RealtimeRoomService({
    roomStore: options.roomStore,
    chatStore: options.chatStore,
    speechTurnStore: options.speechTurnStore,
    emit: emitStateEvent,
    now,
    ...(options.disconnectGraceMilliseconds === undefined
      ? {}
      : { disconnectGraceMilliseconds: options.disconnectGraceMilliseconds }),
    ...(options.speechLimitMilliseconds === undefined
      ? {}
      : { speechLimitMilliseconds: options.speechLimitMilliseconds }),
    ...(options.cooldownMilliseconds === undefined
      ? {}
      : { cooldownMilliseconds: options.cooldownMilliseconds }),
    ...(options.speakerTickMilliseconds === undefined
      ? {}
      : { speakerTickMilliseconds: options.speakerTickMilliseconds }),
  });

  function emitStateEvent(stateEvent: RealtimeStateEvent): void {
    const target = io.to(stateEvent.event.roomId);
    switch (stateEvent.name) {
      case "presence:updated":
        target.emit("presence:updated", stateEvent.event);
        break;
      case "seat:updated":
        target.emit("seat:updated", stateEvent.event);
        break;
      case "queue:updated":
        target.emit("queue:updated", stateEvent.event);
        break;
      case "speaker:changed":
        target.emit("speaker:changed", stateEvent.event);
        break;
      case "speaker:tick":
        target.emit("speaker:tick", stateEvent.event);
        break;
      case "cooldown:updated":
        target.emit("cooldown:updated", stateEvent.event);
        break;
      case "chat:created":
        target.emit("chat:created", stateEvent.event);
        break;
      case "reaction:created":
        target.emit("reaction:created", stateEvent.event);
        break;
      case "speech:closed":
        target.emit("speech:closed", stateEvent.event);
        break;
    }
  }

  function emitSnapshot(socket: RealtimeSocket, snapshot: RoomSnapshot): void {
    const serverTime = now().toISOString();
    const event: RoomEvent<RoomSnapshot> = {
      eventId: `evt_${randomUUID()}`,
      roomId: snapshot.room.roomId,
      roomVersion: snapshot.room.version,
      serverTime,
      data: structuredClone(snapshot),
    };
    socket.emit("room:snapshot", event);
  }

  function ackCacheKey(sessionId: string, eventName: string, requestId: string): string {
    return `${sessionId}:${eventName}:${requestId}`;
  }

  function getCachedAck<T>(key: string): CommandAck<T> | undefined {
    const cached = acknowledgements.get(key);
    if (!cached) {
      return undefined;
    }
    if (cached.expiresAt <= now().getTime()) {
      acknowledgements.delete(key);
      return undefined;
    }
    return structuredClone(cached.ack) as CommandAck<T>;
  }

  function cacheAck<T>(key: string, ack: CommandAck<T>): void {
    acknowledgements.set(key, {
      expiresAt: now().getTime() + 5 * 60 * 1000,
      ack: structuredClone(ack) as CommandAck<unknown>,
    });
    if (acknowledgements.size > 2000) {
      const oldestKey = acknowledgements.keys().next().value as string | undefined;
      if (oldestKey) {
        acknowledgements.delete(oldestKey);
      }
    }
  }

  function consumeRateLimit(sessionId: string, eventName: keyof ClientToServerEvents): boolean {
    const limit = rateLimits[eventName];
    if (!limit) {
      return true;
    }
    const key = `${sessionId}:${eventName}`;
    const currentTime = now().getTime();
    const currentWindow = rateWindows.get(key);
    if (!currentWindow || currentTime - currentWindow.startedAt >= limit.windowMilliseconds) {
      rateWindows.set(key, { startedAt: currentTime, count: 1 });
      if (rateWindows.size > 2000) {
        for (const [candidateKey, candidateWindow] of rateWindows) {
          if (currentTime - candidateWindow.startedAt >= 10_000) {
            rateWindows.delete(candidateKey);
          }
        }
        if (rateWindows.size > 2000) {
          const oldestKey = rateWindows.keys().next().value as string | undefined;
          if (oldestKey) {
            rateWindows.delete(oldestKey);
          }
        }
      }
      return true;
    }
    if (currentWindow.count >= limit.maximum) {
      return false;
    }
    currentWindow.count += 1;
    return true;
  }

  function makeAck<T>(requestId: string, result: RealtimeCommandResult<T>): CommandAck<T> {
    const serverTime = now().toISOString();
    return result.ok
      ? {
          ok: true,
          requestId,
          roomVersion: result.roomVersion,
          serverTime,
          data: result.data,
        }
      : {
          ok: false,
          requestId,
          roomVersion: result.roomVersion,
          serverTime,
          error: result.error,
        };
  }

  function validationFailure<T>(rawCommand: unknown): CommandAck<T> {
    const roomId = roomIdFrom(rawCommand);
    return {
      ok: false,
      requestId: requestIdFrom(rawCommand),
      roomVersion: roomId ? service.getRoomVersion(roomId) : 0,
      serverTime: now().toISOString(),
      error: {
        code: "VALIDATION_ERROR",
        message: "命令参数不合法",
      },
    };
  }

  function notInRoomFailure<T>(requestId: string, roomId: string): CommandAck<T> {
    return {
      ok: false,
      requestId,
      roomVersion: service.getRoomVersion(roomId),
      serverTime: now().toISOString(),
      error: { code: "NOT_IN_ROOM", message: "请先进入房间" },
    };
  }

  function rateLimitedFailure<T>(requestId: string, roomId: string): CommandAck<T> {
    return {
      ok: false,
      requestId,
      roomVersion: service.getRoomVersion(roomId),
      serverTime: now().toISOString(),
      error: { code: "RATE_LIMITED", message: "操作过于频繁，请稍后再试" },
    };
  }

  function executeRoomCommand<T>(
    socket: RealtimeSocket,
    eventName: keyof ClientToServerEvents,
    requestId: string,
    roomId: string,
    acknowledge: AckCallback<T>,
    action: (participant: RoomParticipant) => RealtimeCommandResult<T>,
  ): CommandAck<T> {
    const key = ackCacheKey(socket.data.session.sessionId, eventName, requestId);
    const cached = getCachedAck<T>(key);
    if (cached) {
      callAck(acknowledge, cached);
      return cached;
    }
    if (socket.data.roomId !== roomId) {
      const ack = notInRoomFailure<T>(requestId, roomId);
      cacheAck(key, ack);
      callAck(acknowledge, ack);
      return ack;
    }
    if (!consumeRateLimit(socket.data.session.sessionId, eventName)) {
      const ack = rateLimitedFailure<T>(requestId, roomId);
      cacheAck(key, ack);
      callAck(acknowledge, ack);
      return ack;
    }

    const result = action({
      sessionId: socket.data.session.sessionId,
      user: socket.data.session.user,
    });
    const ack = makeAck(requestId, result);
    cacheAck(key, ack);
    callAck(acknowledge, ack);
    return ack;
  }

  io.use((socket, next) => {
    const session = readSessionFromHandshake(socket, options.sessionStore, options.sessionSecret);
    if (!session) {
      next(authenticationError());
      return;
    }

    socket.data.session = session;
    const previousSocketId = activeSocketBySession.get(session.sessionId);
    if (previousSocketId && previousSocketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(previousSocketId);
      if (previousSocket) {
        previousSocket.disconnect(true);
      }
    }
    activeSocketBySession.set(session.sessionId, socket.id);
    next();
  });

  io.on("connection", (socket) => {
    socket.on("room:join", async (rawCommand, acknowledge) => {
      const parsed = roomJoinSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure<RoomSnapshot>(rawCommand));
        return;
      }
      const command: RoomJoinCommand = parsed.data;
      const previousRoomId = socket.data.roomId;
      if (previousRoomId && previousRoomId !== command.roomId) {
        service.leave(previousRoomId, socket.data.session.sessionId);
        await socket.leave(previousRoomId);
        delete socket.data.roomId;
      }

      const result = service.join(
        command.roomId,
        { sessionId: socket.data.session.sessionId, user: socket.data.session.user },
        command.inviteCode ?? undefined,
      );
      if (result.ok) {
        await socket.join(command.roomId);
        socket.data.roomId = command.roomId;
      }
      const ack = makeAck(command.requestId, result);
      callAck(acknowledge, ack);
      if (result.ok) {
        emitSnapshot(socket, result.data);
      }
    });

    socket.on("room:leave", async (rawCommand, acknowledge) => {
      const parsed = roomCommandSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure(rawCommand));
        return;
      }
      const { requestId, roomId } = parsed.data;
      const ack = executeRoomCommand(socket, "room:leave", requestId, roomId, acknowledge, () =>
        service.leave(roomId, socket.data.session.sessionId),
      );
      if (ack.ok && socket.data.roomId === roomId) {
        await socket.leave(roomId);
        delete socket.data.roomId;
      }
    });

    socket.on("room:resync", (rawCommand, acknowledge) => {
      const parsed = roomResyncSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure<RoomSnapshot>(rawCommand));
        return;
      }
      const command: RoomResyncCommand = parsed.data;
      if (socket.data.roomId !== command.roomId) {
        callAck(acknowledge, notInRoomFailure(command.requestId, command.roomId));
        return;
      }
      const result = service.resync(command.roomId, socket.data.session.sessionId);
      const ack = makeAck(command.requestId, result);
      callAck(acknowledge, ack);
      if (result.ok) {
        emitSnapshot(socket, result.data);
      }
    });

    socket.on("seat:request", (rawCommand, acknowledge) => {
      const parsed = roomCommandSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure(rawCommand));
        return;
      }
      executeRoomCommand(
        socket,
        "seat:request",
        parsed.data.requestId,
        parsed.data.roomId,
        acknowledge,
        (participant) => service.requestSeat(parsed.data.roomId, participant),
      );
    });

    socket.on("seat:cancel", (rawCommand, acknowledge) => {
      const parsed = roomCommandSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure(rawCommand));
        return;
      }
      executeRoomCommand(
        socket,
        "seat:cancel",
        parsed.data.requestId,
        parsed.data.roomId,
        acknowledge,
        (participant) => service.cancelSeatRequest(parsed.data.roomId, participant),
      );
    });

    socket.on("seat:leave", (rawCommand, acknowledge) => {
      const parsed = roomCommandSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure(rawCommand));
        return;
      }
      executeRoomCommand(
        socket,
        "seat:leave",
        parsed.data.requestId,
        parsed.data.roomId,
        acknowledge,
        (participant) => service.leaveSeat(parsed.data.roomId, participant),
      );
    });

    socket.on("speaker:acquire", (rawCommand, acknowledge) => {
      const parsed = roomCommandSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure(rawCommand));
        return;
      }
      executeRoomCommand(
        socket,
        "speaker:acquire",
        parsed.data.requestId,
        parsed.data.roomId,
        acknowledge,
        (participant) => service.acquireSpeaker(parsed.data.roomId, participant),
      );
    });

    socket.on("speaker:release", (rawCommand, acknowledge) => {
      const parsed = speakerReleaseSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure(rawCommand));
        return;
      }
      executeRoomCommand(
        socket,
        "speaker:release",
        parsed.data.requestId,
        parsed.data.roomId,
        acknowledge,
        (participant) =>
          service.releaseSpeakerByUser(parsed.data.roomId, participant, parsed.data.speechTurnId),
      );
    });

    socket.on("chat:send", (rawCommand, acknowledge) => {
      const parsed = chatSendSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure(rawCommand));
        return;
      }
      executeRoomCommand(
        socket,
        "chat:send",
        parsed.data.requestId,
        parsed.data.roomId,
        acknowledge,
        (participant) =>
          service.sendChat(
            parsed.data.roomId,
            participant,
            parsed.data.clientMessageId,
            parsed.data.content,
          ),
      );
    });

    socket.on("reaction:like", (rawCommand, acknowledge) => {
      const parsed = reactionLikeSchema.safeParse(rawCommand);
      if (!parsed.success) {
        callAck(acknowledge, validationFailure(rawCommand));
        return;
      }
      executeRoomCommand(
        socket,
        "reaction:like",
        parsed.data.requestId,
        parsed.data.roomId,
        acknowledge,
        (participant) =>
          service.likeSpeaker(parsed.data.roomId, participant, parsed.data.speechTurnId),
      );
    });

    socket.on("disconnect", () => {
      const sessionId = socket.data.session.sessionId;
      if (activeSocketBySession.get(sessionId) === socket.id) {
        activeSocketBySession.delete(sessionId);
      }
      if (socket.data.roomId && !isClosed) {
        service.disconnect(socket.data.roomId, sessionId);
      }
    });
  });

  return {
    close() {
      if (isClosed) {
        return;
      }
      isClosed = true;
      service.dispose();
      acknowledgements.clear();
      rateWindows.clear();
      activeSocketBySession.clear();
    },
  };
}
