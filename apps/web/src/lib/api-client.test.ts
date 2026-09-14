import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRoom,
  createRtcCredentials,
  ensureSession,
  generateRoomSummary,
  getRoom,
  getRoomSummary,
  listRoomMaterials,
  listRoomMessages,
  listRooms,
  listSpeechTurns,
  logoutSession,
} from "./api-client";

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

  it("logs out through the session endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await logoutSession();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
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

  it("builds the room resource URLs from the room id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await getRoom("room 1");
    await createRtcCredentials("room 1");
    await listRoomMaterials("room 1");
    await listRoomMessages("room 1");
    await listSpeechTurns("room 1");
    await getRoomSummary("room 1");
    await generateRoomSummary("room 1");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/rooms/room%201",
      "/api/v1/rooms/room%201/rtc-credentials",
      "/api/v1/rooms/room%201/materials?limit=5",
      "/api/v1/rooms/room%201/messages?limit=30",
      "/api/v1/rooms/room%201/speech-turns?limit=50",
      "/api/v1/rooms/room%201/summary",
      "/api/v1/rooms/room%201/summary/generate",
    ]);
    const rtcRequest = fetchMock.mock.calls[1]?.[1];
    expect(rtcRequest?.method).toBe("POST");
    expect(rtcRequest?.body).toBe(JSON.stringify({}));
    expect(new Headers(rtcRequest?.headers).get("Idempotency-Key")).toBeTruthy();

    const summaryRequest = fetchMock.mock.calls[6]?.[1];
    expect(summaryRequest?.method).toBe("POST");
    expect(new Headers(summaryRequest?.headers).get("Idempotency-Key")).toBeTruthy();
  });
});
