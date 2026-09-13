import { describe, expect, it, vi } from "vitest";

import { HttpZhihuSearchClient, ZhihuSearchUpstreamError } from "./zhihu-search-client.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

const successfulResponse = {
  Code: 0,
  Message: "success",
  Data: {
    HasMore: false,
    SearchHashId: "search-1",
    Items: [
      {
        Title: "RAG 评测方法综述",
        ContentType: "Article",
        ContentID: "123456789",
        ContentText: "本文介绍主流评测框架",
        Url: "https://zhuanlan.zhihu.com/p/123456789?utm_source=openapi",
        CommentCount: 15,
        VoteUpCount: 128,
        AuthorName: "张三",
        AuthorAvatar: "https://picx.zhimg.com/avatar.jpg",
        EditTime: 1_710_000_000,
      },
    ],
  },
};

describe("HttpZhihuSearchClient", () => {
  it("calls the official endpoint with Bearer authentication and maps results", async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchInit): Promise<Response> =>
      Response.json(successfulResponse, {
        status: 200,
      }),
    );
    const client = new HttpZhihuSearchClient({
      baseUrl: "https://developer.zhihu.com/api/v1",
      accessSecret: "test-access-secret",
      now: () => new Date("2026-09-13T08:00:00.000Z"),
      fetchImpl,
    });

    const result = await client.search("RAG 评测", 5);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [requestedUrl, init] = firstCall!;
    expect(requestedUrl).toBeInstanceOf(URL);
    const url = requestedUrl as URL;
    expect(url.toString()).toBe(
      "https://developer.zhihu.com/api/v1/content/zhihu_search?Query=RAG+%E8%AF%84%E6%B5%8B&Count=5",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-access-secret");
    expect(headers.get("X-Request-Timestamp")).toBe("1789286400");
    expect(result).toEqual({
      hasMore: false,
      searchHashId: "search-1",
      items: [
        {
          title: "RAG 评测方法综述",
          contentType: "Article",
          contentId: "123456789",
          contentText: "本文介绍主流评测框架",
          url: "https://zhuanlan.zhihu.com/p/123456789?utm_source=openapi",
          commentCount: 15,
          voteUpCount: 128,
          authorName: "张三",
          authorAvatarUrl: "https://picx.zhimg.com/avatar.jpg",
          editTimeSeconds: 1_710_000_000,
        },
      ],
    });
  });

  it("caps Count at ten and translates upstream business errors", async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchInit): Promise<Response> =>
      Response.json({ Code: 30001, Message: "频率限制" }, { status: 200 }),
    );
    const client = new HttpZhihuSearchClient({
      baseUrl: "https://developer.zhihu.com/api/v1/",
      accessSecret: "test-access-secret",
      fetchImpl,
    });

    await expect(client.search("测试", 99)).rejects.toEqual(
      expect.objectContaining<Partial<ZhihuSearchUpstreamError>>({
        name: "ZhihuSearchUpstreamError",
        message: "频率限制",
        upstreamCode: 30001,
      }),
    );
    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [requestedUrl] = firstCall!;
    expect((requestedUrl as URL).searchParams.get("Count")).toBe("10");
  });
});
