import { randomUUID } from "node:crypto";

import {
  ROOM_RULES,
  type ChatCreatedData,
  type CommandError,
  type CooldownUpdatedData,
  type PresenceUpdatedData,
  type PublicUser,
  type QueueUpdatedData,
  type ReactionCreatedData,
  type RoomEvent,
  type SeatRequestResult,
  type SeatUpdatedData,
  type SpeakerAcquireResult,
  type SpeakerChangedData,
  type SpeakerTickData,
  type SpeechClosedData,
} from "@zhiliao/shared";
import type { components } from "@zhiliao/shared/openapi";

import type { ChatStore } from "../../stores/chat-store.js";
import type { RoomSnapshot, RoomStore } from "../../stores/room-store.js";
import type { SpeechTurnStore } from "../../stores/speech-turn-store.js";

type ChatMessage = components["schemas"]["ChatMessage"];
type ReleaseReason = components["schemas"]["ReleaseReason"];

interface RealtimeEventDataMap {
  "presence:updated": PresenceUpdatedData;
  "seat:updated": SeatUpdatedData;
  "queue:updated": QueueUpdatedData;
  "speaker:changed": SpeakerChangedData;
  "speaker:tick": SpeakerTickData;
  "cooldown:updated": CooldownUpdatedData;
  "chat:created": ChatCreatedData;
  "reaction:created": ReactionCreatedData;
  "speech:closed": SpeechClosedData;
}

export type RealtimeStateEvent = {
  [EventName in keyof RealtimeEventDataMap]: {
    name: EventName;
    event: RoomEvent<RealtimeEventDataMap[EventName]>;
  };
}[keyof RealtimeEventDataMap];

export interface RoomParticipant {
  sessionId: string;
  user: PublicUser;
}

export type RealtimeCommandResult<T> =
  | {
      ok: true;
      roomVersion: number;
      data: T;
    }
  | {
      ok: false;
      roomVersion: number;
      error: CommandError;
    };

interface SpeakerTimers {
  speechTurnId: string;
  timeout: ReturnType<typeof setTimeout>;
  tick: ReturnType<typeof setInterval>;
}

export interface RealtimeRoomServiceOptions {
  roomStore: RoomStore;
  chatStore: ChatStore;
  speechTurnStore: SpeechTurnStore;
  emit: (event: RealtimeStateEvent) => void;
  now?: () => Date;
  generateId?: () => string;
  speechLimitMilliseconds?: number;
  cooldownMilliseconds?: number;
  speakerTickMilliseconds?: number;
  disconnectGraceMilliseconds?: number;
}

const emptyData: Record<string, never> = {};

function unrefTimer(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}

export class RealtimeRoomService {
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private readonly speechLimitMilliseconds: number;
  private readonly cooldownMilliseconds: number;
  private readonly speakerTickMilliseconds: number;
  private readonly disconnectGraceMilliseconds: number;
  private readonly participants = new Map<string, Map<string, RoomParticipant>>();
  private readonly queuedUsers = new Map<string, Map<string, PublicUser>>();
  private readonly likedSessions = new Map<string, Set<string>>();
  private readonly speakerTimers = new Map<string, SpeakerTimers>();
  private readonly cooldownTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: RealtimeRoomServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
    this.speechLimitMilliseconds =
      options.speechLimitMilliseconds ?? ROOM_RULES.speechLimitSeconds * 1000;
    this.cooldownMilliseconds = options.cooldownMilliseconds ?? ROOM_RULES.cooldownSeconds * 1000;
    this.speakerTickMilliseconds = options.speakerTickMilliseconds ?? 5000;
    this.disconnectGraceMilliseconds = options.disconnectGraceMilliseconds ?? 10_000;
  }

  join(
    roomId: string,
    participant: RoomParticipant,
    inviteCode?: string,
  ): RealtimeCommandResult<RoomSnapshot> {
    const snapshot = this.options.roomStore.get(roomId);
    const availabilityError = this.getAvailabilityError(snapshot);
    if (availabilityError) {
      return this.failure(snapshot, availabilityError.code, availabilityError.message);
    }

    if (!this.options.roomStore.canAccess(roomId, inviteCode)) {
      return this.failure(
        snapshot,
        inviteCode ? "INVALID_INVITE_CODE" : "INVITE_REQUIRED",
        "无权进入该房间",
      );
    }

    this.cancelPendingDisconnect(roomId, participant.sessionId);
    const roomParticipants = this.getParticipants(roomId);
    const isNewPresence = !roomParticipants.has(participant.sessionId);
    roomParticipants.set(participant.sessionId, structuredClone(participant));

    if (isNewPresence) {
      snapshot!.room.onlineCount = roomParticipants.size;
      this.publishChange(snapshot!, "presence:updated", {
        onlineCount: snapshot!.room.onlineCount,
      });
    }

    return this.success(snapshot!);
  }

  resync(roomId: string, sessionId: string): RealtimeCommandResult<RoomSnapshot> {
    const snapshot = this.options.roomStore.get(roomId);
    const availabilityError = this.getAvailabilityError(snapshot);
    if (availabilityError) {
      return this.failure(snapshot, availabilityError.code, availabilityError.message);
    }

    if (!this.isParticipant(roomId, sessionId)) {
      return this.failure(snapshot, "NOT_IN_ROOM", "请先进入房间");
    }

    return this.success(snapshot!);
  }

  leave(
    roomId: string,
    sessionId: string,
    releaseReason: Extract<ReleaseReason, "seat_left" | "disconnected"> = "seat_left",
  ): RealtimeCommandResult<Record<string, never>> {
    const snapshot = this.options.roomStore.get(roomId);
    if (!snapshot) {
      return this.failure(undefined, "ROOM_NOT_FOUND", "房间不存在或已回收");
    }

    this.cancelPendingDisconnect(roomId, sessionId);
    const roomParticipants = this.participants.get(roomId);
    const participant = roomParticipants?.get(sessionId);
    if (!participant) {
      return this.success(snapshot, emptyData);
    }

    roomParticipants!.delete(sessionId);
    if (roomParticipants!.size === 0) {
      this.participants.delete(roomId);
    }

    const userStillPresent = [...(roomParticipants?.values() ?? [])].some(
      (otherParticipant) => otherParticipant.user.userId === participant.user.userId,
    );
    if (!userStillPresent) {
      this.removeUserFromQueue(snapshot, participant.user.userId);
      this.removeUserFromSeat(snapshot, participant.user.userId, releaseReason);
    }

    snapshot.room.onlineCount = roomParticipants?.size ?? 0;
    this.publishChange(snapshot, "presence:updated", {
      onlineCount: snapshot.room.onlineCount,
    });
    return this.success(snapshot, emptyData);
  }

  disconnect(roomId: string, sessionId: string): void {
    const participant = this.participants.get(roomId)?.get(sessionId);
    const snapshot = this.options.roomStore.get(roomId);
    if (
      !participant ||
      !snapshot ||
      this.disconnectTimers.has(this.disconnectKey(roomId, sessionId))
    ) {
      return;
    }

    if (snapshot.speakerLock?.userId === participant.user.userId) {
      this.releaseSpeaker(snapshot, "disconnected");
    }

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(this.disconnectKey(roomId, sessionId));
      this.leave(roomId, sessionId, "disconnected");
    }, this.disconnectGraceMilliseconds);
    unrefTimer(timer);
    this.disconnectTimers.set(this.disconnectKey(roomId, sessionId), timer);
  }

  requestSeat(
    roomId: string,
    participant: RoomParticipant,
  ): RealtimeCommandResult<SeatRequestResult> {
    const snapshot = this.requireJoinedRoom(roomId, participant.sessionId);
    if (!snapshot.ok) {
      return snapshot;
    }
    if (participant.user.identityType !== "zhihu") {
      return this.failure(snapshot.data, "ZHIHU_LOGIN_REQUIRED", "需要登录知乎后才能上麦");
    }
    if (snapshot.data.seats.some((seat) => seat.occupant?.userId === participant.user.userId)) {
      return this.failure(snapshot.data, "ALREADY_SEATED", "已经在麦位上");
    }
    if (snapshot.data.queue.some((entry) => entry.userId === participant.user.userId)) {
      return this.failure(snapshot.data, "ALREADY_QUEUED", "已经在等待队列中");
    }

    const emptySeat = snapshot.data.seats.find((seat) => seat.occupant === null);
    if (emptySeat) {
      emptySeat.occupant = structuredClone(participant.user);
      snapshot.data.room.seatedCount = this.countSeated(snapshot.data);
      this.publishChange(snapshot.data, "seat:updated", {
        seatNumber: emptySeat.seatNumber,
        occupant: structuredClone(participant.user),
      });
      return this.success(snapshot.data, {
        status: "seated",
        seatNumber: emptySeat.seatNumber,
      });
    }

    const queueEntry = {
      position: snapshot.data.queue.length + 1,
      userId: participant.user.userId,
      displayName: participant.user.displayName,
      enqueuedAt: this.now().toISOString(),
    };
    snapshot.data.queue.push(queueEntry);
    this.getQueuedUsers(roomId).set(participant.user.userId, structuredClone(participant.user));
    this.publishChange(snapshot.data, "queue:updated", {
      queue: structuredClone(snapshot.data.queue),
    });
    return this.success(snapshot.data, {
      status: "queued",
      queuePosition: queueEntry.position,
    });
  }

  cancelSeatRequest(
    roomId: string,
    participant: RoomParticipant,
  ): RealtimeCommandResult<Record<string, never>> {
    const snapshot = this.requireJoinedRoom(roomId, participant.sessionId);
    if (!snapshot.ok) {
      return snapshot;
    }
    const queueIndex = snapshot.data.queue.findIndex(
      (entry) => entry.userId === participant.user.userId,
    );
    if (queueIndex < 0) {
      return this.failure(snapshot.data, "NOT_IN_QUEUE", "当前不在等待队列中");
    }

    snapshot.data.queue.splice(queueIndex, 1);
    this.getQueuedUsers(roomId).delete(participant.user.userId);
    this.reindexQueue(snapshot.data);
    this.publishChange(snapshot.data, "queue:updated", {
      queue: structuredClone(snapshot.data.queue),
    });
    return this.success(snapshot.data, emptyData);
  }

  leaveSeat(
    roomId: string,
    participant: RoomParticipant,
  ): RealtimeCommandResult<Record<string, never>> {
    const snapshot = this.requireJoinedRoom(roomId, participant.sessionId);
    if (!snapshot.ok) {
      return snapshot;
    }
    if (!snapshot.data.seats.some((seat) => seat.occupant?.userId === participant.user.userId)) {
      return this.failure(snapshot.data, "NOT_SEATED", "当前不在麦位上");
    }

    this.removeUserFromSeat(snapshot.data, participant.user.userId, "seat_left");
    return this.success(snapshot.data, emptyData);
  }

  acquireSpeaker(
    roomId: string,
    participant: RoomParticipant,
  ): RealtimeCommandResult<SpeakerAcquireResult> {
    const snapshot = this.requireJoinedRoom(roomId, participant.sessionId);
    if (!snapshot.ok) {
      return snapshot;
    }
    if (participant.user.identityType !== "zhihu") {
      return this.failure(snapshot.data, "ZHIHU_LOGIN_REQUIRED", "需要登录知乎后才能发言");
    }

    const seat = snapshot.data.seats.find(
      (candidate) => candidate.occupant?.userId === participant.user.userId,
    );
    if (!seat) {
      return this.failure(snapshot.data, "SEAT_REQUIRED", "需要先上麦才能发言");
    }
    if (snapshot.data.speakerLock) {
      return this.failure(snapshot.data, "SPEAKER_LOCKED", "当前有人正在发言", {
        speakerUserId: snapshot.data.speakerLock.userId,
      });
    }

    const cooldown = snapshot.data.cooldowns.find(
      (candidate) => candidate.userId === participant.user.userId,
    );
    if (cooldown && Date.parse(cooldown.expiresAt) > this.now().getTime()) {
      return this.failure(snapshot.data, "COOLDOWN_ACTIVE", "发言冷却中", {
        expiresAt: cooldown.expiresAt,
      });
    }
    if (cooldown) {
      this.clearCooldown(snapshot.data, participant.user.userId);
    }

    const acquiredAt = this.now();
    const lock = {
      speechTurnId: `turn_${this.generateId()}`,
      userId: participant.user.userId,
      seatNumber: seat.seatNumber,
      acquiredAt: acquiredAt.toISOString(),
      expiresAt: new Date(acquiredAt.getTime() + this.speechLimitMilliseconds).toISOString(),
    };
    this.options.speechTurnStore.create(roomId, {
      speechTurnId: lock.speechTurnId,
      speaker: structuredClone(participant.user),
      startedAt: lock.acquiredAt,
      endedAt: null,
      releaseReason: null,
      likeCount: 0,
      transcript: null,
    });
    snapshot.data.speakerLock = lock;
    this.publishChange(snapshot.data, "speaker:changed", {
      speakerLock: structuredClone(lock),
      releaseReason: null,
    });
    this.scheduleSpeakerTimers(roomId, lock.speechTurnId);

    return this.success(snapshot.data, {
      speechTurnId: lock.speechTurnId,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
    });
  }

  releaseSpeakerByUser(
    roomId: string,
    participant: RoomParticipant,
    speechTurnId: string,
  ): RealtimeCommandResult<Record<string, never>> {
    const snapshot = this.requireJoinedRoom(roomId, participant.sessionId);
    if (!snapshot.ok) {
      return snapshot;
    }
    if (
      !snapshot.data.speakerLock ||
      snapshot.data.speakerLock.userId !== participant.user.userId
    ) {
      return this.failure(snapshot.data, "NOT_SPEAKER", "当前用户不是发言者");
    }
    if (snapshot.data.speakerLock.speechTurnId !== speechTurnId) {
      return this.failure(snapshot.data, "SPEECH_TURN_MISMATCH", "发言记录不匹配");
    }

    this.releaseSpeaker(snapshot.data, "user_finished");
    return this.success(snapshot.data, emptyData);
  }

  sendChat(
    roomId: string,
    participant: RoomParticipant,
    clientMessageId: string,
    content: string,
  ): RealtimeCommandResult<Record<string, never>> {
    const snapshot = this.requireJoinedRoom(roomId, participant.sessionId);
    if (!snapshot.ok) {
      return snapshot;
    }

    const message: ChatMessage = {
      messageId: `msg_${this.generateId()}`,
      clientMessageId,
      type: "text",
      sender: structuredClone(participant.user),
      content,
      createdAt: this.now().toISOString(),
    };
    this.options.chatStore.append(roomId, message);
    this.publishChange(snapshot.data, "chat:created", message);
    return this.success(snapshot.data, emptyData);
  }

  likeSpeaker(
    roomId: string,
    participant: RoomParticipant,
    speechTurnId: string,
  ): RealtimeCommandResult<Record<string, never>> {
    const snapshot = this.requireJoinedRoom(roomId, participant.sessionId);
    if (!snapshot.ok) {
      return snapshot;
    }
    const speakerLock = snapshot.data.speakerLock;
    if (!speakerLock || speakerLock.speechTurnId !== speechTurnId) {
      return this.failure(snapshot.data, "NO_ACTIVE_SPEAKER", "当前发言已结束");
    }

    const likedSessions = this.likedSessions.get(speechTurnId) ?? new Set<string>();
    if (likedSessions.has(participant.sessionId)) {
      return this.failure(snapshot.data, "ALREADY_LIKED", "已经为本次发言点过赞");
    }
    likedSessions.add(participant.sessionId);
    this.likedSessions.set(speechTurnId, likedSessions);
    const speechTurn = this.options.speechTurnStore.get(roomId, speechTurnId);
    if (!speechTurn) {
      likedSessions.delete(participant.sessionId);
      return this.failure(snapshot.data, "NO_ACTIVE_SPEAKER", "当前发言已结束");
    }
    speechTurn.likeCount += 1;
    this.options.speechTurnStore.update(roomId, speechTurn);

    this.publishChange(snapshot.data, "reaction:created", {
      type: "like",
      speechTurnId,
      targetUserId: speakerLock.userId,
      totalLikes: speechTurn.likeCount,
    });
    return this.success(snapshot.data, emptyData);
  }

  getRoomVersion(roomId: string): number {
    return this.options.roomStore.get(roomId)?.room.version ?? 0;
  }

  dispose(): void {
    for (const timers of this.speakerTimers.values()) {
      clearTimeout(timers.timeout);
      clearInterval(timers.tick);
    }
    for (const timer of this.cooldownTimers.values()) {
      clearTimeout(timer);
    }
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.speakerTimers.clear();
    this.cooldownTimers.clear();
    this.disconnectTimers.clear();
  }

  private requireJoinedRoom(
    roomId: string,
    sessionId: string,
  ): RealtimeCommandResult<RoomSnapshot> {
    const snapshot = this.options.roomStore.get(roomId);
    const availabilityError = this.getAvailabilityError(snapshot);
    if (availabilityError) {
      return this.failure(snapshot, availabilityError.code, availabilityError.message);
    }
    if (!this.isParticipant(roomId, sessionId)) {
      return this.failure(snapshot, "NOT_IN_ROOM", "请先进入房间");
    }
    return this.success(snapshot!);
  }

  private getAvailabilityError(
    snapshot: RoomSnapshot | undefined,
  ): { code: string; message: string } | null {
    if (!snapshot) {
      return { code: "ROOM_NOT_FOUND", message: "房间不存在或已回收" };
    }
    if (snapshot.room.status !== "active") {
      return { code: "ROOM_CLOSED", message: "房间已关闭" };
    }
    return null;
  }

  private getParticipants(roomId: string): Map<string, RoomParticipant> {
    let roomParticipants = this.participants.get(roomId);
    if (!roomParticipants) {
      roomParticipants = new Map();
      this.participants.set(roomId, roomParticipants);
    }
    return roomParticipants;
  }

  private getQueuedUsers(roomId: string): Map<string, PublicUser> {
    let roomUsers = this.queuedUsers.get(roomId);
    if (!roomUsers) {
      roomUsers = new Map();
      this.queuedUsers.set(roomId, roomUsers);
    }
    return roomUsers;
  }

  private isParticipant(roomId: string, sessionId: string): boolean {
    return this.participants.get(roomId)?.has(sessionId) ?? false;
  }

  private removeUserFromQueue(snapshot: RoomSnapshot, userId: string): void {
    const queueIndex = snapshot.queue.findIndex((entry) => entry.userId === userId);
    if (queueIndex < 0) {
      return;
    }
    snapshot.queue.splice(queueIndex, 1);
    this.getQueuedUsers(snapshot.room.roomId).delete(userId);
    this.reindexQueue(snapshot);
    this.publishChange(snapshot, "queue:updated", { queue: structuredClone(snapshot.queue) });
  }

  private removeUserFromSeat(
    snapshot: RoomSnapshot,
    userId: string,
    releaseReason: Extract<ReleaseReason, "seat_left" | "disconnected">,
  ): void {
    const seat = snapshot.seats.find((candidate) => candidate.occupant?.userId === userId);
    if (!seat) {
      return;
    }
    if (snapshot.speakerLock?.userId === userId) {
      this.releaseSpeaker(snapshot, releaseReason);
    }

    seat.occupant = null;
    snapshot.room.seatedCount = this.countSeated(snapshot);
    this.publishChange(snapshot, "seat:updated", {
      seatNumber: seat.seatNumber,
      occupant: null,
    });
    this.promoteQueue(snapshot, seat.seatNumber);
  }

  private promoteQueue(snapshot: RoomSnapshot, seatNumber: number): void {
    const seat = snapshot.seats.find((candidate) => candidate.seatNumber === seatNumber);
    if (!seat || seat.occupant) {
      return;
    }

    let promotedUser: PublicUser | undefined;
    while (snapshot.queue.length > 0 && !promotedUser) {
      const entry = snapshot.queue.shift();
      if (entry) {
        promotedUser = this.getQueuedUsers(snapshot.room.roomId).get(entry.userId);
        this.getQueuedUsers(snapshot.room.roomId).delete(entry.userId);
      }
    }
    this.reindexQueue(snapshot);

    if (promotedUser) {
      seat.occupant = structuredClone(promotedUser);
      snapshot.room.seatedCount = this.countSeated(snapshot);
      this.publishChange(snapshot, "seat:updated", {
        seatNumber,
        occupant: structuredClone(promotedUser),
      });
    }
    this.publishChange(snapshot, "queue:updated", { queue: structuredClone(snapshot.queue) });
  }

  private reindexQueue(snapshot: RoomSnapshot): void {
    snapshot.queue.forEach((entry, index) => {
      entry.position = index + 1;
    });
  }

  private releaseSpeaker(snapshot: RoomSnapshot, releaseReason: ReleaseReason): void {
    const lock = snapshot.speakerLock;
    if (!lock) {
      return;
    }
    this.clearSpeakerTimers(snapshot.room.roomId);
    const endedAt = this.now().toISOString();
    const speechTurn = this.options.speechTurnStore.get(snapshot.room.roomId, lock.speechTurnId);
    if (speechTurn) {
      speechTurn.endedAt = endedAt;
      speechTurn.releaseReason = releaseReason;
      speechTurn.transcript = {
        status: "pending",
        source: null,
        text: null,
        failureCode: null,
        updatedAt: endedAt,
      };
      this.options.speechTurnStore.update(snapshot.room.roomId, speechTurn);
    }
    snapshot.speakerLock = null;
    this.publishChange(snapshot, "speaker:changed", {
      speakerLock: null,
      releaseReason,
    });

    const cooldownExpiresAt = new Date(
      this.now().getTime() + this.cooldownMilliseconds,
    ).toISOString();
    const existingCooldown = snapshot.cooldowns.find((entry) => entry.userId === lock.userId);
    if (existingCooldown) {
      existingCooldown.expiresAt = cooldownExpiresAt;
    } else {
      snapshot.cooldowns.push({ userId: lock.userId, expiresAt: cooldownExpiresAt });
    }
    this.publishChange(snapshot, "cooldown:updated", {
      userId: lock.userId,
      expiresAt: cooldownExpiresAt,
    });
    this.scheduleCooldown(snapshot.room.roomId, lock.userId, cooldownExpiresAt);

    this.publishChange(snapshot, "speech:closed", {
      speechTurnId: lock.speechTurnId,
      speakerUserId: lock.userId,
      startedAt: lock.acquiredAt,
      endedAt,
      releaseReason,
      transcriptStatus: "pending",
    });
    this.likedSessions.delete(lock.speechTurnId);
  }

  private clearCooldown(snapshot: RoomSnapshot, userId: string): void {
    const index = snapshot.cooldowns.findIndex((entry) => entry.userId === userId);
    if (index < 0) {
      return;
    }
    snapshot.cooldowns.splice(index, 1);
    this.clearCooldownTimer(snapshot.room.roomId, userId);
    this.publishChange(snapshot, "cooldown:updated", { userId, expiresAt: null });
  }

  private scheduleSpeakerTimers(roomId: string, speechTurnId: string): void {
    this.clearSpeakerTimers(roomId);
    const tick = setInterval(() => {
      const snapshot = this.options.roomStore.get(roomId);
      if (!snapshot?.speakerLock || snapshot.speakerLock.speechTurnId !== speechTurnId) {
        this.clearSpeakerTimers(roomId);
        return;
      }
      this.publishWithoutChange(snapshot, "speaker:tick", {
        speechTurnId,
        expiresAt: snapshot.speakerLock.expiresAt,
      });
    }, this.speakerTickMilliseconds);
    const timeout = setTimeout(() => {
      const snapshot = this.options.roomStore.get(roomId);
      if (snapshot?.speakerLock?.speechTurnId === speechTurnId) {
        this.releaseSpeaker(snapshot, "time_limit");
      }
    }, this.speechLimitMilliseconds);
    unrefTimer(tick);
    unrefTimer(timeout);
    this.speakerTimers.set(roomId, { speechTurnId, timeout, tick });
  }

  private clearSpeakerTimers(roomId: string): void {
    const timers = this.speakerTimers.get(roomId);
    if (!timers) {
      return;
    }
    clearTimeout(timers.timeout);
    clearInterval(timers.tick);
    this.speakerTimers.delete(roomId);
  }

  private scheduleCooldown(roomId: string, userId: string, expiresAt: string): void {
    this.clearCooldownTimer(roomId, userId);
    const delay = Math.max(0, Date.parse(expiresAt) - this.now().getTime());
    const timer = setTimeout(() => {
      this.cooldownTimers.delete(this.cooldownKey(roomId, userId));
      const snapshot = this.options.roomStore.get(roomId);
      const currentCooldown = snapshot?.cooldowns.find((entry) => entry.userId === userId);
      if (snapshot && currentCooldown?.expiresAt === expiresAt) {
        this.clearCooldown(snapshot, userId);
      }
    }, delay);
    unrefTimer(timer);
    this.cooldownTimers.set(this.cooldownKey(roomId, userId), timer);
  }

  private clearCooldownTimer(roomId: string, userId: string): void {
    const key = this.cooldownKey(roomId, userId);
    const timer = this.cooldownTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.cooldownTimers.delete(key);
    }
  }

  private publishChange<EventName extends keyof RealtimeEventDataMap>(
    snapshot: RoomSnapshot,
    name: EventName,
    data: RealtimeEventDataMap[EventName],
  ): void {
    snapshot.room.version += 1;
    this.options.roomStore.update(snapshot);
    this.publishWithoutChange(snapshot, name, data);
  }

  private publishWithoutChange<EventName extends keyof RealtimeEventDataMap>(
    snapshot: RoomSnapshot,
    name: EventName,
    data: RealtimeEventDataMap[EventName],
  ): void {
    const serverTime = this.now().toISOString();
    this.options.emit({
      name,
      event: {
        eventId: `evt_${this.generateId()}`,
        roomId: snapshot.room.roomId,
        roomVersion: snapshot.room.version,
        serverTime,
        data,
      },
    } as RealtimeStateEvent);
  }

  private success<T>(snapshot: RoomSnapshot, data?: T): RealtimeCommandResult<T> {
    return {
      ok: true,
      roomVersion: snapshot.room.version,
      data: structuredClone(data ?? (snapshot as T)),
    };
  }

  private failure<T>(
    snapshot: RoomSnapshot | undefined,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): RealtimeCommandResult<T> {
    return {
      ok: false,
      roomVersion: snapshot?.room.version ?? 0,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    };
  }

  private countSeated(snapshot: RoomSnapshot): number {
    return snapshot.seats.filter((seat) => seat.occupant !== null).length;
  }

  private cooldownKey(roomId: string, userId: string): string {
    return `${roomId}:${userId}`;
  }

  private disconnectKey(roomId: string, sessionId: string): string {
    return `${roomId}:${sessionId}`;
  }

  private cancelPendingDisconnect(roomId: string, sessionId: string): void {
    const key = this.disconnectKey(roomId, sessionId);
    const timer = this.disconnectTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(key);
    }
  }
}
