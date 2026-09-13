import { env } from "./config/env.js";
import { RtcCredentialService } from "./modules/rtc-credential/rtc-credential-service.js";
import { MemoryRoomStore } from "./stores/memory/room-store.js";
import { MemorySessionStore } from "./stores/memory/session-store.js";
import type { RoomStore } from "./stores/room-store.js";
import type { SessionStore } from "./stores/session-store.js";

export interface AppDependencies {
  sessionStore: SessionStore;
  roomStore: RoomStore;
  rtcCredentialService: RtcCredentialService | null;
  sessionSecret: string;
  secureCookies: boolean;
  webOrigin: string;
}

export function createAppDependencies(): AppDependencies {
  return {
    sessionStore: new MemorySessionStore(),
    roomStore: new MemoryRoomStore(),
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
