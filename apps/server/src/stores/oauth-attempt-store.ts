export interface OAuthAttempt {
  attemptId: string;
  sessionId: string;
  state: string;
  returnTo: string;
  expiresAt: string;
}

export interface OAuthAttemptStore {
  save(attempt: OAuthAttempt): void;
  take(attemptId: string): OAuthAttempt | undefined;
}
