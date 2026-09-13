import { EventEmitter } from "node:events";

import type { SummaryUpdatedData, TranscriptUpdatedData } from "@zhiliao/shared";

export type DerivedRoomEvent =
  | {
      name: "transcript:updated";
      roomId: string;
      data: TranscriptUpdatedData;
    }
  | {
      name: "summary:updated";
      roomId: string;
      data: SummaryUpdatedData;
    };

export type DerivedRoomEventListener = (event: DerivedRoomEvent) => void;

export class RoomEventBus {
  private readonly emitter = new EventEmitter();

  publish(event: DerivedRoomEvent): void {
    this.emitter.emit("event", structuredClone(event));
  }

  subscribe(listener: DerivedRoomEventListener): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
