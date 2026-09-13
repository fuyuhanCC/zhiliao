import { createHash } from "node:crypto";

import type { PublicUser } from "@zhiliao/shared";
import type { components } from "@zhiliao/shared/openapi";
import UserSigModule from "tls-sig-api-v2";

type RtcCredentials = components["schemas"]["RtcCredentials"];

export interface RtcCredentialServiceOptions {
  sdkAppId: number;
  secretKey: string;
  userSigTtlSeconds: number;
  now?: () => Date;
  signer?: UserSigSigner;
}

export interface CreateRtcCredentialsInput {
  roomId: string;
  user: PublicUser;
  isSeated: boolean;
  idempotencyKey: string;
}

interface CachedCredentials {
  credentials: RtcCredentials;
  expiresAtMilliseconds: number;
}

export interface UserSigSigner {
  genUserSig(userId: string, expireSeconds: number): string;
}

function createTrtcUserId(userId: string): string {
  const digest = createHash("sha256").update(userId).digest("base64url").slice(0, 28);
  return `u_${digest}`;
}

export class RtcCredentialService {
  private readonly signer: UserSigSigner;
  private readonly now: () => Date;
  private readonly cache = new Map<string, CachedCredentials>();

  constructor(private readonly options: RtcCredentialServiceOptions) {
    this.signer = options.signer ?? new UserSigModule.Api(options.sdkAppId, options.secretKey);
    this.now = options.now ?? (() => new Date());
  }

  create(input: CreateRtcCredentialsInput): RtcCredentials {
    const now = this.now();
    this.removeExpiredCacheEntries(now.getTime());
    const cacheKey = `${input.user.userId}:${input.roomId}:${input.idempotencyKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMilliseconds > now.getTime()) {
      return structuredClone(cached.credentials);
    }

    const trtcUserId = createTrtcUserId(input.user.userId);
    const expiresAtMilliseconds = now.getTime() + this.options.userSigTtlSeconds * 1000;
    const credentials: RtcCredentials = {
      sdkAppId: this.options.sdkAppId,
      trtcRoomId: input.roomId,
      trtcUserId,
      userSig: this.signer.genUserSig(trtcUserId, this.options.userSigTtlSeconds),
      role: input.user.identityType === "zhihu" && input.isSeated ? "speaker" : "audience",
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    };

    this.cache.set(cacheKey, {
      credentials,
      expiresAtMilliseconds,
    });

    return structuredClone(credentials);
  }

  private removeExpiredCacheEntries(nowMilliseconds: number): void {
    for (const [cacheKey, cached] of this.cache) {
      if (cached.expiresAtMilliseconds <= nowMilliseconds) {
        this.cache.delete(cacheKey);
      }
    }
  }
}
