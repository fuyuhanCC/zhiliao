import type { components } from "@zhiliao/shared/openapi";

import { runtimeConfig } from "./runtime-config";

export type HealthResponse = components["schemas"]["HealthResponse"];
export type SessionResponse = components["schemas"]["SessionResponse"];
export type Room = components["schemas"]["Room"];
export type RoomPage = components["schemas"]["RoomPage"];
export type RoomType = components["schemas"]["RoomType"];
export type RoomSnapshot = components["schemas"]["RoomSnapshot"];
export type RtcCredentials = components["schemas"]["RtcCredentials"];
export type RoomMaterial = components["schemas"]["RoomMaterial"];
export type RoomMaterialPage = components["schemas"]["RoomMaterialPage"];
export type ChatMessage = components["schemas"]["ChatMessage"];
export type ChatMessagePage = components["schemas"]["ChatMessagePage"];
export type SpeechTurn = components["schemas"]["SpeechTurn"];
export type SpeechTurnPage = components["schemas"]["SpeechTurnPage"];
export type SummaryResource = components["schemas"]["SummaryResource"];
export type CreateRoomResponse = components["schemas"]["CreateRoomResponse"];
export type UserAccount = components["schemas"]["UserAccount"];

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function apiUrl(path: string): string {
  const baseUrl = runtimeConfig.apiBaseUrl.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toApiError(response: Response, body: unknown): ApiError {
  const payload =
    typeof body === "object" && body !== null ? (body as ApiErrorPayload).error : undefined;
  const message =
    typeof payload?.message === "string" ? payload.message : `请求失败（${response.status}）`;
  const code = typeof payload?.code === "string" ? payload.code : "UNKNOWN_ERROR";
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
  return new ApiError(message, response.status, code, requestId);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers,
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw toApiError(response, body);
  }

  return body as T;
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/health", signal ? { signal } : {});
}

export function getSession(signal?: AbortSignal): Promise<SessionResponse> {
  return request<SessionResponse>("/auth/session", signal ? { signal } : {});
}

export function createGuestSession(signal?: AbortSignal): Promise<SessionResponse> {
  return request<SessionResponse>("/auth/guest", {
    method: "POST",
    body: JSON.stringify({}),
    ...(signal ? { signal } : {}),
  });
}

export async function ensureSession(signal?: AbortSignal): Promise<SessionResponse> {
  try {
    return await getSession(signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return createGuestSession(signal);
    }
    throw error;
  }
}

export function logoutSession(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

export function listRooms(type: RoomType, signal?: AbortSignal): Promise<RoomPage> {
  const query = new URLSearchParams({ type, limit: "20" });
  return request<RoomPage>(`/rooms?${query.toString()}`, signal ? { signal } : {});
}

export function createRoom(title: string): Promise<CreateRoomResponse> {
  return request<CreateRoomResponse>("/rooms", {
    method: "POST",
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      topic: {
        source: "manual",
        title,
      },
    }),
  });
}

function roomResourcePath(roomId: string, resource = ""): string {
  const encodedRoomId = encodeURIComponent(roomId);
  return `/rooms/${encodedRoomId}${resource}`;
}

export function getRoom(roomId: string, signal?: AbortSignal): Promise<RoomSnapshot> {
  return request<RoomSnapshot>(roomResourcePath(roomId), signal ? { signal } : {});
}

export function createRtcCredentials(
  roomId: string,
  signal?: AbortSignal,
): Promise<RtcCredentials> {
  return request<RtcCredentials>(roomResourcePath(roomId, "/rtc-credentials"), {
    method: "POST",
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({}),
    ...(signal ? { signal } : {}),
  });
}

export function listRoomMaterials(roomId: string, signal?: AbortSignal): Promise<RoomMaterialPage> {
  return request<RoomMaterialPage>(
    `${roomResourcePath(roomId, "/materials")}?limit=5`,
    signal ? { signal } : {},
  );
}

export function listRoomMessages(roomId: string, signal?: AbortSignal): Promise<ChatMessagePage> {
  return request<ChatMessagePage>(
    `${roomResourcePath(roomId, "/messages")}?limit=30`,
    signal ? { signal } : {},
  );
}

export function listSpeechTurns(roomId: string, signal?: AbortSignal): Promise<SpeechTurnPage> {
  return request<SpeechTurnPage>(
    `${roomResourcePath(roomId, "/speech-turns")}?limit=50`,
    signal ? { signal } : {},
  );
}

export function getRoomSummary(roomId: string, signal?: AbortSignal): Promise<SummaryResource> {
  return request<SummaryResource>(roomResourcePath(roomId, "/summary"), signal ? { signal } : {});
}

export function generateRoomSummary(roomId: string): Promise<SummaryResource> {
  return request<SummaryResource>(roomResourcePath(roomId, "/summary/generate"), {
    method: "POST",
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({}),
  });
}

export function getZhihuAuthorizeUrl(returnTo: string): string {
  const query = new URLSearchParams({ returnTo });
  return apiUrl(`/auth/zhihu/authorize?${query.toString()}`);
}
