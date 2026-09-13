import { env } from "./config/env.js";
import { HttpZhihuOAuthClient } from "./modules/auth/zhihu-oauth-client.js";
import { ZhihuOAuthService } from "./modules/auth/zhihu-oauth-service.js";
import { RtcCredentialService } from "./modules/rtc-credential/rtc-credential-service.js";
import { SummaryService } from "./modules/summary/summary-service.js";
import { HttpZhihuZhidaClient } from "./modules/summary/zhihu-zhida-client.js";
import { TencentFlashAsrClient } from "./modules/transcript/tencent-flash-asr-client.js";
import { TranscriptService } from "./modules/transcript/transcript-service.js";
import { HotTopicRoomService } from "./modules/zhihu-gateway/hot-topic-room-service.js";
import { RoomMaterialService } from "./modules/zhihu-gateway/room-material-service.js";
import { HttpZhihuHotListClient } from "./modules/zhihu-gateway/zhihu-hot-list-client.js";
import { HttpZhihuSearchClient } from "./modules/zhihu-gateway/zhihu-search-client.js";
import { MemoryAccountStore } from "./stores/memory/account-store.js";
import { MemoryChatStore } from "./stores/memory/chat-store.js";
import { MemoryOAuthAttemptStore } from "./stores/memory/oauth-attempt-store.js";
import { MemoryRoomStore } from "./stores/memory/room-store.js";
import { MemorySessionStore } from "./stores/memory/session-store.js";
import { MemorySpeechTurnStore } from "./stores/memory/speech-turn-store.js";
import { MemorySummaryStore } from "./stores/memory/summary-store.js";
import { RoomEventBus } from "./realtime/room-event-bus.js";
import type { ChatStore } from "./stores/chat-store.js";
import type { AccountStore } from "./stores/account-store.js";
import type { RoomStore } from "./stores/room-store.js";
import type { SessionStore } from "./stores/session-store.js";
import type { SpeechTurnStore } from "./stores/speech-turn-store.js";

export interface AppDependencies {
  sessionStore: SessionStore;
  accountStore: AccountStore;
  roomStore: RoomStore;
  chatStore: ChatStore;
  speechTurnStore: SpeechTurnStore;
  zhihuOAuthService: ZhihuOAuthService | null;
  hotTopicRoomService?: HotTopicRoomService;
  roomMaterialService?: RoomMaterialService | null;
  rtcCredentialService: RtcCredentialService | null;
  transcriptService?: TranscriptService | null;
  summaryService?: SummaryService;
  roomEventBus?: RoomEventBus;
  sessionSecret: string;
  secureCookies: boolean;
  webOrigin: string;
}

export function createAppDependencies(): AppDependencies {
  const sessionStore = new MemorySessionStore();
  const accountStore = new MemoryAccountStore();
  const roomStore = new MemoryRoomStore();
  const chatStore = new MemoryChatStore();
  const speechTurnStore = new MemorySpeechTurnStore();
  const oauthAttemptStore = new MemoryOAuthAttemptStore();
  const summaryStore = new MemorySummaryStore();
  const roomEventBus = new RoomEventBus();
  const hotListClient = env.zhihuOpenApi
    ? new HttpZhihuHotListClient({
        baseUrl: env.zhihuOpenApi.baseUrl,
        accessSecret: env.zhihuOpenApi.accessSecret,
        requestTimeoutMilliseconds: env.zhihuOpenApi.requestTimeoutMilliseconds,
      })
    : null;

  const transcriptService = env.asr
    ? new TranscriptService({
        roomStore,
        speechTurnStore,
        eventBus: roomEventBus,
        client: new TencentFlashAsrClient(env.asr),
      })
    : null;
  const summaryService = new SummaryService({
    roomStore,
    speechTurnStore,
    summaryStore,
    eventBus: roomEventBus,
    client: env.zhihuZhida ? new HttpZhihuZhidaClient(env.zhihuZhida) : null,
  });

  return {
    sessionStore,
    accountStore,
    roomStore,
    chatStore,
    speechTurnStore,
    transcriptService,
    summaryService,
    roomEventBus,
    hotTopicRoomService: new HotTopicRoomService({
      roomStore,
      client: hotListClient,
      cacheTtlMilliseconds: env.zhihuOpenApi?.hotTopicsCacheTtlMilliseconds ?? 5 * 60 * 1000,
    }),
    zhihuOAuthService: env.zhihuOAuth
      ? new ZhihuOAuthService({
          appId: env.zhihuOAuth.appId,
          redirectUri: env.zhihuOAuth.redirectUri,
          webOrigin: env.webOrigin,
          attemptTtlSeconds: env.zhihuOAuth.stateTtlSeconds,
          attemptStore: oauthAttemptStore,
          accountStore,
          sessionStore,
          client: new HttpZhihuOAuthClient({
            appId: env.zhihuOAuth.appId,
            appKey: env.zhihuOAuth.appKey,
            redirectUri: env.zhihuOAuth.redirectUri,
            requestTimeoutMilliseconds: env.zhihuOAuth.requestTimeoutMilliseconds,
          }),
        })
      : null,
    roomMaterialService: env.zhihuOpenApi
      ? new RoomMaterialService({
          client: new HttpZhihuSearchClient({
            baseUrl: env.zhihuOpenApi.baseUrl,
            accessSecret: env.zhihuOpenApi.accessSecret,
            requestTimeoutMilliseconds: env.zhihuOpenApi.requestTimeoutMilliseconds,
          }),
          cacheTtlMilliseconds: env.zhihuOpenApi.materialsCacheTtlMilliseconds,
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
