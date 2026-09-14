import type { RoomSnapshot } from "../../lib/api-client";
import type {
  CooldownUpdatedData,
  QueueUpdatedData,
  SeatUpdatedData,
  SpeakerChangedData,
} from "@zhiliao/shared";

export type RoomEventDisposition = "next" | "stale" | "gap";

export function classifyRoomEvent(
  snapshot: RoomSnapshot | null,
  eventVersion: number,
): RoomEventDisposition {
  if (!snapshot) return "gap";
  if (eventVersion <= snapshot.room.version) return "stale";
  return eventVersion === snapshot.room.version + 1 ? "next" : "gap";
}

export function applyPresenceUpdate(
  snapshot: RoomSnapshot,
  eventVersion: number,
  onlineCount: number,
): RoomSnapshot {
  return {
    ...snapshot,
    room: {
      ...snapshot.room,
      onlineCount,
      version: eventVersion,
    },
  };
}

export function applySeatUpdate(
  snapshot: RoomSnapshot,
  eventVersion: number,
  data: SeatUpdatedData,
): RoomSnapshot {
  const seats = snapshot.seats.map((seat) =>
    seat.seatNumber === data.seatNumber ? { ...seat, occupant: data.occupant } : seat,
  );

  return {
    ...snapshot,
    room: {
      ...snapshot.room,
      seatedCount: seats.filter((seat) => seat.occupant !== null).length,
      version: eventVersion,
    },
    seats,
  };
}

export function applyQueueUpdate(
  snapshot: RoomSnapshot,
  eventVersion: number,
  data: QueueUpdatedData,
): RoomSnapshot {
  return {
    ...snapshot,
    room: { ...snapshot.room, version: eventVersion },
    queue: data.queue,
  };
}

export function applySpeakerUpdate(
  snapshot: RoomSnapshot,
  eventVersion: number,
  data: SpeakerChangedData,
): RoomSnapshot {
  return {
    ...snapshot,
    room: { ...snapshot.room, version: eventVersion },
    speakerLock: data.speakerLock,
  };
}

export function applyCooldownUpdate(
  snapshot: RoomSnapshot,
  eventVersion: number,
  data: CooldownUpdatedData,
): RoomSnapshot {
  const cooldowns = snapshot.cooldowns.filter((cooldown) => cooldown.userId !== data.userId);
  if (data.expiresAt !== null) {
    cooldowns.push({ userId: data.userId, expiresAt: data.expiresAt });
  }

  return {
    ...snapshot,
    room: { ...snapshot.room, version: eventVersion },
    cooldowns,
  };
}

export function advanceRoomVersion(snapshot: RoomSnapshot, eventVersion: number): RoomSnapshot {
  return {
    ...snapshot,
    room: { ...snapshot.room, version: eventVersion },
  };
}
