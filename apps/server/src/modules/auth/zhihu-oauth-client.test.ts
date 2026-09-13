import { describe, expect, it } from "vitest";

import { HttpZhihuOAuthClient, ZhihuOAuthUpstreamError } from "./zhihu-oauth-client.js";

describe("HttpZhihuOAuthClient", () => {
  it("exchanges the authorization code with the documented form fields", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      requestedUrl = input.toString();
      requestedInit = init;
      return new Response(
        JSON.stringify({
          access_token: "oauth-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const client = new HttpZhihuOAuthClient({
      appId: "app-id",
      appKey: "app-key",
      redirectUri: "https://demo.example.com/api/v1/auth/zhihu/callback",
      fetchImpl,
    });

    const token = await client.exchangeAuthorizationCode("authorization-code");

    expect(requestedUrl).toBe("https://openapi.zhihu.com/access_token");
    expect(requestedInit?.method).toBe("POST");
    expect(requestedInit?.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const requestBody = new URLSearchParams(requestedInit?.body?.toString());
    expect(Object.fromEntries(requestBody)).toEqual({
      app_id: "app-id",
      app_key: "app-key",
      grant_type: "authorization_code",
      redirect_uri: "https://demo.example.com/api/v1/auth/zhihu/callback",
      code: "authorization-code",
    });
    expect(token).toEqual({
      accessToken: "oauth-access-token",
      tokenType: "Bearer",
      expiresInSeconds: 3600,
    });
  });

  it("rejects unsuccessful and malformed upstream responses", async () => {
    const rejectedClient = new HttpZhihuOAuthClient({
      appId: "app-id",
      appKey: "app-key",
      redirectUri: "https://demo.example.com/callback",
      fetchImpl: async () => new Response("denied", { status: 401 }),
    });
    await expect(rejectedClient.exchangeAuthorizationCode("bad-code")).rejects.toBeInstanceOf(
      ZhihuOAuthUpstreamError,
    );

    const malformedClient = new HttpZhihuOAuthClient({
      appId: "app-id",
      appKey: "app-key",
      redirectUri: "https://demo.example.com/callback",
      fetchImpl: async () => Response.json({ access_token: "missing-fields" }),
    });
    await expect(malformedClient.exchangeAuthorizationCode("bad-code")).rejects.toBeInstanceOf(
      ZhihuOAuthUpstreamError,
    );
  });
});
