import type { components } from "./generated/openapi.js";

export const CLIENT_EVENTS = {
  roomJoin: "room:join",
  roomLeave: "room:leave",
  roomResync: "room:resync",
  seatRequest: "seat:request",
  seatCancel: "seat:cancel",
  seatLeave: "seat:leave",
  speakerAcquire: "speaker:acquire",
  speakerRelease: "speaker:release",
  chatSend: "chat:send",
  reactionLike: "reaction:like",
} as const;

export const SERVER_EVENTS = {
  roomSnapshot: "room:snapshot",
  roomClosed: "room:closed",
  presenceUpdated: "presence:updated",
  seatUpdated: "seat:updated",
  queueUpdated: "queue:updated",
  speakerChanged: "speaker:changed",
  speakerTick: "speaker:tick",
  cooldownUpdated: "cooldown:updated",
  chatCreated: "chat:created",
  reactionCreated: "reaction:created",
  speechClosed: "speech:closed",
  transcriptUpdated: "transcript:updated",
  summaryUpdated: "summary:updated",
} as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];
export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];

type EmptyData = Record<string, never>;
type RoomSnapshot = components["schemas"]["RoomSnapshot"];
type PublicUser = components["schemas"]["PublicUser"];
type QueueEntry = components["schemas"]["QueueEntry"];
type SpeakerLock = components["schemas"]["SpeakerLock"];
type ChatMessage = components["schemas"]["ChatMessage"];
type ReleaseReason = components["schemas"]["ReleaseReason"];
type TranscriptStatus = components["schemas"]["TranscriptStatus"];
type TranscriptSource = components["schemas"]["TranscriptSource"];
type SummaryStatus = components["schemas"]["SummaryStatus"];

export interface CommandError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CommandAckSuccess<T> {
  ok: true;
  requestId: string;
  roomVersion: number;
  serverTime: string;
  data: T;
}

export interface CommandAckFailure {
  ok: false;
  requestId: string;
  roomVersion: number;
  serverTime: string;
  error: CommandError;
}

export type CommandAck<T = EmptyData> = CommandAckSuccess<T> | CommandAckFailure;
export type AckCallback<T = EmptyData> = (ack: CommandAck<T>) => void;

export interface RoomCommand {
  requestId: string;
  roomId: string;
}

export interface RoomJoinCommand extends RoomCommand {
  lastKnownVersion: number | null;
  inviteCode: string | null;
}

export interface RoomResyncCommand extends RoomCommand {
  lastKnownVersion: number;
}

export interface SpeakerReleaseCommand extends RoomCommand {
  speechTurnId: string;
  reason: "user_finished";
}

export interface ChatSendCommand extends RoomCommand {
  clientMessageId: string;
  content: string;
}

export interface ReactionLikeCommand extends RoomCommand {
  speechTurnId: string;
}

export type SeatRequestResult =
  | {
      status: "seated";
      seatNumber: number;
    }
  | {
      status: "queued";
      queuePosition: number;
    };

export interface SpeakerAcquireResult {
  speechTurnId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface RoomEvent<T> {
  eventId: string;
  roomId: string;
  roomVersion: number;
  serverTime: string;
  data: T;
}

export interface PresenceUpdatedData {
  onlineCount: number;
}

export interface SeatUpdatedData {
  seatNumber: number;
  occupant: PublicUser | null;
}

export interface QueueUpdatedData {
  queue: QueueEntry[];
}

export type SpeakerChangedData =
  | {
      speakerLock: SpeakerLock;
      releaseReason: null;
    }
  | {
      speakerLock: null;
      releaseReason: ReleaseReason;
    };

export interface SpeakerTickData {
  speechTurnId: string;
  expiresAt: string;
}

export interface CooldownUpdatedData {
  userId: string;
  expiresAt: string | null;
}

export type ChatCreatedData = ChatMessage;

export interface ReactionCreatedData {
  type: "like";
  speechTurnId: string;
  targetUserId: string;
  totalLikes: number;
}

export interface SpeechClosedData {
  speechTurnId: string;
  speakerUserId: string;
  startedAt: string;
  endedAt: string;
  releaseReason: ReleaseReason;
  transcriptStatus: TranscriptStatus;
}

export interface TranscriptUpdatedData {
  speechTurnId: string;
  status: TranscriptStatus;
  source: TranscriptSource | null;
  text: string | null;
  failureCode: string | null;
}

export interface SummaryUpdatedData {
  status: SummaryStatus;
  summaryVersion: number;
  sourceTranscriptVersion: number;
  updatedAt: string;
}

export interface RoomClosedData {
  reason: "empty_timeout";
}

export interface ClientToServerEvents {
  "room:join": (command: RoomJoinCommand, acknowledge: AckCallback<RoomSnapshot>) => void;
  "room:leave": (command: RoomCommand, acknowledge: AckCallback) => void;
  "room:resync": (command: RoomResyncCommand, acknowledge: AckCallback<RoomSnapshot>) => void;
  "seat:request": (command: RoomCommand, acknowledge: AckCallback<SeatRequestResult>) => void;
  "seat:cancel": (command: RoomCommand, acknowledge: AckCallback) => void;
  "seat:leave": (command: RoomCommand, acknowledge: AckCallback) => void;
  "speaker:acquire": (command: RoomCommand, acknowledge: AckCallback<SpeakerAcquireResult>) => void;
  "speaker:release": (command: SpeakerReleaseCommand, acknowledge: AckCallback) => void;
  "chat:send": (command: ChatSendCommand, acknowledge: AckCallback) => void;
  "reaction:like": (command: ReactionLikeCommand, acknowledge: AckCallback) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (event: RoomEvent<RoomSnapshot>) => void;
  "presence:updated": (event: RoomEvent<PresenceUpdatedData>) => void;
  "seat:updated": (event: RoomEvent<SeatUpdatedData>) => void;
  "queue:updated": (event: RoomEvent<QueueUpdatedData>) => void;
  "speaker:changed": (event: RoomEvent<SpeakerChangedData>) => void;
  "speaker:tick": (event: RoomEvent<SpeakerTickData>) => void;
  "cooldown:updated": (event: RoomEvent<CooldownUpdatedData>) => void;
  "chat:created": (event: RoomEvent<ChatCreatedData>) => void;
  "reaction:created": (event: RoomEvent<ReactionCreatedData>) => void;
  "speech:closed": (event: RoomEvent<SpeechClosedData>) => void;
  "transcript:updated": (event: RoomEvent<TranscriptUpdatedData>) => void;
  "summary:updated": (event: RoomEvent<SummaryUpdatedData>) => void;
  "room:closed": (event: RoomEvent<RoomClosedData>) => void;
}
