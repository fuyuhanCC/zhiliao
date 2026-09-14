import { create } from "zustand";

import { ensureSession, getHealth, type SessionResponse } from "../lib/api-client";

type SessionStatus = "idle" | "loading" | "ready" | "error";

interface SessionState {
  session: SessionResponse | null;
  status: SessionStatus;
  error: string | null;
  bootstrap: () => Promise<void>;
}

let bootstrapPromise: Promise<void> | null = null;

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  status: "idle",
  error: null,
  bootstrap: async () => {
    if (get().status === "ready") {
      return;
    }
    if (bootstrapPromise) {
      return bootstrapPromise;
    }

    set({ status: "loading", error: null });
    bootstrapPromise = Promise.all([getHealth(), ensureSession()])
      .then(([, session]) => {
        set({ session, status: "ready", error: null });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "无法连接后端服务";
        set({ session: null, status: "error", error: message });
      })
      .finally(() => {
        bootstrapPromise = null;
      });

    return bootstrapPromise;
  },
}));
