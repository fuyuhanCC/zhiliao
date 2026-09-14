import { randomBytes } from "node:crypto";

import type { PublicUser } from "@zhiliao/shared";
import type { components } from "@zhiliao/shared/openapi";

import type { RoomStore } from "../../stores/room-store.js";

type CreateRoomRequest = components["schemas"]["CreateRoomRequest"];
type CreateRoomResponse = components["schemas"]["CreateRoomResponse"];
type RoomSnapshot = components["schemas"]["RoomSnapshot"];
type Topic = components["schemas"]["Topic"];

export interface CreateRoomInput {
  user: PublicUser;
  request: CreateRoomRequest;
  idempotencyKey: string;
}

export interface RoomServiceOptions {
  roomStore: RoomStore;
  now?: () => Date;
  generateRoomId?: () => string;
}

function defaultRoomId(): string {
  return `room_${randomBytes(12).toString("base64url")}`;
}

function toTopic(input: CreateRoomRequest["topic"]): Topic {
  return {
    source: "manual",
    title: input.title,
    zhihuQuestionId: null,
    zhihuUrl: null,
    excerpt: null,
    imageUrl: null,
    answerExcerpts: [],
    hotRank: null,
  };
}

export class RoomService {
  private readonly now: () => Date;
  private readonly generateRoomId: () => string;
  private readonly createdByIdempotencyKey = new Map<string, CreateRoomResponse>();

  constructor(private readonly options: RoomServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.generateRoomId = options.generateRoomId ?? defaultRoomId;
  }

  create(input: CreateRoomInput): CreateRoomResponse {
    const cacheKey = `${input.user.userId}:${input.idempotencyKey}`;
    const cached = this.createdByIdempotencyKey.get(cacheKey);
    if (cached) {
      return structuredClone(cached);
    }

    const roomId = this.generateRoomId();
    const room: CreateRoomResponse["room"] = {
      roomId,
      type: "custom",
      status: "active",
      visibility: "public",
      topic: toTopic(input.request.topic),
      creator: structuredClone(input.user),
      onlineCount: 0,
      seatedCount: 0,
      createdAt: this.now().toISOString(),
      version: 1,
    };
    const snapshot: RoomSnapshot = {
      room,
      seats: Array.from({ length: 6 }, (_, index) => ({
        seatNumber: index + 1,
        occupant: null,
      })),
      queue: [],
      speakerLock: null,
      cooldowns: [],
    };

    this.options.roomStore.save(snapshot);

    const response: CreateRoomResponse = { room };
    this.createdByIdempotencyKey.set(cacheKey, structuredClone(response));
    return structuredClone(response);
  }

}
