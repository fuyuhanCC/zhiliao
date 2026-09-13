import { createHash } from "node:crypto";

import type { components } from "@zhiliao/shared/openapi";

import type { RoomSnapshot, RoomStore } from "../../stores/room-store.js";
import type { ZhihuHotListClient, ZhihuHotListItem } from "./zhihu-hot-list-client.js";

type HotTopicPage = components["schemas"]["HotTopicPage"];
type Topic = components["schemas"]["Topic"];

type HotTopicSource = HotTopicPage["source"];

interface CachedHotTopics {
  topics: Topic[];
  origin: "zhihu" | "fallback";
  fetchedAt: string;
  expiresAtMilliseconds: number;
}

interface LoadedHotTopics {
  topics: Topic[];
  source: HotTopicSource;
  fetchedAt: string;
}

export interface ListHotTopicsOptions {
  cursor?: string;
  limit: number;
}

export interface HotTopicRoomServiceOptions {
  roomStore: RoomStore;
  client: ZhihuHotListClient | null;
  cacheTtlMilliseconds?: number;
  now?: () => Date;
}

export class InvalidHotTopicCursorError extends Error {
  constructor() {
    super("热榜游标无效");
    this.name = "InvalidHotTopicCursorError";
  }
}

const fallbackTitles = [
  "AI 时代，大学生还应该学习编程吗？",
  "年轻人应该优先选择大城市还是小城市？",
  "面对争议，表达态度是否比保持沉默更重要？",
  "效率工具让人更自由，还是让人更忙碌？",
  "网络讨论应该更重视立场还是事实？",
] as const;

function normalizePlainText(value: string, maximumLength: number): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function zhihuUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname === "zhihu.com" || hostname.endsWith(".zhihu.com") ? url : null;
  } catch {
    return null;
  }
}

function optionalUrl(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function questionIdFrom(url: URL): string | null {
  return url.pathname.match(/\/question\/(\d+)/)?.[1] ?? null;
}

function mapHotListItem(item: ZhihuHotListItem, index: number): Topic | null {
  const url = zhihuUrl(item.url);
  const title = normalizePlainText(item.title, 200);
  if (!url || !title) {
    return null;
  }

  const excerpt = normalizePlainText(item.summary, 2000);
  return {
    source: "zhihu_hot",
    title,
    zhihuQuestionId: questionIdFrom(url),
    zhihuUrl: url.toString(),
    excerpt: excerpt || null,
    imageUrl: optionalUrl(item.thumbnailUrl),
    answerExcerpts: [],
    hotRank: index + 1,
  };
}

function createFallbackTopics(): Topic[] {
  return fallbackTitles.map((title, index) => ({
    source: "manual",
    title,
    zhihuQuestionId: null,
    zhihuUrl: null,
    excerpt: null,
    imageUrl: null,
    answerExcerpts: [],
    hotRank: index + 1,
  }));
}

function canonicalTopicIdentity(topic: Topic): string {
  if (topic.zhihuUrl) {
    const url = new URL(topic.zhihuUrl);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  }
  return `fallback:${topic.title}`;
}

function roomIdForTopic(topic: Topic): string {
  const digest = createHash("sha256")
    .update(canonicalTopicIdentity(topic))
    .digest("hex")
    .slice(0, 20);
  return `hot_${digest}`;
}

function topicChanged(left: Topic, right: Topic): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function encodeCursor(offset: number): string {
  return Buffer.from(`hot:${offset}`).toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }

  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const match = /^hot:(\d+)$/.exec(decoded);
    if (!match) {
      throw new InvalidHotTopicCursorError();
    }
    const offset = Number(match[1]);
    if (!Number.isSafeInteger(offset)) {
      throw new InvalidHotTopicCursorError();
    }
    return offset;
  } catch (error) {
    if (error instanceof InvalidHotTopicCursorError) {
      throw error;
    }
    throw new InvalidHotTopicCursorError();
  }
}

export class HotTopicRoomService {
  private readonly cacheTtlMilliseconds: number;
  private readonly now: () => Date;
  private cache: CachedHotTopics | undefined;
  private refreshPromise: Promise<LoadedHotTopics> | undefined;

  constructor(private readonly options: HotTopicRoomServiceOptions) {
    this.cacheTtlMilliseconds = options.cacheTtlMilliseconds ?? 5 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  async list(options: ListHotTopicsOptions): Promise<HotTopicPage> {
    const loaded = await this.load();
    const offset = decodeCursor(options.cursor);
    const items = loaded.topics.slice(offset, offset + options.limit);
    const nextOffset = offset + items.length;

    return {
      items: structuredClone(items),
      nextCursor: nextOffset < loaded.topics.length ? encodeCursor(nextOffset) : null,
      source: loaded.source,
      fetchedAt: loaded.fetchedAt,
    };
  }

  async ensureRooms(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<LoadedHotTopics> {
    const now = this.now();
    if (this.cache && this.cache.expiresAtMilliseconds > now.getTime()) {
      this.syncOfficialRooms(this.cache.topics, now);
      return {
        topics: this.cache.topics,
        source: this.cache.origin === "zhihu" ? "cache" : "fallback",
        fetchedAt: this.cache.fetchedAt,
      };
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh(now).finally(() => {
        this.refreshPromise = undefined;
      });
    }
    return this.refreshPromise;
  }

  private async refresh(now: Date): Promise<LoadedHotTopics> {
    if (this.options.client) {
      try {
        const result = await this.options.client.list(30);
        const topics = result.items
          .map(mapHotListItem)
          .filter((topic): topic is Topic => topic !== null);
        if (topics.length > 0) {
          const fetchedAt = now.toISOString();
          this.cache = {
            topics,
            origin: "zhihu",
            fetchedAt,
            expiresAtMilliseconds: now.getTime() + this.cacheTtlMilliseconds,
          };
          this.syncOfficialRooms(topics, now);
          return { topics, source: "zhihu", fetchedAt };
        }
        throw new Error("知乎热榜没有可用条目");
      } catch {
        if (this.cache?.topics.length) {
          this.cache.expiresAtMilliseconds =
            now.getTime() + Math.min(this.cacheTtlMilliseconds, 60_000);
          this.syncOfficialRooms(this.cache.topics, now);
          return {
            topics: this.cache.topics,
            source: "cache",
            fetchedAt: this.cache.fetchedAt,
          };
        }
      }
    }

    const topics = createFallbackTopics();
    const fetchedAt = now.toISOString();
    this.cache = {
      topics,
      origin: "fallback",
      fetchedAt,
      expiresAtMilliseconds:
        now.getTime() +
        (this.options.client
          ? Math.min(this.cacheTtlMilliseconds, 60_000)
          : this.cacheTtlMilliseconds),
    };
    this.syncOfficialRooms(topics, now);
    return { topics, source: "fallback", fetchedAt };
  }

  private syncOfficialRooms(topics: Topic[], now: Date): void {
    const currentRoomIds = new Set<string>();

    for (const topic of topics) {
      const roomId = roomIdForTopic(topic);
      currentRoomIds.add(roomId);
      const existing = this.options.roomStore.get(roomId);
      if (existing) {
        if (existing.room.type === "hot" && topicChanged(existing.room.topic, topic)) {
          existing.room.topic = structuredClone(topic);
          existing.room.version += 1;
          this.options.roomStore.update(existing);
        }
        continue;
      }

      const snapshot: RoomSnapshot = {
        room: {
          roomId,
          type: "hot",
          status: "active",
          visibility: "public",
          topic: structuredClone(topic),
          creator: null,
          onlineCount: 0,
          seatedCount: 0,
          createdAt: now.toISOString(),
          version: 1,
        },
        seats: Array.from({ length: 6 }, (_, index) => ({
          seatNumber: index + 1,
          occupant: null,
        })),
        queue: [],
        speakerLock: null,
        cooldowns: [],
      };
      this.options.roomStore.save(snapshot);
    }

    const existingHotRooms = this.options.roomStore.list({ type: "hot", limit: 1000 }).items;
    for (const room of existingHotRooms) {
      if (currentRoomIds.has(room.roomId) || room.onlineCount > 0 || room.seatedCount > 0) {
        continue;
      }
      const snapshot = this.options.roomStore.get(room.roomId);
      if (!snapshot?.speakerLock) {
        this.options.roomStore.remove(room.roomId);
      }
    }
  }
}
