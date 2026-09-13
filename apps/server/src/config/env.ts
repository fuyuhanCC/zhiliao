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
    PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    SESSION_SECRET: z.string().min(32).default(developmentSessionSecret),
    LOG_LEVEL: z.string().default("info"),
    ZHIHU_OAUTH_APP_ID: optionalNonEmptyString,
    ZHIHU_OAUTH_APP_KEY: optionalNonEmptyString,
    ZHIHU_REDIRECT_URI: optionalUrl,
    ZHIHU_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
    ZHIHU_OAUTH_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
    TRTC_SDK_APP_ID: optionalPositiveInteger,
    TRTC_SECRET_KEY: optionalNonEmptyString,
    TRTC_USER_SIG_TTL_SECONDS: z.coerce.number().int().min(300).max(604800).default(7200),
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

    if (value.NODE_ENV === "production" && value.SESSION_SECRET === developmentSessionSecret) {
      context.addIssue({
        code: "custom",
        message: "生产环境必须配置独立的 SESSION_SECRET",
        path: ["SESSION_SECRET"],
      });
    }
  });

const parsedEnv = envSchema.parse(process.env);

export const env = {
  nodeEnv: parsedEnv.NODE_ENV,
  port: parsedEnv.PORT,
  webOrigin: parsedEnv.WEB_ORIGIN,
  sessionSecret: parsedEnv.SESSION_SECRET,
  logLevel: parsedEnv.LOG_LEVEL,
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
  trtc:
    parsedEnv.TRTC_SDK_APP_ID !== undefined && parsedEnv.TRTC_SECRET_KEY !== undefined
      ? {
          sdkAppId: parsedEnv.TRTC_SDK_APP_ID,
          secretKey: parsedEnv.TRTC_SECRET_KEY,
          userSigTtlSeconds: parsedEnv.TRTC_USER_SIG_TTL_SECONDS,
        }
      : null,
} as const;
