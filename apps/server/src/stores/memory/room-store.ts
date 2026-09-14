import type {
  ListRoomsOptions,
  RoomListResult,
  RoomSnapshot,
  RoomStore,
} from "../room-store.js";

export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, RoomSnapshot>();

  get(roomId: string): RoomSnapshot | undefined {
    const snapshot = this.rooms.get(roomId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  list(options: ListRoomsOptions): RoomListResult {
    const rooms = [...this.rooms.values()]
      .map((snapshot) => snapshot.room)
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

  save(snapshot: RoomSnapshot): void {
    this.rooms.set(snapshot.room.roomId, structuredClone(snapshot));
  }

  update(snapshot: RoomSnapshot): boolean {
    if (!this.rooms.has(snapshot.room.roomId)) {
      return false;
    }

    this.rooms.set(snapshot.room.roomId, structuredClone(snapshot));
    return true;
  }

  remove(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  isSeated(roomId: string, userId: string): boolean {
    const snapshot = this.rooms.get(roomId);
    return snapshot?.seats.some((seat) => seat.occupant?.userId === userId) ?? false;
  }
}
