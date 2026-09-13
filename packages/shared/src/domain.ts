export type IdentityType = "guest" | "zhihu";
export type TopicSource = "hot" | "zhihu_question" | "custom";

export type SeatNumber = 1 | 2 | 3 | 4 | 5 | 6;

export interface PublicUser {
  userId: string;
  identityType: IdentityType;
  displayName: string;
  avatarUrl: string | null;
}

export interface CommandAck<T = undefined> {
  requestId: string;
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
