import { env } from "./config/env.js";
import { HttpZhihuOAuthClient } from "./modules/auth/zhihu-oauth-client.js";
import { ZhihuOAuthService } from "./modules/auth/zhihu-oauth-service.js";
import { RtcCredentialService } from "./modules/rtc-credential/rtc-credential-service.js";
import { MemoryOAuthAttemptStore } from "./stores/memory/oauth-attempt-store.js";
import { MemoryRoomStore } from "./stores/memory/room-store.js";
import { MemorySessionStore } from "./stores/memory/session-store.js";
import type { RoomStore } from "./stores/room-store.js";
import type { SessionStore } from "./stores/session-store.js";

export interface AppDependencies {
  sessionStore: SessionStore;
  roomStore: RoomStore;
  zhihuOAuthService: ZhihuOAuthService | null;
  rtcCredentialService: RtcCredentialService | null;
  sessionSecret: string;
  secureCookies: boolean;
  webOrigin: string;
}

export function createAppDependencies(): AppDependencies {
  const sessionStore = new MemorySessionStore();
  const roomStore = new MemoryRoomStore();
  const oauthAttemptStore = new MemoryOAuthAttemptStore();

  return {
    sessionStore,
    roomStore,
    zhihuOAuthService: env.zhihuOAuth
      ? new ZhihuOAuthService({
          appId: env.zhihuOAuth.appId,
          redirectUri: env.zhihuOAuth.redirectUri,
          webOrigin: env.webOrigin,
          attemptTtlSeconds: env.zhihuOAuth.stateTtlSeconds,
          attemptStore: oauthAttemptStore,
          sessionStore,
          client: new HttpZhihuOAuthClient({
            appId: env.zhihuOAuth.appId,
            appKey: env.zhihuOAuth.appKey,
            redirectUri: env.zhihuOAuth.redirectUri,
            requestTimeoutMilliseconds: env.zhihuOAuth.requestTimeoutMilliseconds,
          }),
        })
      : null,
    rtcCredentialService: env.trtc
      ? new RtcCredentialService({
          sdkAppId: env.trtc.sdkAppId,
          secretKey: env.trtc.secretKey,
          userSigTtlSeconds: env.trtc.userSigTtlSeconds,
        })
      : null,
    sessionSecret: env.sessionSecret,
    secureCookies: env.nodeEnv === "production",
    webOrigin: env.webOrigin,
  };
}
