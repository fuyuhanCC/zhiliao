import type { SummaryUpdatedData } from "@zhiliao/shared";
import type { components } from "@zhiliao/shared/openapi";

import type { RoomEventBus } from "../../realtime/room-event-bus.js";
import type { RoomStore } from "../../stores/room-store.js";
import type { SpeechTurn, SpeechTurnStore } from "../../stores/speech-turn-store.js";
import type { SummaryResource, SummaryStore } from "../../stores/summary-store.js";
import type { SummaryDraft, ZhidaSummaryClient } from "./zhihu-zhida-client.js";

type DebateSummary = components["schemas"]["DebateSummary"];

export class SummaryRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SummaryRequestError";
  }
}

export interface SummaryServiceOptions {
  roomStore: RoomStore;
  speechTurnStore: SpeechTurnStore;
  summaryStore: SummaryStore;
  client: ZhidaSummaryClient | null;
  eventBus?: RoomEventBus;
  now?: () => Date;
  onBackgroundError?: (error: unknown) => void;
}

export interface StartSummaryResult {
  statusCode: 200 | 202;
  resource: SummaryResource;
}

function emptySummaryResource(): SummaryResource {
  return {
    status: "empty",
    summaryVersion: 0,
    sourceTranscriptVersion: 0,
    summary: null,
    failureCode: null,
    updatedAt: null,
  };
}

function fallbackSummaryText(turn: SpeechTurn): string {
  const text = turn.transcript?.text?.trim() ?? "";
  return text.length <= 160 ? text : `${text.slice(0, 157)}…`;
}

export class SummaryService {
  private readonly now: () => Date;
  private readonly inFlightRooms = new Set<string>();

  constructor(private readonly options: SummaryServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  get(roomId: string): SummaryResource {
    return this.options.summaryStore.get(roomId) ?? emptySummaryResource();
  }

  start(roomId: string): StartSummaryResult {
    const snapshot = this.options.roomStore.get(roomId);
    if (!snapshot || snapshot.room.status === "closed") {
      throw new SummaryRequestError(404, "ROOM_NOT_FOUND", "房间不存在或已回收");
    }
    if (!this.options.client) {
      throw new SummaryRequestError(502, "SUMMARY_UNAVAILABLE", "知乎直答服务尚未配置");
    }

    const turns = this.options.speechTurnStore.listReady(roomId);
    const transcriptVersion = this.options.speechTurnStore.getTranscriptVersion(roomId);
    const current = this.get(roomId);
    if (turns.length === 0) {
      return {
        statusCode: 200,
        resource: current.status === "empty" ? current : emptySummaryResource(),
      };
    }
    if (current.status === "ready" && current.sourceTranscriptVersion === transcriptVersion) {
      return { statusCode: 200, resource: current };
    }
    if (this.inFlightRooms.has(roomId)) {
      return { statusCode: 202, resource: current };
    }

    const processing: SummaryResource = {
      status: "processing",
      summaryVersion: current.summaryVersion,
      sourceTranscriptVersion: transcriptVersion,
      summary: current.summary,
      failureCode: null,
      updatedAt: this.now().toISOString(),
    };
    this.options.summaryStore.save(roomId, processing);
    this.publish(roomId, processing);
    this.inFlightRooms.add(roomId);
    void this.process(
      roomId,
      snapshot.room.topic.title,
      turns,
      transcriptVersion,
      current.summaryVersion,
    ).catch((error) => this.options.onBackgroundError?.(error));
    return { statusCode: 202, resource: processing };
  }

  private async process(
    roomId: string,
    topicTitle: string,
    turns: SpeechTurn[],
    transcriptVersion: number,
    previousSummaryVersion: number,
  ): Promise<void> {
    try {
      const draft = await this.options.client!.generate(topicTitle, turns);
      const resource: SummaryResource = {
        status: "ready",
        summaryVersion: previousSummaryVersion + 1,
        sourceTranscriptVersion: transcriptVersion,
        summary: this.toDebateSummary(topicTitle, turns, draft),
        failureCode: null,
        updatedAt: this.now().toISOString(),
      };
      this.options.summaryStore.save(roomId, resource);
      this.publish(roomId, resource);
    } catch (error) {
      const resource: SummaryResource = {
        status: "failed",
        summaryVersion: previousSummaryVersion,
        sourceTranscriptVersion: transcriptVersion,
        summary: this.get(roomId).summary,
        failureCode: "SUMMARY_FAILED",
        updatedAt: this.now().toISOString(),
      };
      this.options.summaryStore.save(roomId, resource);
      this.publish(roomId, resource);
      throw error;
    } finally {
      this.inFlightRooms.delete(roomId);
    }
  }

  private toDebateSummary(
    topicTitle: string,
    turns: SpeechTurn[],
    draft: SummaryDraft,
  ): DebateSummary {
    const turnById = new Map(turns.map((turn) => [turn.speechTurnId, turn]));
    const speakerById = new Map(turns.map((turn) => [turn.speaker.userId, turn.speaker]));
    const viewpoints = draft.viewpoints.flatMap((viewpoint) => {
      const speaker = speakerById.get(viewpoint.speakerUserId);
      if (!speaker) {
        return [];
      }
      const speechTurnIds = viewpoint.speechTurnIds.filter(
        (id) => turnById.get(id)?.speaker.userId === viewpoint.speakerUserId,
      );
      return speechTurnIds.length > 0
        ? [{ speaker, summary: viewpoint.summary, speechTurnIds }]
        : [];
    });
    const normalizedViewpoints =
      viewpoints.length > 0
        ? viewpoints
        : [...speakerById.values()].map((speaker) => {
            const speakerTurns = turns.filter((turn) => turn.speaker.userId === speaker.userId);
            return {
              speaker,
              summary: speakerTurns.map(fallbackSummaryText).filter(Boolean).join(" "),
              speechTurnIds: speakerTurns.map((turn) => turn.speechTurnId),
            };
          });
    const timelineSummaryById = new Map(
      draft.timeline
        .filter((item) => turnById.has(item.speechTurnId))
        .map((item) => [item.speechTurnId, item.summary]),
    );

    return {
      topicTitle,
      overview: draft.overview,
      viewpoints: normalizedViewpoints,
      agreements: draft.agreements,
      disagreements: draft.disagreements,
      openQuestions: draft.openQuestions,
      timeline: turns.map((turn) => ({
        speechTurnId: turn.speechTurnId,
        speaker: turn.speaker,
        summary: timelineSummaryById.get(turn.speechTurnId) ?? fallbackSummaryText(turn),
        startedAt: turn.startedAt,
      })),
    };
  }

  private publish(roomId: string, resource: SummaryResource): void {
    if (!resource.updatedAt) {
      return;
    }
    const data: SummaryUpdatedData = {
      status: resource.status,
      summaryVersion: resource.summaryVersion,
      sourceTranscriptVersion: resource.sourceTranscriptVersion,
      updatedAt: resource.updatedAt,
    };
    this.options.eventBus?.publish({ name: "summary:updated", roomId, data });
  }
}
