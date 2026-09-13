import { z } from "zod";

const developmentSessionSecret = "development-only-session-secret-change-me";

const optionalPositiveInteger = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.url().optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    ENABLE_DEVELOPMENT_SESSIONS: z.enum(["true", "false"]).default("false"),
    PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    SESSION_SECRET: z.string().min(32).default(developmentSessionSecret),
    LOG_LEVEL: z.string().default("info"),
    REALTIME_DISCONNECT_GRACE_MS: z.coerce.number().int().min(0).max(60000).default(10000),
    ZHIHU_OAUTH_APP_ID: optionalNonEmptyString,
    ZHIHU_OAUTH_APP_KEY: optionalNonEmptyString,
    ZHIHU_REDIRECT_URI: optionalUrl,
    ZHIHU_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
    ZHIHU_OAUTH_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
    ZHIHU_DATA_API_BASE_URL: z.url().default("https://developer.zhihu.com/api/v1"),
    ZHIHU_ZHIDA_API_URL: z.url().default("https://developer.zhihu.com/v1/chat/completions"),
    ZHIHU_ZHIDA_MODEL: z
      .enum(["zhida-fast-1p5", "zhida-thinking-1p5", "zhida-agent"])
      .default("zhida-fast-1p5"),
    ZHIHU_ZHIDA_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    ZHIHU_ACCESS_SECRET: optionalNonEmptyString,
    ZHIHU_OPENAPI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
    ZHIHU_HOT_TOPICS_CACHE_TTL_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
    ZHIHU_MATERIALS_CACHE_TTL_SECONDS: z.coerce.number().int().min(30).max(86400).default(600),
    TRTC_SDK_APP_ID: optionalPositiveInteger,
    TRTC_SECRET_KEY: optionalNonEmptyString,
    TRTC_USER_SIG_TTL_SECONDS: z.coerce.number().int().min(300).max(604800).default(7200),
    ASR_PROVIDER: z.preprocess(
      (value) => (value === "manual" ? "disabled" : value),
      z.enum(["disabled", "tencent_flash"]).default("disabled"),
    ),
    TENCENT_CLOUD_APP_ID: optionalPositiveInteger,
    TENCENT_CLOUD_SECRET_ID: optionalNonEmptyString,
    TENCENT_CLOUD_SECRET_KEY: optionalNonEmptyString,
    TENCENT_ASR_ENGINE_TYPE: z.string().min(1).default("16k_zh"),
    TENCENT_ASR_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
  })
  .superRefine((value, context) => {
    const hasZhihuAppId = value.ZHIHU_OAUTH_APP_ID !== undefined;
    const hasZhihuAppKey = value.ZHIHU_OAUTH_APP_KEY !== undefined;

    if (hasZhihuAppId !== hasZhihuAppKey) {
      context.addIssue({
        code: "custom",
        message: "ZHIHU_OAUTH_APP_ID 和 ZHIHU_OAUTH_APP_KEY 必须同时配置",
        path: hasZhihuAppId ? ["ZHIHU_OAUTH_APP_KEY"] : ["ZHIHU_OAUTH_APP_ID"],
      });
    }

    if (hasZhihuAppId && value.ZHIHU_REDIRECT_URI === undefined) {
      context.addIssue({
        code: "custom",
        message: "启用知乎 OAuth 时必须配置 ZHIHU_REDIRECT_URI",
        path: ["ZHIHU_REDIRECT_URI"],
      });
    }

    const hasSdkAppId = value.TRTC_SDK_APP_ID !== undefined;
    const hasSecretKey = value.TRTC_SECRET_KEY !== undefined;

    if (hasSdkAppId !== hasSecretKey) {
      context.addIssue({
        code: "custom",
        message: "TRTC_SDK_APP_ID 和 TRTC_SECRET_KEY 必须同时配置",
        path: hasSdkAppId ? ["TRTC_SECRET_KEY"] : ["TRTC_SDK_APP_ID"],
      });
    }

    if (value.ASR_PROVIDER === "tencent_flash") {
      for (const [name, configured] of [
        ["TENCENT_CLOUD_APP_ID", value.TENCENT_CLOUD_APP_ID],
        ["TENCENT_CLOUD_SECRET_ID", value.TENCENT_CLOUD_SECRET_ID],
        ["TENCENT_CLOUD_SECRET_KEY", value.TENCENT_CLOUD_SECRET_KEY],
      ] as const) {
        if (configured === undefined) {
          context.addIssue({
            code: "custom",
            message: `启用腾讯云极速版 ASR 时必须配置 ${name}`,
            path: [name],
          });
        }
      }
    }

    if (value.NODE_ENV === "production" && value.SESSION_SECRET === developmentSessionSecret) {
      context.addIssue({
        code: "custom",
        message: "生产环境必须配置独立的 SESSION_SECRET",
        path: ["SESSION_SECRET"],
      });
    }

    if (value.NODE_ENV === "production" && value.ENABLE_DEVELOPMENT_SESSIONS === "true") {
      context.addIssue({
        code: "custom",
        message: "生产环境禁止启用开发会话",
        path: ["ENABLE_DEVELOPMENT_SESSIONS"],
      });
    }
  });

const parsedEnv = envSchema.parse(process.env);

export const env = {
  nodeEnv: parsedEnv.NODE_ENV,
  enableDevelopmentSessions:
    parsedEnv.NODE_ENV === "development" && parsedEnv.ENABLE_DEVELOPMENT_SESSIONS === "true",
  port: parsedEnv.PORT,
  webOrigin: parsedEnv.WEB_ORIGIN,
  sessionSecret: parsedEnv.SESSION_SECRET,
  logLevel: parsedEnv.LOG_LEVEL,
  realtimeDisconnectGraceMilliseconds: parsedEnv.REALTIME_DISCONNECT_GRACE_MS,
  zhihuOAuth:
    parsedEnv.ZHIHU_OAUTH_APP_ID !== undefined &&
    parsedEnv.ZHIHU_OAUTH_APP_KEY !== undefined &&
    parsedEnv.ZHIHU_REDIRECT_URI !== undefined
      ? {
          appId: parsedEnv.ZHIHU_OAUTH_APP_ID,
          appKey: parsedEnv.ZHIHU_OAUTH_APP_KEY,
          redirectUri: parsedEnv.ZHIHU_REDIRECT_URI,
          stateTtlSeconds: parsedEnv.ZHIHU_OAUTH_STATE_TTL_SECONDS,
          requestTimeoutMilliseconds: parsedEnv.ZHIHU_OAUTH_REQUEST_TIMEOUT_MS,
        }
      : null,
  zhihuOpenApi: parsedEnv.ZHIHU_ACCESS_SECRET
    ? {
        baseUrl: parsedEnv.ZHIHU_DATA_API_BASE_URL,
        accessSecret: parsedEnv.ZHIHU_ACCESS_SECRET,
        requestTimeoutMilliseconds: parsedEnv.ZHIHU_OPENAPI_REQUEST_TIMEOUT_MS,
        hotTopicsCacheTtlMilliseconds: parsedEnv.ZHIHU_HOT_TOPICS_CACHE_TTL_SECONDS * 1000,
        materialsCacheTtlMilliseconds: parsedEnv.ZHIHU_MATERIALS_CACHE_TTL_SECONDS * 1000,
      }
    : null,
  zhihuZhida: parsedEnv.ZHIHU_ACCESS_SECRET
    ? {
        apiUrl: parsedEnv.ZHIHU_ZHIDA_API_URL,
        accessSecret: parsedEnv.ZHIHU_ACCESS_SECRET,
        model: parsedEnv.ZHIHU_ZHIDA_MODEL,
        requestTimeoutMilliseconds: parsedEnv.ZHIHU_ZHIDA_REQUEST_TIMEOUT_MS,
      }
    : null,
  trtc:
    parsedEnv.TRTC_SDK_APP_ID !== undefined && parsedEnv.TRTC_SECRET_KEY !== undefined
      ? {
          sdkAppId: parsedEnv.TRTC_SDK_APP_ID,
          secretKey: parsedEnv.TRTC_SECRET_KEY,
          userSigTtlSeconds: parsedEnv.TRTC_USER_SIG_TTL_SECONDS,
        }
      : null,
  asr:
    parsedEnv.ASR_PROVIDER === "tencent_flash" &&
    parsedEnv.TENCENT_CLOUD_APP_ID !== undefined &&
    parsedEnv.TENCENT_CLOUD_SECRET_ID !== undefined &&
    parsedEnv.TENCENT_CLOUD_SECRET_KEY !== undefined
      ? {
          appId: parsedEnv.TENCENT_CLOUD_APP_ID,
          secretId: parsedEnv.TENCENT_CLOUD_SECRET_ID,
          secretKey: parsedEnv.TENCENT_CLOUD_SECRET_KEY,
          engineType: parsedEnv.TENCENT_ASR_ENGINE_TYPE,
          requestTimeoutMilliseconds: parsedEnv.TENCENT_ASR_REQUEST_TIMEOUT_MS,
        }
      : null,
} as const;
