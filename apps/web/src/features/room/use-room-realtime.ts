import type { CommandAck, PresenceUpdatedData, RoomClosedData, RoomEvent } from "@zhiliao/shared";
import { useEffect, useRef, useState } from "react";

import type { RoomSnapshot } from "../../lib/api-client";
import { createAppSocket } from "../../lib/socket";
import { applyPresenceUpdate, classifyRoomEvent } from "./realtime-room-state";

export type RoomConnectionStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "error" | "closed";

interface UseRoomRealtimeOptions {
  roomId: string;
  enabled: boolean;
  snapshot: RoomSnapshot | null;
  onSnapshot: (snapshot: RoomSnapshot) => void;
  onRoomClosed: () => void;
}

interface UseRoomRealtimeResult {
  status: RoomConnectionStatus;
  error: string | null;
}

interface SocketError extends Error {
  data?: {
    code?: string;
    message?: string;
  };
}

function requestId(): string {
  return crypto.randomUUID();
}

export function useRoomRealtime({
  roomId,
  enabled,
  snapshot,
  onSnapshot,
  onRoomClosed,
}: UseRoomRealtimeOptions): UseRoomRealtimeResult {
  const [status, setStatus] = useState<RoomConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const onSnapshotRef = useRef(onSnapshot);
  const onRoomClosedRef = useRef(onRoomClosed);

  useEffect(() => {
    snapshotRef.current = snapshot;
    onSnapshotRef.current = onSnapshot;
    onRoomClosedRef.current = onRoomClosed;
  }, [onRoomClosed, onSnapshot, snapshot]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setError(null);
      return;
    }

    const socket = createAppSocket();
    let disposed = false;
    let joined = false;
    let joinTimeout: number | null = null;
    let resyncInFlight = false;

    function applySnapshot(nextSnapshot: RoomSnapshot) {
      if (disposed) return;
      const currentVersion = snapshotRef.current?.room.version ?? 0;
      if (nextSnapshot.room.version < currentVersion) return;
      snapshotRef.current = nextSnapshot;
      onSnapshotRef.current(nextSnapshot);
    }

    function closeRoom() {
      if (disposed) return;
      setStatus("closed");
      setError(null);
      onRoomClosedRef.current();
    }

    function handleCommandFailure(ack: Extract<CommandAck<RoomSnapshot>, { ok: false }>) {
      if (ack.error.code === "ROOM_NOT_FOUND" || ack.error.code === "ROOM_CLOSED") {
        closeRoom();
        return;
      }
      setStatus("error");
      setError(ack.error.message);
    }

    function requestResync() {
      if (disposed || !joined || resyncInFlight) return;
      resyncInFlight = true;
      const lastKnownVersion = snapshotRef.current?.room.version ?? 0;
      socket.emit("room:resync", { requestId: requestId(), roomId, lastKnownVersion }, (ack) => {
        resyncInFlight = false;
        if (disposed) return;
        if (ack.ok) {
          applySnapshot(ack.data);
          setStatus("connected");
          setError(null);
        } else {
          handleCommandFailure(ack);
        }
      });
    }

    function joinRoom() {
      joined = false;
      setStatus("connecting");
      setError(null);
      if (joinTimeout !== null) window.clearTimeout(joinTimeout);
      joinTimeout = window.setTimeout(() => {
        if (disposed || joined) return;
        setStatus("error");
        setError("加入房间超时，正在尝试重新连接");
      }, 8000);

      socket.emit(
        "room:join",
        {
          requestId: requestId(),
          roomId,
          lastKnownVersion: snapshotRef.current?.room.version ?? null,
        },
        (ack) => {
          if (joinTimeout !== null) {
            window.clearTimeout(joinTimeout);
            joinTimeout = null;
          }
          if (disposed) return;
          if (ack.ok) {
            joined = true;
            applySnapshot(ack.data);
            setStatus("connected");
            setError(null);
          } else {
            handleCommandFailure(ack);
          }
        },
      );
    }

    function handlePresence(event: RoomEvent<PresenceUpdatedData>) {
      if (event.roomId !== roomId) return;
      const currentSnapshot = snapshotRef.current;
      const disposition = classifyRoomEvent(currentSnapshot, event.roomVersion);
      if (disposition === "stale") return;
      if (disposition === "gap" || !currentSnapshot) {
        requestResync();
        return;
      }
      applySnapshot(
        applyPresenceUpdate(currentSnapshot, event.roomVersion, event.data.onlineCount),
      );
    }

    function handleRoomClosed(event: RoomEvent<RoomClosedData>) {
      if (event.roomId === roomId) closeRoom();
    }

    function handleConnectError(connectError: Error) {
      if (disposed) return;
      const socketError = connectError as SocketError;
      setStatus("error");
      setError(socketError.data?.message ?? "实时服务连接失败");
    }

    socket.on("connect", joinRoom);
    socket.on("connect_error", handleConnectError);
    socket.on("disconnect", () => {
      if (disposed) return;
      joined = false;
      setStatus("reconnecting");
      setError(null);
    });
    socket.io.on("reconnect_attempt", () => {
      if (!disposed) setStatus("reconnecting");
    });
    socket.on("room:snapshot", (event) => {
      if (event.roomId === roomId) applySnapshot(event.data);
    });
    socket.on("presence:updated", handlePresence);
    socket.on("room:closed", handleRoomClosed);
    setStatus("connecting");
    setError(null);
    socket.connect();

    return () => {
      disposed = true;
      socket.io.reconnection(false);
      if (joinTimeout !== null) window.clearTimeout(joinTimeout);
      if (socket.connected && joined) {
        const disconnectFallback = window.setTimeout(() => socket.disconnect(), 500);
        socket.emit("room:leave", { requestId: requestId(), roomId }, () => {
          window.clearTimeout(disconnectFallback);
          socket.disconnect();
        });
      } else {
        socket.disconnect();
      }
    };
  }, [enabled, roomId]);

  return { status, error };
}
