import { z } from "zod";

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    expires_in: z.coerce.number().int().positive(),
  })
  .passthrough();

export interface ZhihuOAuthToken {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  profile: ZhihuUserProfile | null;
}

export interface ZhihuUserProfile {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ZhihuOAuthClient {
  exchangeAuthorizationCode(code: string): Promise<ZhihuOAuthToken>;
}

export interface HttpZhihuOAuthClientOptions {
  appId: string;
  appKey: string;
  redirectUri: string;
  profileUrl?: string;
  requestTimeoutMilliseconds?: number;
  fetchImpl?: typeof fetch;
}

export class ZhihuOAuthUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZhihuOAuthUpstreamError";
  }
}

function readStringField(value: unknown, keys: string[]): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }
  return undefined;
}

function readNestedProfile(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return record.data ?? record.user ?? record.member ?? record.profile ?? value;
}

function normalizeAvatarUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseProfile(value: unknown): ZhihuUserProfile | null {
  const profile = readNestedProfile(value);
  const userId = readStringField(profile, [
    "id",
    "user_id",
    "uid",
    "openid",
    "open_id",
    "url_token",
  ]);
  const displayName = readStringField(profile, [
    "name",
    "nickname",
    "display_name",
    "displayName",
    "username",
    "full_name",
  ]);
  const avatar = readStringField(profile, [
    "avatar_url",
    "avatarUrl",
    "avatar",
    "avatar_url_template",
    "head_url",
    "picture",
  ]);

  if (!userId || !displayName) {
    return null;
  }

  return {
    userId,
    displayName,
    avatarUrl: normalizeAvatarUrl(avatar),
  };
}

export class HttpZhihuOAuthClient implements ZhihuOAuthClient {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMilliseconds: number;

  constructor(private readonly options: HttpZhihuOAuthClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMilliseconds = options.requestTimeoutMilliseconds ?? 10_000;
  }

  async exchangeAuthorizationCode(code: string): Promise<ZhihuOAuthToken> {
    const requestBody = new URLSearchParams({
      app_id: this.options.appId,
      app_key: this.options.appKey,
      grant_type: "authorization_code",
      redirect_uri: this.options.redirectUri,
      code,
    });

    let response: Response;
    try {
      response = await this.fetchImpl("https://openapi.zhihu.com/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: requestBody,
        signal: AbortSignal.timeout(this.requestTimeoutMilliseconds),
      });
    } catch {
      throw new ZhihuOAuthUpstreamError("知乎 OAuth Token 接口请求失败");
    }

    if (!response.ok) {
      throw new ZhihuOAuthUpstreamError(`知乎 OAuth Token 接口返回 ${response.status}`);
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new ZhihuOAuthUpstreamError("知乎 OAuth Token 接口返回了无效 JSON");
    }

    const parsedResponse = tokenResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      throw new ZhihuOAuthUpstreamError("知乎 OAuth Token 响应字段不完整");
    }

    return {
      accessToken: parsedResponse.data.access_token,
      tokenType: parsedResponse.data.token_type,
      expiresInSeconds: parsedResponse.data.expires_in,
      profile:
        parseProfile(parsedResponse.data) ??
        (await this.fetchAuthenticatedProfile(
          parsedResponse.data.access_token,
          parsedResponse.data.token_type,
        )),
    };
  }

  private async fetchAuthenticatedProfile(
    accessToken: string,
    tokenType: string,
  ): Promise<ZhihuUserProfile | null> {
    if (!this.options.profileUrl) {
      return null;
    }

    try {
      const response = await this.fetchImpl(this.options.profileUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `${tokenType} ${accessToken}`,
        },
        signal: AbortSignal.timeout(this.requestTimeoutMilliseconds),
      });

      if (!response.ok) {
        return null;
      }

      return parseProfile(await response.json());
    } catch {
      return null;
    }
  }
}
