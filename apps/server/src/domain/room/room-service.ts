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
  webOrigin: string;
  now?: () => Date;
  generateRoomId?: () => string;
  generateInviteCode?: () => string;
}

function defaultRoomId(): string {
  return `room_${randomBytes(12).toString("base64url")}`;
}

function defaultInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

function extractZhihuQuestionId(questionUrl: string): string | null {
  const match = new URL(questionUrl).pathname.match(/\/question\/(\d+)/);
  return match?.[1] ?? null;
}

function toTopic(input: CreateRoomRequest["topic"]): Topic {
  if (input.source === "manual") {
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

  return {
    source: "zhihu_question",
    title: input.title,
    zhihuQuestionId: extractZhihuQuestionId(input.questionUrl),
    zhihuUrl: input.questionUrl,
    excerpt: null,
    imageUrl: null,
    answerExcerpts: [],
    hotRank: null,
  };
}

export class RoomService {
  private readonly now: () => Date;
  private readonly generateRoomId: () => string;
  private readonly generateInviteCode: () => string;
  private readonly createdByIdempotencyKey = new Map<string, CreateRoomResponse>();

  constructor(private readonly options: RoomServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.generateRoomId = options.generateRoomId ?? defaultRoomId;
    this.generateInviteCode = options.generateInviteCode ?? defaultInviteCode;
  }

  create(input: CreateRoomInput): CreateRoomResponse {
    const cacheKey = `${input.user.userId}:${input.idempotencyKey}`;
    const cached = this.createdByIdempotencyKey.get(cacheKey);
    if (cached) {
      return structuredClone(cached);
    }

    const roomId = this.generateRoomId();
    const inviteCode = input.request.visibility === "invite" ? this.generateInviteCode() : null;
    const room: CreateRoomResponse["room"] = {
      roomId,
      type: "custom",
      status: "active",
      visibility: input.request.visibility,
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

    this.options.roomStore.save(snapshot, inviteCode ? { inviteCode } : undefined);

    const response: CreateRoomResponse = {
      room,
      inviteCode,
      inviteUrl: inviteCode ? this.createInviteUrl(roomId, inviteCode) : null,
    };
    this.createdByIdempotencyKey.set(cacheKey, structuredClone(response));
    return structuredClone(response);
  }

  private createInviteUrl(roomId: string, inviteCode: string): string {
    const inviteUrl = new URL(`/rooms/${encodeURIComponent(roomId)}`, this.options.webOrigin);
    inviteUrl.searchParams.set("inviteCode", inviteCode);
    return inviteUrl.toString();
  }
}
