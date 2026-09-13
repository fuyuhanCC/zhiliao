import type { components } from "@zhiliao/shared/openapi";

import type { ZhihuSearchClient, ZhihuSearchItem } from "./zhihu-search-client.js";

type RoomMaterial = components["schemas"]["RoomMaterial"];
type RoomMaterialPage = components["schemas"]["RoomMaterialPage"];
type Topic = components["schemas"]["Topic"];

interface CachedSearch {
  items: RoomMaterial[];
  fetchedAt: string;
  expiresAtMilliseconds: number;
}

export interface RoomMaterialServiceOptions {
  client: ZhihuSearchClient;
  cacheTtlMilliseconds?: number;
  now?: () => Date;
}

const supportedContentTypes = new Set(["question", "answer", "article"]);

function normalizePlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isZhihuContentUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "zhihu.com" || hostname.endsWith(".zhihu.com");
  } catch {
    return false;
  }
}

function canonicalUrlKey(value: string): string {
  const url = new URL(value);
  return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
}

function optionalUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function mapSearchItem(item: ZhihuSearchItem): RoomMaterial | null {
  if (!supportedContentTypes.has(item.contentType.toLowerCase()) || !isZhihuContentUrl(item.url)) {
    return null;
  }

  const title = normalizePlainText(item.title);
  if (!title) {
    return null;
  }

  const excerpt = normalizePlainText(item.contentText).slice(0, 500);
  const publishedDate =
    item.editTimeSeconds === null ? null : new Date(item.editTimeSeconds * 1000);
  const publishedAt =
    publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate.toISOString() : null;

  return {
    materialId: `${item.contentType.toLowerCase()}_${item.contentId}`,
    title,
    excerpt: excerpt || null,
    zhihuUrl: item.url,
    contentType: item.contentType,
    authorName: item.authorName?.trim() || null,
    authorAvatarUrl: optionalUrl(item.authorAvatarUrl),
    voteUpCount: item.voteUpCount,
    commentCount: item.commentCount,
    publishedAt,
  };
}

function createOriginalTopicMaterial(topic: Topic): RoomMaterial | null {
  if (!topic.zhihuUrl || !isZhihuContentUrl(topic.zhihuUrl)) {
    return null;
  }

  return {
    materialId: topic.zhihuQuestionId ? `question_${topic.zhihuQuestionId}` : "topic_original",
    title: topic.title,
    excerpt: topic.excerpt ? normalizePlainText(topic.excerpt).slice(0, 500) || null : null,
    zhihuUrl: topic.zhihuUrl,
    contentType: topic.source === "zhihu_question" ? "Question" : "Topic",
    authorName: null,
    authorAvatarUrl: null,
    voteUpCount: null,
    commentCount: null,
    publishedAt: null,
  };
}

function mergeMaterials(topic: Topic, searchItems: RoomMaterial[], limit: number): RoomMaterial[] {
  const merged = [createOriginalTopicMaterial(topic), ...searchItems].filter(
    (item): item is RoomMaterial => item !== null,
  );
  const seenUrls = new Set<string>();

  return merged
    .filter((item) => {
      const key = canonicalUrlKey(item.zhihuUrl);
      if (seenUrls.has(key)) {
        return false;
      }
      seenUrls.add(key);
      return true;
    })
    .slice(0, limit);
}

export class RoomMaterialService {
  private readonly cacheTtlMilliseconds: number;
  private readonly now: () => Date;
  private readonly cache = new Map<string, CachedSearch>();

  constructor(private readonly options: RoomMaterialServiceOptions) {
    this.cacheTtlMilliseconds = options.cacheTtlMilliseconds ?? 10 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  async list(roomId: string, topic: Topic, limit: number): Promise<RoomMaterialPage> {
    const query = topic.title.trim();
    const cacheKey = query.toLocaleLowerCase("zh-CN");
    const cached = this.cache.get(cacheKey);
    const now = this.now();

    if (cached && cached.expiresAtMilliseconds > now.getTime()) {
      return {
        roomId,
        query,
        items: mergeMaterials(topic, cached.items, limit),
        source: "cache",
        fetchedAt: cached.fetchedAt,
      };
    }

    try {
      const result = await this.options.client.search(query, 10);
      const items = result.items
        .map(mapSearchItem)
        .filter((item): item is RoomMaterial => item !== null);
      const fetchedAt = now.toISOString();
      this.cache.set(cacheKey, {
        items,
        fetchedAt,
        expiresAtMilliseconds: now.getTime() + this.cacheTtlMilliseconds,
      });

      return {
        roomId,
        query,
        items: mergeMaterials(topic, items, limit),
        source: "zhihu",
        fetchedAt,
      };
    } catch (error) {
      if (cached) {
        return {
          roomId,
          query,
          items: mergeMaterials(topic, cached.items, limit),
          source: "cache",
          fetchedAt: cached.fetchedAt,
        };
      }

      const originalTopic = createOriginalTopicMaterial(topic);
      if (originalTopic) {
        return {
          roomId,
          query,
          items: [originalTopic].slice(0, limit),
          source: "fallback",
          fetchedAt: now.toISOString(),
        };
      }

      throw error;
    }
  }
}
