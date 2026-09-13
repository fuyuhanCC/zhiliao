# Realtime gateway

`realtime-gateway.ts` 负责 Socket.IO 会话 Cookie 鉴权、运行时参数校验、命令 ACK、幂等缓存、限频和房间广播。麦位、队列、发言锁、冷却与断线宽限规则由 `domain/room/realtime-room-service.ts` 裁决。

事件名和载荷必须遵循 `docs/api/realtime-events.md`。增加或修改事件时先更新契约与 `@zhiliao/shared` 类型，再修改网关。
