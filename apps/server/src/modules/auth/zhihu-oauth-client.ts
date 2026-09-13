import { z } from "zod";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
});

export interface ZhihuOAuthToken {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
}

export interface ZhihuOAuthClient {
  exchangeAuthorizationCode(code: string): Promise<ZhihuOAuthToken>;
}

export interface HttpZhihuOAuthClientOptions {
  appId: string;
  appKey: string;
  redirectUri: string;
  requestTimeoutMilliseconds?: number;
  fetchImpl?: typeof fetch;
}

export class ZhihuOAuthUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZhihuOAuthUpstreamError";
  }
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
    };
  }
}
