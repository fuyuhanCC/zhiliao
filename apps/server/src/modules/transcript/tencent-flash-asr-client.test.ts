import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { TencentFlashAsrClient, TencentFlashAsrError } from "./tencent-flash-asr-client.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

describe("TencentFlashAsrClient", () => {
  it("signs a sorted query and returns the recognized text", async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchInit): Promise<Response> =>
      Response.json({
        request_id: "request-1",
        code: 0,
        message: "",
        flash_result: [{ text: "这是识别结果。", channel_id: 0 }],
      }),
    );
    const client = new TencentFlashAsrClient({
      appId: 1250000001,
      secretId: "secret-id",
      secretKey: "secret-key",
      now: () => new Date("2026-09-14T00:00:00.000Z"),
      fetchImpl,
    });

    await expect(
      client.transcribe({ audio: Uint8Array.from([1, 2, 3]), format: "m4a" }),
    ).resolves.toBe("这是识别结果。");

    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    const url = rawUrl as URL;
    const signatureSource = `POST${url.host}${url.pathname}?${url.searchParams.toString()}`;
    const expectedSignature = createHmac("sha1", "secret-key")
      .update(signatureSource)
      .digest("base64");
    expect([...url.searchParams.keys()]).toEqual([...url.searchParams.keys()].sort());
    expect(url.pathname).toBe("/asr/flash/v1/1250000001");
    expect(url.searchParams.get("voice_format")).toBe("m4a");
    expect(url.searchParams.get("timestamp")).toBe("1789344000");
    expect(new Headers(init?.headers).get("Authorization")).toBe(expectedSignature);
    expect(Buffer.from(init?.body as Uint8Array)).toEqual(Buffer.from([1, 2, 3]));
  });

  it("translates Tencent business errors", async () => {
    const client = new TencentFlashAsrClient({
      appId: 1250000001,
      secretId: "secret-id",
      secretKey: "secret-key",
      fetchImpl: vi.fn(async (_input: FetchInput, _init?: FetchInit) =>
        Response.json({ code: 4003, message: "服务未开通" }),
      ),
    });

    await expect(client.transcribe({ audio: new Uint8Array([1]), format: "wav" })).rejects.toEqual(
      expect.objectContaining<Partial<TencentFlashAsrError>>({
        name: "TencentFlashAsrError",
        upstreamCode: 4003,
        message: "服务未开通",
      }),
    );
  });
});
