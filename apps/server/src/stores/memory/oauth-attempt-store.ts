import type { OAuthAttempt, OAuthAttemptStore } from "../oauth-attempt-store.js";

export class MemoryOAuthAttemptStore implements OAuthAttemptStore {
  private readonly attempts = new Map<string, OAuthAttempt>();

  save(attempt: OAuthAttempt): void {
    this.attempts.set(attempt.attemptId, structuredClone(attempt));
  }

  take(attemptId: string): OAuthAttempt | undefined {
    const attempt = this.attempts.get(attemptId);
    this.attempts.delete(attemptId);
    return attempt ? structuredClone(attempt) : undefined;
  }
}
