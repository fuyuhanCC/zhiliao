import { createHmac } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";

import type {
  ClientToServerEvents,
  CommandAck,
  RewardSendResult,
  ServerToClientEvents,
} from "@zhiliao/shared";
import { Server } from "socket.io";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME } from "../modules/auth/session.js";
import { MemoryChatStore } from "../stores/memory/chat-store.js";
import { MemoryAccountStore } from "../stores/memory/account-store.js";
import { MemoryRoomStore } from "../stores/memory/room-store.js";
import { MemorySessionStore } from "../stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "../stores/memory/speech-turn-store.js";
import type { RoomSnapshot } from "../stores/room-store.js";
import type { UserSession } from "../stores/session-store.js";
import { createRoomSnapshot } from "../test/room-fixture.js";
import {
  registerRealtimeGateway,
  type RealtimeGateway,
  type RealtimeServer,
} from "./realtime-gateway.js";
import { RoomEventBus } from "./room-event-bus.js";

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

const sessionSecret = "test-session-secret-with-at-least-32-characters";
const clients: TestClient[] = [];
let gateway: RealtimeGateway | undefined;
let ioServer: RealtimeServer | undefined;
let httpServer: HttpServer | undefined;

function signSessionCookie(sessionId: string): string {
  const signature = createHmac("sha256", sessionSecret)
    .update(sessionId)
    .digest("base64")
    .replace(/=+$/, "");
  const signedValue = `s:${sessionId}.${signature}`;
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedValue)}`;
}

function createSession(index: number, identityType: "guest" | "zhihu"): UserSession {
  return {
    sessionId: `session-${index}`,
    user: {
      userId: `user-${index}`,
      identityType,
      displayName: `用户 ${index}`,
      avatarUrl: null,
      level: 1,
      levelTitle: "蛰伏",
    },
    createdAt: "2026-09-13T08:00:00.000Z",
    updatedAt: "2026-09-13T08:00:00.000Z",
  };
}

async function listen(server: HttpServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected an ephemeral TCP port");
  }
  return address.port;
}

async function connectClient(port: number, session: UserSession): Promise<TestClient> {
  const socket = createClient(`http://127.0.0.1:${port}`, {
    path: "/socket.io",
    transports: ["websocket"],
    extraHeaders: { Cookie: signSessionCookie(session.sessionId) },
    forceNew: true,
    reconnection: false,
    autoConnect: false,
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    socket.connect();
  });
  return socket;
}

function joinRoom(socket: TestClient, roomId: string, requestId: string) {
  return new Promise<CommandAck<RoomSnapshot>>((resolve) => {
    socket.emit(
      "room:join",
      { requestId, roomId, lastKnownVersion: null, inviteCode: null },
      resolve,
    );
  });
}

function requestSeat(socket: TestClient, roomId: string, requestId: string) {
  return new Promise<Parameters<Parameters<ClientToServerEvents["seat:request"]>[1]>[0]>(
    (resolve) => {
      socket.emit("seat:request", { requestId, roomId }, resolve);
    },
  );
}

function acquireSpeaker(socket: TestClient, roomId: string, requestId: string) {
  return new Promise<Parameters<Parameters<ClientToServerEvents["speaker:acquire"]>[1]>[0]>(
    (resolve) => {
      socket.emit("speaker:acquire", { requestId, roomId }, resolve);
    },
  );
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.disconnect();
  }
  gateway?.close();
  gateway = undefined;
  if (ioServer) {
    await new Promise<void>((resolve) => ioServer!.close(() => resolve()));
    ioServer = undefined;
  }
  if (httpServer?.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer!.close((error) => (error ? reject(error) : resolve()));
    });
  }
  httpServer = undefined;
});

describe("realtime gateway", () => {
  it("synchronizes seats, the speaker lock, chat and likes across clients", async () => {
    const roomId = "room_integration";
    const sessionStore = new MemorySessionStore();
    const accountStore = new MemoryAccountStore();
    const roomStore = new MemoryRoomStore();
    const chatStore = new MemoryChatStore();
    const speechTurnStore = new MemorySpeechTurnStore();
    const roomEventBus = new RoomEventBus();
    const speakerSession = createSession(1, "zhihu");
    const guestSession = createSession(2, "guest");
    sessionStore.save(speakerSession);
    sessionStore.save(guestSession);
    roomStore.save(createRoomSnapshot(roomId));

    const app = createApp({
      sessionStore,
      accountStore,
      roomStore,
      chatStore,
      speechTurnStore,
      zhihuOAuthService: null,
      rtcCredentialService: null,
      sessionSecret,
      secureCookies: false,
      webOrigin: "http://localhost:5173",
    });
    httpServer = createServer(app);
    ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      path: "/socket.io",
    });
    gateway = registerRealtimeGateway(ioServer, {
      sessionStore,
      accountStore,
      roomStore,
      chatStore,
      speechTurnStore,
      roomEventBus,
      sessionSecret,
      disconnectGraceMilliseconds: 20,
    });
    const port = await listen(httpServer);
    const speaker = await connectClient(port, speakerSession);
    const guest = await connectClient(port, guestSession);

    expect((await joinRoom(speaker, roomId, "join-speaker")).ok).toBe(true);
    const guestJoin = await joinRoom(guest, roomId, "join-guest");
    expect(guestJoin).toMatchObject({ ok: true, data: { room: { onlineCount: 2 } } });

    const transcriptBroadcast = new Promise<
      Parameters<ServerToClientEvents["transcript:updated"]>[0]
    >((resolve) => guest.once("transcript:updated", resolve));
    roomEventBus.publish({
      name: "transcript:updated",
      roomId,
      data: {
        speechTurnId: "turn-derived",
        status: "ready",
        source: "asr",
        text: "转写完成",
        failureCode: null,
      },
    });
    expect(await transcriptBroadcast).toMatchObject({
      roomId,
      data: { speechTurnId: "turn-derived", status: "ready", text: "转写完成" },
    });

    const seatBroadcast = new Promise<Parameters<ServerToClientEvents["seat:updated"]>[0]>(
      (resolve) => guest.once("seat:updated", resolve),
    );
    const seated = await requestSeat(speaker, roomId, "seat-speaker");
    expect(seated).toMatchObject({ ok: true, data: { status: "seated", seatNumber: 1 } });
    expect(await seatBroadcast).toMatchObject({
      data: { seatNumber: 1, occupant: { userId: "user-1" } },
    });

    const speakerBroadcast = new Promise<Parameters<ServerToClientEvents["speaker:changed"]>[0]>(
      (resolve) => guest.once("speaker:changed", resolve),
    );
    const acquired = await acquireSpeaker(speaker, roomId, "acquire-speaker");
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) {
      throw new Error("expected speaker acquisition to succeed");
    }
    expect(await speakerBroadcast).toMatchObject({
      data: { speakerLock: { speechTurnId: acquired.data.speechTurnId, userId: "user-1" } },
    });

    const likeBroadcast = new Promise<Parameters<ServerToClientEvents["reaction:created"]>[0]>(
      (resolve) => speaker.once("reaction:created", resolve),
    );
    const likeAck = await new Promise<CommandAck>((resolve) => {
      guest.emit(
        "reaction:like",
        {
          requestId: "like-speaker",
          roomId,
          speechTurnId: acquired.data.speechTurnId,
        },
        resolve,
      );
    });
    expect(likeAck.ok).toBe(true);
    expect(await likeBroadcast).toMatchObject({
      data: { targetUserId: "user-1", totalLikes: 1, experienceAwarded: true },
    });

    const rewardBroadcast = new Promise<Parameters<ServerToClientEvents["reward:created"]>[0]>(
      (resolve) => speaker.once("reward:created", resolve),
    );
    const senderAccountUpdate = new Promise<Parameters<ServerToClientEvents["account:updated"]>[0]>(
      (resolve) => guest.once("account:updated", resolve),
    );
    const recipientAccountUpdate = new Promise<
      Parameters<ServerToClientEvents["account:updated"]>[0]
    >((resolve) => speaker.once("account:updated", resolve));
    const rewardSystemMessage = new Promise<Parameters<ServerToClientEvents["chat:created"]>[0]>(
      (resolve) => speaker.once("chat:created", resolve),
    );
    const sendReward = () =>
      new Promise<CommandAck<RewardSendResult>>((resolve) => {
        guest.emit(
          "reward:send",
          {
            requestId: "reward-speaker",
            roomId,
            speechTurnId: acquired.data.speechTurnId,
            amount: 10,
          },
          resolve,
        );
      });
    const rewardAck = await sendReward();
    expect(rewardAck).toMatchObject({
      ok: true,
      data: { amount: 10, recipientUserId: "user-1", remainingBalance: 90 },
    });
    const rewardCreated = await rewardBroadcast;
    expect(rewardCreated).toMatchObject({
      data: {
        amount: 10,
        sender: { userId: "user-2", level: 1 },
        recipient: { userId: "user-1", level: 1 },
      },
    });
    expect(JSON.stringify(rewardCreated)).not.toContain("coinBalance");
    expect(await senderAccountUpdate).toMatchObject({ data: { coinBalance: 90 } });
    expect(await recipientAccountUpdate).toMatchObject({
      data: { coinBalance: 110, experience: 3 },
    });
    expect(await rewardSystemMessage).toMatchObject({
      data: { type: "system", sender: null, content: "用户 2 打赏了 用户 1 10 知豆" },
    });

    const retriedRewardAck = await sendReward();
    expect(retriedRewardAck).toEqual(rewardAck);
    expect(accountStore.get("user-2")?.coinBalance).toBe(90);
    expect(accountStore.get("user-1")).toMatchObject({ coinBalance: 110, experience: 3 });

    let chatBroadcastCount = 0;
    speaker.on("chat:created", () => {
      chatBroadcastCount += 1;
    });
    const chatBroadcast = new Promise<Parameters<ServerToClientEvents["chat:created"]>[0]>(
      (resolve) => speaker.once("chat:created", resolve),
    );
    const sendChat = () =>
      new Promise<CommandAck>((resolve) => {
        guest.emit(
          "chat:send",
          {
            requestId: "chat-one",
            roomId,
            clientMessageId: "client-message-one",
            content: "  我赞同这个观点  ",
          },
          resolve,
        );
      });
    const chatAck = await sendChat();
    expect(chatAck.ok).toBe(true);
    expect(await chatBroadcast).toMatchObject({
      data: { sender: { userId: "user-2" }, content: "我赞同这个观点" },
    });

    const retriedChatAck = await sendChat();
    expect(retriedChatAck).toEqual(chatAck);
    await new Promise((resolve) => setImmediate(resolve));
    expect(chatBroadcastCount).toBe(1);

    const releaseAck = await new Promise<CommandAck>((resolve) => {
      speaker.emit(
        "speaker:release",
        {
          requestId: "release-speaker",
          roomId,
          speechTurnId: acquired.data.speechTurnId,
          reason: "user_finished",
        },
        resolve,
      );
    });
    expect(releaseAck.ok).toBe(true);

    const messages = await request(app).get(`/api/v1/rooms/${roomId}/messages`);
    expect(messages.body).toMatchObject({
      items: [
        { type: "system", content: "用户 2 打赏了 用户 1 10 知豆" },
        { clientMessageId: "client-message-one", content: "我赞同这个观点" },
      ],
      nextCursor: null,
    });
    const speechTurns = await request(app).get(`/api/v1/rooms/${roomId}/speech-turns`);
    expect(speechTurns.body).toMatchObject({
      items: [
        {
          speechTurnId: acquired.data.speechTurnId,
          endedAt: expect.any(String),
          releaseReason: "user_finished",
          likeCount: 1,
          transcript: { status: "pending" },
        },
      ],
      transcriptVersion: 0,
    });
  });

  it("rejects a Socket.IO connection without a signed session cookie", async () => {
    const sessionStore = new MemorySessionStore();
    const accountStore = new MemoryAccountStore();
    const roomStore = new MemoryRoomStore();
    const chatStore = new MemoryChatStore();
    const speechTurnStore = new MemorySpeechTurnStore();
    const app = createApp({
      sessionStore,
      accountStore,
      roomStore,
      chatStore,
      speechTurnStore,
      zhihuOAuthService: null,
      rtcCredentialService: null,
      sessionSecret,
      secureCookies: false,
      webOrigin: "http://localhost:5173",
    });
    httpServer = createServer(app);
    ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      path: "/socket.io",
    });
    gateway = registerRealtimeGateway(ioServer, {
      sessionStore,
      accountStore,
      roomStore,
      chatStore,
      speechTurnStore,
      sessionSecret,
    });
    const port = await listen(httpServer);
    const socket = createClient(`http://127.0.0.1:${port}`, {
      path: "/socket.io",
      transports: ["websocket"],
      reconnection: false,
      autoConnect: false,
    });
    clients.push(socket);

    const error = await new Promise<Error & { data?: { code?: string } }>((resolve) => {
      socket.once("connect_error", resolve);
      socket.connect();
    });
    expect(error.data?.code).toBe("AUTH_REQUIRED");
  });
});
