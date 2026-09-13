import type { components } from "@zhiliao/shared/openapi";
import { describe, expect, it, vi } from "vitest";

import { RoomMaterialService } from "./room-material-service.js";
import type { ZhihuSearchClient, ZhihuSearchItem } from "./zhihu-search-client.js";

type Topic = components["schemas"]["Topic"];

const manualTopic: Topic = {
  source: "manual",
  title: "RAG 是否被高估",
  zhihuQuestionId: null,
  zhihuUrl: null,
  excerpt: null,
  imageUrl: null,
  answerExcerpts: [],
  hotRank: null,
};

function createSearchItem(overrides: Partial<ZhihuSearchItem> = {}): ZhihuSearchItem {
  return {
    title: "一篇相关资料",
    contentType: "Article",
    contentId: "article-1",
    contentText: "<em>RAG</em> &amp; 检索增强生成的讨论",
    url: "https://zhuanlan.zhihu.com/p/123?utm_source=openapi",
    commentCount: 12,
    voteUpCount: 100,
    authorName: "测试作者",
    authorAvatarUrl: "https://picx.zhimg.com/avatar.jpg",
    editTimeSeconds: 1_710_000_000,
    ...overrides,
  };
}

describe("RoomMaterialService", () => {
  it("filters non-content results, normalizes excerpts and caches by topic", async () => {
    const search = vi.fn(async () => ({
      items: [
        createSearchItem(),
        createSearchItem({
          contentId: "user-1",
          contentType: "People",
          url: "https://www.zhihu.com/people/test",
        }),
        createSearchItem({
          contentId: "external-1",
          url: "https://example.com/article",
        }),
      ],
      hasMore: false,
      searchHashId: "search-1",
    }));
    const client: ZhihuSearchClient = { search };
    const service = new RoomMaterialService({
      client,
      now: () => new Date("2026-09-13T08:00:00.000Z"),
    });

    const first = await service.list("room-1", manualTopic, 5);
    const second = await service.list("room-2", manualTopic, 1);

    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("RAG 是否被高估", 10);
    expect(first).toMatchObject({
      roomId: "room-1",
      query: "RAG 是否被高估",
      source: "zhihu",
      fetchedAt: "2026-09-13T08:00:00.000Z",
      items: [
        {
          materialId: "article_article-1",
          title: "一篇相关资料",
          excerpt: "RAG & 检索增强生成的讨论",
          zhihuUrl: "https://zhuanlan.zhihu.com/p/123?utm_source=openapi",
          publishedAt: "2024-03-09T16:00:00.000Z",
        },
      ],
    });
    expect(second.source).toBe("cache");
    expect(second.items).toHaveLength(1);
  });

  it("keeps the original Zhihu topic first and uses it as a failure fallback", async () => {
    const client: ZhihuSearchClient = {
      search: vi.fn(async () => {
        throw new Error("upstream unavailable");
      }),
    };
    const service = new RoomMaterialService({
      client,
      now: () => new Date("2026-09-13T08:00:00.000Z"),
    });
    const topic: Topic = {
      ...manualTopic,
      source: "zhihu_question",
      title: "一个知乎问题",
      zhihuQuestionId: "123456",
      zhihuUrl: "https://www.zhihu.com/question/123456",
      excerpt: "问题背景",
    };

    const result = await service.list("room-1", topic, 5);

    expect(result.source).toBe("fallback");
    expect(result.items).toEqual([
      expect.objectContaining({
        materialId: "question_123456",
        title: "一个知乎问题",
        zhihuUrl: "https://www.zhihu.com/question/123456",
      }),
    ]);
  });
});
