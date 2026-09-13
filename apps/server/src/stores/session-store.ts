import type { PublicUser } from "@zhiliao/shared";

export interface UserSession {
  sessionId: string;
  user: PublicUser;
  zhihuOAuth?: {
    accessToken: string;
    tokenType: string;
    expiresAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SessionStore {
  get(sessionId: string): UserSession | undefined;
  save(session: UserSession): void;
  delete(sessionId: string): void;
}
