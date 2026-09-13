import type { SessionStore, UserSession } from "../session-store.js";

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, UserSession>();

  get(sessionId: string): UserSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : undefined;
  }

  save(session: UserSession): void {
    this.sessions.set(session.sessionId, structuredClone(session));
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
