# Realtime gateway

这里实现 Socket.IO 连接鉴权、命令 ACK、幂等、房间广播及断线重连。事件名和载荷必须遵循 `docs/api/realtime-events.md`，业务裁决委托给 `domain`。
