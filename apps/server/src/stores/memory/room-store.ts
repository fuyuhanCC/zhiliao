import { createHash, timingSafeEqual } from "node:crypto";

import type {
  ListRoomsOptions,
  RoomListResult,
  RoomSnapshot,
  RoomStore,
  SaveRoomOptions,
} from "../room-store.js";

interface StoredRoom {
  snapshot: RoomSnapshot;
  inviteCodeDigest: Buffer | null;
}

function digestInviteCode(inviteCode: string): Buffer {
  return createHash("sha256").update(inviteCode).digest();
}

export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, StoredRoom>();

  get(roomId: string): RoomSnapshot | undefined {
    const storedRoom = this.rooms.get(roomId);
    return storedRoom ? structuredClone(storedRoom.snapshot) : undefined;
  }

  list(options: ListRoomsOptions): RoomListResult {
    const rooms = [...this.rooms.values()]
      .map(({ snapshot }) => snapshot.room)
      .filter(
        (room) =>
          room.status === "active" &&
          room.visibility === "public" &&
          (options.type === undefined || room.type === options.type),
      )
      .sort((left, right) => {
        if (options.type === "hot") {
          return (
            (left.topic.hotRank ?? Number.MAX_SAFE_INTEGER) -
              (right.topic.hotRank ?? Number.MAX_SAFE_INTEGER) ||
            left.roomId.localeCompare(right.roomId)
          );
        }

        return (
          right.createdAt.localeCompare(left.createdAt) || left.roomId.localeCompare(right.roomId)
        );
      });

    const cursorIndex = options.cursor
      ? rooms.findIndex((room) => room.roomId === options.cursor)
      : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageItems = rooms.slice(startIndex, startIndex + options.limit);
    const hasNextPage = startIndex + pageItems.length < rooms.length;

    return {
      items: structuredClone(pageItems),
      nextCursor: hasNextPage ? (pageItems.at(-1)?.roomId ?? null) : null,
    };
  }

  save(snapshot: RoomSnapshot, options: SaveRoomOptions = {}): void {
    this.rooms.set(snapshot.room.roomId, {
      snapshot: structuredClone(snapshot),
      inviteCodeDigest: options.inviteCode ? digestInviteCode(options.inviteCode) : null,
    });
  }

  canAccess(roomId: string, inviteCode?: string): boolean {
    const storedRoom = this.rooms.get(roomId);
    if (!storedRoom) {
      return false;
    }

    if (storedRoom.snapshot.room.visibility === "public") {
      return true;
    }

    if (!storedRoom.inviteCodeDigest || !inviteCode) {
      return false;
    }

    return timingSafeEqual(storedRoom.inviteCodeDigest, digestInviteCode(inviteCode));
  }

  isSeated(roomId: string, userId: string): boolean {
    const storedRoom = this.rooms.get(roomId);
    return storedRoom?.snapshot.seats.some((seat) => seat.occupant?.userId === userId) ?? false;
  }
}
