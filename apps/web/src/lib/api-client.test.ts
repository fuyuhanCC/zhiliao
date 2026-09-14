import { afterEach, describe, expect, it, vi } from "vitest";

import { createRoom, ensureSession, listRooms } from "./api-client";

const sessionResponse = {
  user: {
    userId: "guest_1",
    identityType: "guest",
    displayName: "测试访客",
    avatarUrl: null,
    level: 1,
    levelTitle: "蛰伏",
  },
  account: {
    coinBalance: 100,
    experience: 0,
    level: 1,
    levelTitle: "蛰伏",
    nextLevelExperience: 500,
  },
  permissions: {
    canCreateRoom: false,
    canRequestSeat: false,
    canSpeak: false,
  },
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("creates a guest session when the session cookie is missing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "AUTH_REQUIRED",
              message: "缺少或失效会话",
              details: {},
              requestId: "request-1",
            },
          },
          401,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(sessionResponse, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ensureSession()).resolves.toEqual(sessionResponse);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/session",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/guest",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("uses the room type query and includes cookies", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    await listRooms("hot");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/rooms?type=hot&limit=20",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("surfaces the stable API error code and sends an idempotency key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "ZHIHU_LOGIN_REQUIRED",
            message: "需要登录知乎后才能创建房间",
            details: {},
            requestId: "request-2",
          },
        },
        403,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = createRoom("一个测试话题");
    await expect(result).rejects.toMatchObject({
      status: 403,
      code: "ZHIHU_LOGIN_REQUIRED",
      requestId: "request-2",
    });

    const requestInit = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    expect(requestInit?.body).toBe(
      JSON.stringify({ topic: { source: "manual", title: "一个测试话题" } }),
    );
  });
});
