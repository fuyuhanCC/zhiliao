import { describe, expect, it, vi } from "vitest";

import { HttpZhihuHotListClient, ZhihuHotListUpstreamError } from "./zhihu-hot-list-client.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

const successfulResponse = {
  Code: 0,
  Message: "success",
  Data: {
    Total: 2,
    Items: [
      {
        Title: "如何评价某个热点问题？",
        Url: "https://www.zhihu.com/question/123456789",
        ThumbnailUrl: "https://pic1.zhimg.com/hot.jpg",
        Summary: "这是该问题的内容摘要",
      },
      {
        Title: "一篇正在热榜上的文章标题",
        Url: "https://zhuanlan.zhihu.com/p/987654321",
        ThumbnailUrl: "",
        Summary: "",
      },
    ],
  },
};

describe("HttpZhihuHotListClient", () => {
  it("calls the official hot-list endpoint and maps its documented fields", async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchInit): Promise<Response> =>
      Response.json(successfulResponse, { status: 200 }),
    );
    const client = new HttpZhihuHotListClient({
      baseUrl: "https://developer.zhihu.com/api/v1",
      accessSecret: "test-access-secret",
      now: () => new Date("2026-09-13T08:00:00.000Z"),
      fetchImpl,
    });

    const result = await client.list(10);

    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [requestedUrl, init] = firstCall!;
    expect((requestedUrl as URL).toString()).toBe(
      "https://developer.zhihu.com/api/v1/content/hot_list?Limit=10",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-access-secret");
    expect(headers.get("X-Request-Timestamp")).toBe("1789286400");
    expect(result).toEqual({
      total: 2,
      items: [
        {
          title: "如何评价某个热点问题？",
          url: "https://www.zhihu.com/question/123456789",
          thumbnailUrl: "https://pic1.zhimg.com/hot.jpg",
          summary: "这是该问题的内容摘要",
        },
        {
          title: "一篇正在热榜上的文章标题",
          url: "https://zhuanlan.zhihu.com/p/987654321",
          thumbnailUrl: "",
          summary: "",
        },
      ],
    });
  });

  it("caps Limit at thirty and translates upstream business errors", async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchInit): Promise<Response> =>
      Response.json({ Code: 30001, Message: "频率限制" }, { status: 200 }),
    );
    const client = new HttpZhihuHotListClient({
      baseUrl: "https://developer.zhihu.com/api/v1/",
      accessSecret: "test-access-secret",
      fetchImpl,
    });

    await expect(client.list(99)).rejects.toEqual(
      expect.objectContaining<Partial<ZhihuHotListUpstreamError>>({
        name: "ZhihuHotListUpstreamError",
        message: "频率限制",
        upstreamCode: 30001,
      }),
    );
    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect((firstCall![0] as URL).searchParams.get("Limit")).toBe("30");
  });
});
