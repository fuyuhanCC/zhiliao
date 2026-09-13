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
