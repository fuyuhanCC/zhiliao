import { z } from "zod";

const responseEnvelopeSchema = z.object({
  Code: z.coerce.number().int(),
  Message: z.string().optional(),
  Data: z.unknown().optional(),
});

const searchItemSchema = z.object({
  Title: z.string().trim().min(1),
  ContentType: z.string().trim().min(1),
  ContentID: z.union([z.string(), z.number()]).transform(String),
  ContentText: z
    .string()
    .nullish()
    .transform((value) => value ?? ""),
  Url: z.url(),
  CommentCount: z.coerce.number().int().nonnegative().nullish(),
  VoteUpCount: z.coerce.number().int().nonnegative().nullish(),
  AuthorName: z.string().nullish(),
  AuthorAvatar: z.string().nullish(),
  EditTime: z.coerce.number().int().nonnegative().nullish(),
});

const searchDataSchema = z.object({
  HasMore: z.boolean().optional(),
  SearchHashId: z.string().optional(),
  Items: z.array(searchItemSchema),
});

export interface ZhihuSearchItem {
  title: string;
  contentType: string;
  contentId: string;
  contentText: string;
  url: string;
  commentCount: number | null;
  voteUpCount: number | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  editTimeSeconds: number | null;
}

export interface ZhihuSearchResult {
  items: ZhihuSearchItem[];
  hasMore: boolean;
  searchHashId: string | null;
}

export interface ZhihuSearchClient {
  search(query: string, count: number): Promise<ZhihuSearchResult>;
}

export interface HttpZhihuSearchClientOptions {
  baseUrl: string;
  accessSecret: string;
  requestTimeoutMilliseconds?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class ZhihuSearchUpstreamError extends Error {
  constructor(
    message: string,
    readonly upstreamCode: number | null = null,
  ) {
    super(message);
    this.name = "ZhihuSearchUpstreamError";
  }
}

export class HttpZhihuSearchClient implements ZhihuSearchClient {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMilliseconds: number;
  private readonly now: () => Date;

  constructor(private readonly options: HttpZhihuSearchClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMilliseconds = options.requestTimeoutMilliseconds ?? 10_000;
    this.now = options.now ?? (() => new Date());
  }

  async search(query: string, count: number): Promise<ZhihuSearchResult> {
    const endpoint = new URL("content/zhihu_search", this.withTrailingSlash(this.options.baseUrl));
    endpoint.searchParams.set("Query", query);
    endpoint.searchParams.set("Count", String(Math.min(Math.max(count, 1), 10)));

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
      throw new ZhihuSearchUpstreamError("知乎搜索接口请求失败");
    }

    if (!response.ok) {
      throw new ZhihuSearchUpstreamError(`知乎搜索接口返回 HTTP ${response.status}`);
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      throw new ZhihuSearchUpstreamError("知乎搜索接口返回了无效 JSON");
    }

    const parsedEnvelope = responseEnvelopeSchema.safeParse(responseBody);
    if (!parsedEnvelope.success) {
      throw new ZhihuSearchUpstreamError("知乎搜索接口响应结构不完整");
    }
    if (parsedEnvelope.data.Code !== 0) {
      throw new ZhihuSearchUpstreamError(
        parsedEnvelope.data.Message || "知乎搜索接口返回业务错误",
        parsedEnvelope.data.Code,
      );
    }

    const parsedData = searchDataSchema.safeParse(parsedEnvelope.data.Data);
    if (!parsedData.success) {
      throw new ZhihuSearchUpstreamError("知乎搜索接口数据结构不完整");
    }

    return {
      items: parsedData.data.Items.map((item) => ({
        title: item.Title,
        contentType: item.ContentType,
        contentId: item.ContentID,
        contentText: item.ContentText,
        url: item.Url,
        commentCount: item.CommentCount ?? null,
        voteUpCount: item.VoteUpCount ?? null,
        authorName: item.AuthorName ?? null,
        authorAvatarUrl: item.AuthorAvatar ?? null,
        editTimeSeconds: item.EditTime ?? null,
      })),
      hasMore: parsedData.data.HasMore ?? false,
      searchHashId: parsedData.data.SearchHashId ?? null,
    };
  }

  private withTrailingSlash(baseUrl: string): string {
    return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  }
}
