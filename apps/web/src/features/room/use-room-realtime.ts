import type {
  CommandAck,
  CommandAckFailure,
  CooldownUpdatedData,
  PresenceUpdatedData,
  QueueUpdatedData,
  RoomClosedData,
  RoomEvent,
  SeatRequestResult,
  SeatUpdatedData,
  SpeakerAcquireResult,
  SpeakerChangedData,
  SpeakerTickData,
  SpeechClosedData,
} from "@zhiliao/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import type { RoomSnapshot } from "../../lib/api-client";
import { createAppSocket, type AppSocket } from "../../lib/socket";
import {
  advanceRoomVersion,
  applyCooldownUpdate,
  applyPresenceUpdate,
  applyQueueUpdate,
  applySeatUpdate,
  applySpeakerUpdate,
  classifyRoomEvent,
} from "./realtime-room-state";

export type RoomConnectionStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "error" | "closed";

export type RoomAction =
  "request-seat" | "cancel-seat" | "leave-seat" | "acquire-speaker" | "release-speaker";

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
  actionError: string | null;
  pendingAction: RoomAction | null;
  serverClockOffsetMilliseconds: number;
  clearActionError: () => void;
  requestSeat: () => Promise<CommandAck<SeatRequestResult> | null>;
  cancelSeatRequest: () => Promise<CommandAck | null>;
  leaveSeat: () => Promise<CommandAck | null>;
  acquireSpeaker: () => Promise<CommandAck<SpeakerAcquireResult> | null>;
  releaseSpeaker: (speechTurnId: string) => Promise<CommandAck | null>;
}

interface SocketError extends Error {
  data?: {
    code?: string;
    message?: string;
  };
}

type CommandSender<T> = (
  socket: AppSocket,
  commandRequestId: string,
  acknowledge: (ack: CommandAck<T>) => void,
) => void;

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<RoomAction | null>(null);
  const [serverClockOffsetMilliseconds, setServerClockOffsetMilliseconds] = useState(0);
  const snapshotRef = useRef(snapshot);
  const onSnapshotRef = useRef(onSnapshot);
  const onRoomClosedRef = useRef(onRoomClosed);
  const socketRef = useRef<AppSocket | null>(null);
  const joinedRef = useRef(false);
  const pendingActionRef = useRef<RoomAction | null>(null);
  const requestResyncRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    snapshotRef.current = snapshot;
    onSnapshotRef.current = onSnapshot;
    onRoomClosedRef.current = onRoomClosed;
  }, [onRoomClosed, onSnapshot, snapshot]);

  useEffect(() => {
    if (!enabled) {
      socketRef.current = null;
      joinedRef.current = false;
      setStatus("idle");
      setError(null);
      return;
    }

    const socket = createAppSocket();
    socketRef.current = socket;
    let disposed = false;
    let joined = false;
    let joinTimeout: number | null = null;
    let resyncInFlight = false;

    function calibrateClock(serverTime: string) {
      const parsed = Date.parse(serverTime);
      if (Number.isFinite(parsed)) {
        setServerClockOffsetMilliseconds(parsed - Date.now());
      }
    }

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

    function handleConnectionCommandFailure(ack: CommandAckFailure) {
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
        calibrateClock(ack.serverTime);
        if (ack.ok) {
          applySnapshot(ack.data);
          setStatus("connected");
          setError(null);
        } else {
          handleConnectionCommandFailure(ack);
        }
      });
    }
    requestResyncRef.current = requestResync;

    function joinRoom() {
      joined = false;
      joinedRef.current = false;
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
          calibrateClock(ack.serverTime);
          if (ack.ok) {
            joined = true;
            joinedRef.current = true;
            applySnapshot(ack.data);
            setStatus("connected");
            setError(null);
          } else {
            handleConnectionCommandFailure(ack);
          }
        },
      );
    }

    function applyVersionedEvent<T>(
      event: RoomEvent<T>,
      reducer: (current: RoomSnapshot, eventVersion: number, data: T) => RoomSnapshot,
    ) {
      if (event.roomId !== roomId) return;
      calibrateClock(event.serverTime);
      const currentSnapshot = snapshotRef.current;
      const disposition = classifyRoomEvent(currentSnapshot, event.roomVersion);
      if (disposition === "stale") return;
      if (disposition === "gap" || !currentSnapshot) {
        requestResync();
        return;
      }
      applySnapshot(reducer(currentSnapshot, event.roomVersion, event.data));
    }

    function handlePresence(event: RoomEvent<PresenceUpdatedData>) {
      applyVersionedEvent(event, (current, eventVersion, data) =>
        applyPresenceUpdate(current, eventVersion, data.onlineCount),
      );
    }

    function handleSeatUpdated(event: RoomEvent<SeatUpdatedData>) {
      applyVersionedEvent(event, applySeatUpdate);
    }

    function handleQueueUpdated(event: RoomEvent<QueueUpdatedData>) {
      applyVersionedEvent(event, applyQueueUpdate);
    }

    function handleSpeakerChanged(event: RoomEvent<SpeakerChangedData>) {
      applyVersionedEvent(event, applySpeakerUpdate);
    }

    function handleSpeakerTick(event: RoomEvent<SpeakerTickData>) {
      if (event.roomId !== roomId) return;
      calibrateClock(event.serverTime);
      const currentSnapshot = snapshotRef.current;
      if (
        !currentSnapshot?.speakerLock ||
        currentSnapshot.speakerLock.speechTurnId !== event.data.speechTurnId
      ) {
        return;
      }
      if (currentSnapshot.speakerLock.expiresAt !== event.data.expiresAt) {
        applySnapshot({
          ...currentSnapshot,
          speakerLock: { ...currentSnapshot.speakerLock, expiresAt: event.data.expiresAt },
        });
      }
    }

    function handleCooldownUpdated(event: RoomEvent<CooldownUpdatedData>) {
      applyVersionedEvent(event, applyCooldownUpdate);
    }

    function handleSpeechClosed(event: RoomEvent<SpeechClosedData>) {
      applyVersionedEvent(event, (current, eventVersion) =>
        advanceRoomVersion(current, eventVersion),
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
      joinedRef.current = false;
      setStatus("reconnecting");
      setError(null);
    });
    socket.io.on("reconnect_attempt", () => {
      if (!disposed) setStatus("reconnecting");
    });
    socket.on("room:snapshot", (event) => {
      if (event.roomId === roomId) {
        calibrateClock(event.serverTime);
        applySnapshot(event.data);
      }
    });
    socket.on("presence:updated", handlePresence);
    socket.on("seat:updated", handleSeatUpdated);
    socket.on("queue:updated", handleQueueUpdated);
    socket.on("speaker:changed", handleSpeakerChanged);
    socket.on("speaker:tick", handleSpeakerTick);
    socket.on("cooldown:updated", handleCooldownUpdated);
    socket.on("speech:closed", handleSpeechClosed);
    socket.on("room:closed", handleRoomClosed);
    setStatus("connecting");
    setError(null);
    socket.connect();

    return () => {
      disposed = true;
      joinedRef.current = false;
      requestResyncRef.current = () => undefined;
      if (socketRef.current === socket) socketRef.current = null;
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

  const executeCommand = useCallback(function executeCommand<T>(
    action: RoomAction,
    sender: CommandSender<T>,
  ): Promise<CommandAck<T> | null> {
    const socket = socketRef.current;
    if (!socket?.connected || !joinedRef.current) {
      setActionError("实时连接尚未就绪，请稍后再试");
      return Promise.resolve(null);
    }
    if (pendingActionRef.current !== null) {
      return Promise.resolve(null);
    }

    pendingActionRef.current = action;
    setPendingAction(action);
    setActionError(null);

    return new Promise((resolve) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        pendingActionRef.current = null;
        setPendingAction(null);
        setActionError("操作超时，请重试");
        resolve(null);
      }, 8000);

      sender(socket, requestId(), (ack) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        pendingActionRef.current = null;
        setPendingAction(null);
        if (!ack.ok) {
          setActionError(ack.error.message);
          if (ack.error.code === "ROOM_NOT_FOUND" || ack.error.code === "ROOM_CLOSED") {
            onRoomClosedRef.current();
          }
        } else if (ack.roomVersion > (snapshotRef.current?.room.version ?? 0)) {
          requestResyncRef.current();
        }
        resolve(ack);
      });
    });
  }, []);

  const requestSeat = useCallback(
    () =>
      executeCommand<SeatRequestResult>("request-seat", (socket, commandRequestId, acknowledge) => {
        socket.emit("seat:request", { requestId: commandRequestId, roomId }, acknowledge);
      }),
    [executeCommand, roomId],
  );

  const cancelSeatRequest = useCallback(
    () =>
      executeCommand<Record<string, never>>(
        "cancel-seat",
        (socket, commandRequestId, acknowledge) => {
          socket.emit("seat:cancel", { requestId: commandRequestId, roomId }, acknowledge);
        },
      ),
    [executeCommand, roomId],
  );

  const leaveSeat = useCallback(
    () =>
      executeCommand<Record<string, never>>(
        "leave-seat",
        (socket, commandRequestId, acknowledge) => {
          socket.emit("seat:leave", { requestId: commandRequestId, roomId }, acknowledge);
        },
      ),
    [executeCommand, roomId],
  );

  const acquireSpeaker = useCallback(
    () =>
      executeCommand<SpeakerAcquireResult>(
        "acquire-speaker",
        (socket, commandRequestId, acknowledge) => {
          socket.emit("speaker:acquire", { requestId: commandRequestId, roomId }, acknowledge);
        },
      ),
    [executeCommand, roomId],
  );

  const releaseSpeaker = useCallback(
    (speechTurnId: string) =>
      executeCommand<Record<string, never>>(
        "release-speaker",
        (socket, commandRequestId, acknowledge) => {
          socket.emit(
            "speaker:release",
            {
              requestId: commandRequestId,
              roomId,
              speechTurnId,
              reason: "user_finished",
            },
            acknowledge,
          );
        },
      ),
    [executeCommand, roomId],
  );

  return {
    status,
    error,
    actionError,
    pendingAction,
    serverClockOffsetMilliseconds,
    clearActionError: () => setActionError(null),
    requestSeat,
    cancelSeatRequest,
    leaveSeat,
    acquireSpeaker,
    releaseSpeaker,
  };
}
