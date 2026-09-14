import type { components } from "@zhiliao/shared/openapi";

export type RoomSnapshot = components["schemas"]["RoomSnapshot"];
export type Room = components["schemas"]["Room"];
export type RoomType = components["schemas"]["RoomType"];

export interface ListRoomsOptions {
  type?: RoomType;
  cursor?: string;
  limit: number;
}

export interface RoomListResult {
  items: Room[];
  nextCursor: string | null;
}

export interface RoomStore {
  get(roomId: string): RoomSnapshot | undefined;
  list(options: ListRoomsOptions): RoomListResult;
  save(snapshot: RoomSnapshot): void;
  update(snapshot: RoomSnapshot): boolean;
  remove(roomId: string): boolean;
  isSeated(roomId: string, userId: string): boolean;
}
