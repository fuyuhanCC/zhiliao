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
      profile: null,
    });
  });

  it("extracts a profile when the token response includes user fields", async () => {
    const client = new HttpZhihuOAuthClient({
      appId: "app-id",
      appKey: "app-key",
      redirectUri: "https://demo.example.com/callback",
      fetchImpl: async () =>
        Response.json({
          access_token: "oauth-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          user: {
            id: "zhihu-user-id",
            name: "真实知乎昵称",
            avatar_url: "https://picx.zhimg.com/avatar.jpg",
          },
        }),
    });

    await expect(client.exchangeAuthorizationCode("authorization-code")).resolves.toMatchObject({
      profile: {
        userId: "zhihu-user-id",
        displayName: "真实知乎昵称",
        avatarUrl: "https://picx.zhimg.com/avatar.jpg",
      },
    });
  });

  it("fetches the configured profile endpoint with the OAuth access token", async () => {
    const requestedUrls: string[] = [];
    const requestedInits: RequestInit[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requestedUrls.push(input.toString());
      requestedInits.push(init ?? {});
      if (requestedUrls.length === 1) {
        return Response.json({
          access_token: "oauth-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return Response.json({
        data: {
          uid: "zhihu-user-id",
          nickname: "资料接口昵称",
          avatarUrl: "https://picx.zhimg.com/profile.jpg",
        },
      });
    };
    const client = new HttpZhihuOAuthClient({
      appId: "app-id",
      appKey: "app-key",
      redirectUri: "https://demo.example.com/callback",
      profileUrl: "https://openapi.zhihu.com/userinfo",
      fetchImpl,
    });

    await expect(client.exchangeAuthorizationCode("authorization-code")).resolves.toMatchObject({
      profile: {
        userId: "zhihu-user-id",
        displayName: "资料接口昵称",
        avatarUrl: "https://picx.zhimg.com/profile.jpg",
      },
    });
    expect(requestedUrls).toEqual([
      "https://openapi.zhihu.com/access_token",
      "https://openapi.zhihu.com/userinfo",
    ]);
    expect(new Headers(requestedInits[1]?.headers).get("Authorization")).toBe(
      "Bearer oauth-access-token",
    );
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
