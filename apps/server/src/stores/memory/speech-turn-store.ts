import type {
  ListSpeechTurnsOptions,
  SpeechTurn,
  SpeechTurnPage,
  SpeechTurnStore,
} from "../speech-turn-store.js";

export class MemorySpeechTurnStore implements SpeechTurnStore {
  private readonly turnsByRoom = new Map<string, SpeechTurn[]>();
  private readonly transcriptVersionByRoom = new Map<string, number>();

  create(roomId: string, speechTurn: SpeechTurn): void {
    const turns = this.turnsByRoom.get(roomId) ?? [];
    if (turns.some((turn) => turn.speechTurnId === speechTurn.speechTurnId)) {
      return;
    }
    turns.push(structuredClone(speechTurn));
    this.turnsByRoom.set(roomId, turns);
  }

  get(roomId: string, speechTurnId: string): SpeechTurn | undefined {
    const turn = this.turnsByRoom
      .get(roomId)
      ?.find((candidate) => candidate.speechTurnId === speechTurnId);
    return turn ? structuredClone(turn) : undefined;
  }

  update(roomId: string, speechTurn: SpeechTurn): boolean {
    const turns = this.turnsByRoom.get(roomId);
    const index = turns?.findIndex(
      (candidate) => candidate.speechTurnId === speechTurn.speechTurnId,
    );
    if (!turns || index === undefined || index < 0) {
      return false;
    }
    const previous = turns[index];
    turns[index] = structuredClone(speechTurn);
    if (
      speechTurn.transcript?.status === "ready" &&
      (previous?.transcript?.status !== "ready" ||
        previous.transcript.text !== speechTurn.transcript.text)
    ) {
      this.transcriptVersionByRoom.set(roomId, (this.transcriptVersionByRoom.get(roomId) ?? 0) + 1);
    }
    return true;
  }

  list(roomId: string, options: ListSpeechTurnsOptions): SpeechTurnPage {
    const turns = this.turnsByRoom.get(roomId) ?? [];
    const cursorIndex = options.cursor
      ? turns.findIndex((turn) => turn.speechTurnId === options.cursor)
      : turns.length;
    const endIndex = cursorIndex >= 0 ? cursorIndex : turns.length;
    const startIndex = Math.max(0, endIndex - options.limit);
    const items = turns.slice(startIndex, endIndex);

    return {
      items: structuredClone(items),
      nextCursor: startIndex > 0 ? (items[0]?.speechTurnId ?? null) : null,
      transcriptVersion: this.transcriptVersionByRoom.get(roomId) ?? 0,
    };
  }

  listReady(roomId: string): SpeechTurn[] {
    return structuredClone(
      (this.turnsByRoom.get(roomId) ?? []).filter(
        (turn) => turn.transcript?.status === "ready" && Boolean(turn.transcript.text),
      ),
    );
  }

  getTranscriptVersion(roomId: string): number {
    return this.transcriptVersionByRoom.get(roomId) ?? 0;
  }
}
