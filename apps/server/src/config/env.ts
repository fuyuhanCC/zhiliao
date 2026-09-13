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

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    SESSION_SECRET: z.string().min(32).default(developmentSessionSecret),
    LOG_LEVEL: z.string().default("info"),
    TRTC_SDK_APP_ID: optionalPositiveInteger,
    TRTC_SECRET_KEY: optionalNonEmptyString,
    TRTC_USER_SIG_TTL_SECONDS: z.coerce.number().int().min(300).max(604800).default(7200),
  })
  .superRefine((value, context) => {
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
  trtc:
    parsedEnv.TRTC_SDK_APP_ID !== undefined && parsedEnv.TRTC_SECRET_KEY !== undefined
      ? {
          sdkAppId: parsedEnv.TRTC_SDK_APP_ID,
          secretKey: parsedEnv.TRTC_SECRET_KEY,
          userSigTtlSeconds: parsedEnv.TRTC_USER_SIG_TTL_SECONDS,
        }
      : null,
} as const;
