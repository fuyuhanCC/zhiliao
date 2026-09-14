import type { RoomSnapshot } from "../../lib/api-client";

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
