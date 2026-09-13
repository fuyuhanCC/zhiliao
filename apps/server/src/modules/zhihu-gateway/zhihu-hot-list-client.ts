import { z } from "zod";

const responseEnvelopeSchema = z.object({
  Code: z.coerce.number().int(),
  Message: z.string().optional(),
  Data: z.unknown().optional(),
});

const hotListItemSchema = z.object({
  Title: z.string().trim().min(1),
  Url: z.url(),
  ThumbnailUrl: z.string(),
  Summary: z.string(),
});

const hotListDataSchema = z.object({
  Total: z.coerce.number().int().nonnegative(),
  Items: z.array(hotListItemSchema),
});

export interface ZhihuHotListItem {
  title: string;
  url: string;
  thumbnailUrl: string;
  summary: string;
}

export interface ZhihuHotListResult {
  total: number;
  items: ZhihuHotListItem[];
}

export interface ZhihuHotListClient {
  list(limit: number): Promise<ZhihuHotListResult>;
}

export interface HttpZhihuHotListClientOptions {
  baseUrl: string;
  accessSecret: string;
  requestTimeoutMilliseconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class ZhihuHotListUpstreamError extends Error {
  constructor(
    message: string,
    readonly upstreamCode: number | null = null,
  ) {
    super(message);
    this.name = "ZhihuHotListUpstreamError";
  }
}

export class HttpZhihuHotListClient implements ZhihuHotListClient {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMilliseconds: number;
  private readonly now: () => Date;

  constructor(private readonly options: HttpZhihuHotListClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMilliseconds = options.requestTimeoutMilliseconds ?? 10_000;
    this.now = options.now ?? (() => new Date());
  }

  async list(limit: number): Promise<ZhihuHotListResult> {
    const endpoint = new URL("content/hot_list", this.withTrailingSlash(this.options.baseUrl));
    endpoint.searchParams.set("Limit", String(Math.min(Math.max(limit, 1), 30)));

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.options.accessSecret}`,
          "Content-Type": "application/json",
          "X-Request-Timestamp": String(Math.floor(this.now().getTime() / 1000)),
        },
        redirect: "error",
        signal: AbortSignal.timeout(this.requestTimeoutMilliseconds),
      });
    } catch {
      throw new ZhihuHotListUpstreamError("知乎热榜接口请求失败");
    }

    if (!response.ok) {
      throw new ZhihuHotListUpstreamError(`知乎热榜接口返回 HTTP ${response.status}`);
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new ZhihuHotListUpstreamError("知乎热榜接口返回了无效 JSON");
    }

    const parsedEnvelope = responseEnvelopeSchema.safeParse(responseBody);
    if (!parsedEnvelope.success) {
      throw new ZhihuHotListUpstreamError("知乎热榜接口响应结构不完整");
    }
    if (parsedEnvelope.data.Code !== 0) {
      throw new ZhihuHotListUpstreamError(
        parsedEnvelope.data.Message || "知乎热榜接口返回业务错误",
        parsedEnvelope.data.Code,
      );
    }

    const parsedData = hotListDataSchema.safeParse(parsedEnvelope.data.Data);
    if (!parsedData.success) {
      throw new ZhihuHotListUpstreamError("知乎热榜接口数据结构不完整");
    }

    return {
      total: parsedData.data.Total,
      items: parsedData.data.Items.map((item) => ({
        title: item.Title,
        url: item.Url,
        thumbnailUrl: item.ThumbnailUrl,
        summary: item.Summary,
      })),
    };
  }

  private withTrailingSlash(baseUrl: string): string {
    return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  }
}
