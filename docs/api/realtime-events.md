# Socket.IO 实时事件契约

## 1. 连接

- Socket.IO 路径：`/socket.io`
- 默认命名空间：`/`
- 鉴权：复用 HTTP 会话 Cookie。
- 客户端连接成功后必须发送 `room:join`，服务端返回完整房间快照。
- 服务端以其状态为准；客户端不得用本地缓存覆盖服务端状态。

## 2. 命令、ACK 与广播

客户端发出的操作称为“命令”，必须携带唯一 `requestId`，并使用 Socket.IO ACK 获取执行结果。

命令示例：

```json
{
  "requestId": "req_client_001",
  "roomId": "room_123"
}
```

成功 ACK：

```json
{
  "ok": true,
  "requestId": "req_client_001",
  "roomVersion": 18,
  "serverTime": "2026-09-13T08:00:00.000Z",
  "data": {}
}
```

失败 ACK：

```json
{
  "ok": false,
  "requestId": "req_client_001",
  "roomVersion": 18,
  "serverTime": "2026-09-13T08:00:00.000Z",
  "error": {
    "code": "SPEAKER_LOCKED",
    "message": "当前有人正在发言",
    "details": {
      "speakerUserId": "user_456"
    }
  }
}
```

服务端广播统一使用以下信封：

```json
{
  "eventId": "evt_123",
  "roomId": "room_123",
  "roomVersion": 19,
  "serverTime": "2026-09-13T08:00:01.000Z",
  "data": {}
}
```

## 3. 客户端命令

### 3.1 `room:join`

进入 Socket.IO 房间并获取完整快照。游客和知乎用户均可调用。

```json
{
  "requestId": "req_1",
  "roomId": "room_123",
  "lastKnownVersion": null,
  "inviteCode": null
}
```

首次进入时 `lastKnownVersion` 为 `null`，重连时传客户端最后应用的版本号。`inviteCode` 仅用于邀请制房间。ACK `data` 为 `RoomSnapshot`。如果房间不存在、访问码无效或房间已回收，返回 `ROOM_NOT_FOUND`、`INVITE_REQUIRED`、`INVALID_INVITE_CODE` 或 `ROOM_CLOSED`。

### 3.2 `room:leave`

主动离开房间。若用户在麦位、排队或持有发言锁，服务端必须完成关联清理后再 ACK。

```json
{
  "requestId": "req_2",
  "roomId": "room_123"
}
```

### 3.3 `room:resync`

客户端发现 `roomVersion` 不连续时请求完整快照。

```json
{
  "requestId": "req_3",
  "roomId": "room_123",
  "lastKnownVersion": 17
}
```

ACK `data` 为最新 `RoomSnapshot`。

### 3.4 `seat:request`

申请上麦。只允许知乎登录用户调用。

```json
{
  "requestId": "req_4",
  "roomId": "room_123"
}
```

有空位时 ACK：

```json
{
  "ok": true,
  "requestId": "req_4",
  "roomVersion": 20,
  "serverTime": "2026-09-13T08:00:02.000Z",
  "data": {
    "status": "seated",
    "seatNumber": 3
  }
}
```

无空位时 ACK：

```json
{
  "ok": true,
  "requestId": "req_4",
  "roomVersion": 20,
  "serverTime": "2026-09-13T08:00:02.000Z",
  "data": {
    "status": "queued",
    "queuePosition": 2
  }
}
```

可能错误：`ZHIHU_LOGIN_REQUIRED`、`ALREADY_SEATED`、`ALREADY_QUEUED`。

### 3.5 `seat:cancel`

取消上麦排队。

```json
{
  "requestId": "req_5",
  "roomId": "room_123"
}
```

可能错误：`NOT_IN_QUEUE`。

### 3.6 `seat:leave`

主动下麦。若调用者持有发言锁，服务端先释放锁并创建 `SpeechTurn`，再释放麦位并补位排队第一人。

```json
{
  "requestId": "req_6",
  "roomId": "room_123"
}
```

可能错误：`NOT_SEATED`。

### 3.7 `speaker:acquire`

申请唯一发言锁。只允许已登录、已上麦且未冷却的用户调用。

```json
{
  "requestId": "req_7",
  "roomId": "room_123"
}
```

成功 ACK：

```json
{
  "ok": true,
  "requestId": "req_7",
  "roomVersion": 23,
  "serverTime": "2026-09-13T08:01:00.000Z",
  "data": {
    "speechTurnId": "turn_789",
    "acquiredAt": "2026-09-13T08:01:00.000Z",
    "expiresAt": "2026-09-13T08:03:00.000Z"
  }
}
```

客户端只有在收到成功 ACK 后才能发布 TRTC 本地音频。

可能错误：`ZHIHU_LOGIN_REQUIRED`、`SEAT_REQUIRED`、`SPEAKER_LOCKED`、`COOLDOWN_ACTIVE`。

### 3.8 `speaker:release`

主动闭麦并释放发言锁。

```json
{
  "requestId": "req_8",
  "roomId": "room_123",
  "speechTurnId": "turn_789",
  "reason": "user_finished"
}
```

`reason` 可选值：`user_finished`。超时、断线和下麦由服务端生成对应原因。

可能错误：`NOT_SPEAKER`、`SPEECH_TURN_MISMATCH`。

### 3.9 `chat:send`

发送普通公屏消息。游客和知乎用户均可调用。

```json
{
  "requestId": "req_9",
  "roomId": "room_123",
  "clientMessageId": "msg_client_001",
  "content": "我赞同这个观点"
}
```

约束：去除首尾空白后 1～200 字；服务端负责限频和内容安全兜底。

可能错误：`VALIDATION_ERROR`、`RATE_LIMITED`。

### 3.10 `reaction:like`

给当前发言者点赞。游客和知乎用户均可调用。

```json
{
  "requestId": "req_10",
  "roomId": "room_123",
  "speechTurnId": "turn_789"
}
```

相同会话对同一 `SpeechTurn` 最多记一次有效点赞。可能错误：`NO_ACTIVE_SPEAKER`、`ALREADY_LIKED`、`RATE_LIMITED`。

### 3.11 `reward:send`

打赏当前正在发言的用户。游客和知乎登录用户均可调用；不能打赏自己。

```json
{
  "requestId": "req_11",
  "roomId": "room_123",
  "speechTurnId": "turn_789",
  "amount": 10
}
```

`amount` 只能是 `5`、`10` 或 `50`。服务端以 `speechTurnId` 对应的当前发言者为收款人，不接受客户端指定收款账户。

成功 ACK 的 `data`：

```json
{
  "rewardId": "reward_123",
  "speechTurnId": "turn_789",
  "recipientUserId": "user_456",
  "amount": 10,
  "remainingBalance": 90
}
```

可能错误：`NO_ACTIVE_SPEAKER`、`SELF_REWARD_NOT_ALLOWED`、`INSUFFICIENT_BALANCE`、`REWARD_CONFLICT`、`RATE_LIMITED`。

## 4. 服务端广播

### 4.1 `room:snapshot`

完整房间状态。用于首次加入和重同步。

```json
{
  "eventId": "evt_1",
  "roomId": "room_123",
  "roomVersion": 24,
  "serverTime": "2026-09-13T08:01:20.000Z",
  "data": {
    "room": {
      "roomId": "room_123",
      "status": "active",
      "visibility": "public",
      "topic": {
        "source": "zhihu_question",
        "title": "示例辩题",
        "zhihuQuestionId": "123456",
        "zhihuUrl": "https://www.zhihu.com/question/123456"
      },
      "onlineCount": 8
    },
    "seats": [],
    "queue": [],
    "speakerLock": null,
    "cooldowns": []
  }
}
```

完整字段以 `openapi.yaml` 中的 `RoomSnapshot` 为准。

### 4.2 `presence:updated`

在线人数变化。

```json
{
  "eventId": "evt_2",
  "roomId": "room_123",
  "roomVersion": 25,
  "serverTime": "2026-09-13T08:01:21.000Z",
  "data": {
    "onlineCount": 9
  }
}
```

### 4.3 `seat:updated`

麦位被占用或释放。

```json
{
  "eventId": "evt_3",
  "roomId": "room_123",
  "roomVersion": 26,
  "serverTime": "2026-09-13T08:01:22.000Z",
  "data": {
    "seatNumber": 3,
    "occupant": {
      "userId": "user_456",
      "identityType": "zhihu",
      "displayName": "某知友",
      "avatarUrl": "https://example.com/avatar.png",
      "level": 2,
      "levelTitle": "破土"
    }
  }
}
```

`occupant` 为 `null` 表示空麦位。

### 4.4 `queue:updated`

广播完整等待队列，避免客户端自行推算位置。

```json
{
  "eventId": "evt_4",
  "roomId": "room_123",
  "roomVersion": 27,
  "serverTime": "2026-09-13T08:01:23.000Z",
  "data": {
    "queue": [
      {
        "position": 1,
        "userId": "user_999",
        "displayName": "排队用户",
        "enqueuedAt": "2026-09-13T08:01:10.000Z"
      }
    ]
  }
}
```

### 4.5 `speaker:changed`

发言锁获取或释放时广播。

锁被获取：

```json
{
  "eventId": "evt_5",
  "roomId": "room_123",
  "roomVersion": 28,
  "serverTime": "2026-09-13T08:02:00.000Z",
  "data": {
    "speakerLock": {
      "speechTurnId": "turn_789",
      "userId": "user_456",
      "seatNumber": 3,
      "acquiredAt": "2026-09-13T08:02:00.000Z",
      "expiresAt": "2026-09-13T08:04:00.000Z"
    },
    "releaseReason": null
  }
}
```

锁被释放时 `speakerLock` 为 `null`，`releaseReason` 为：

- `user_finished`
- `time_limit`
- `seat_left`
- `disconnected`
- `room_closed`

### 4.6 `speaker:tick`

服务端每 5 秒广播一次校准时间，不要求每秒广播。客户端根据 `serverTime` 和 `expiresAt` 本地渲染秒级倒计时。

```json
{
  "eventId": "evt_6",
  "roomId": "room_123",
  "roomVersion": 28,
  "serverTime": "2026-09-13T08:02:05.000Z",
  "data": {
    "speechTurnId": "turn_789",
    "expiresAt": "2026-09-13T08:04:00.000Z"
  }
}
```

该事件不改变 `roomVersion`。

### 4.7 `cooldown:updated`

```json
{
  "eventId": "evt_7",
  "roomId": "room_123",
  "roomVersion": 29,
  "serverTime": "2026-09-13T08:04:00.000Z",
  "data": {
    "userId": "user_456",
    "expiresAt": "2026-09-13T08:05:00.000Z"
  }
}
```

`expiresAt` 为 `null` 表示冷却结束。

### 4.8 `chat:created`

```json
{
  "eventId": "evt_8",
  "roomId": "room_123",
  "roomVersion": 30,
  "serverTime": "2026-09-13T08:04:02.000Z",
  "data": {
    "messageId": "msg_123",
    "clientMessageId": "msg_client_001",
    "type": "text",
    "sender": {
      "userId": "guest_123",
      "identityType": "guest",
      "displayName": "辩手 3 号",
      "avatarUrl": null,
      "level": 1,
      "levelTitle": "蛰伏"
    },
    "content": "我赞同这个观点",
    "createdAt": "2026-09-13T08:04:02.000Z"
  }
}
```

### 4.9 `reaction:created`

```json
{
  "eventId": "evt_9",
  "roomId": "room_123",
  "roomVersion": 31,
  "serverTime": "2026-09-13T08:04:03.000Z",
  "data": {
    "type": "like",
    "speechTurnId": "turn_789",
    "targetUserId": "user_456",
    "totalLikes": 12,
    "experienceAwarded": true
  }
}
```

### 4.10 `reward:created`

打赏成功后向整个房间广播，用于礼物动效和高亮系统消息；不包含任何账户余额。

```json
{
  "eventId": "evt_10",
  "roomId": "room_123",
  "roomVersion": 32,
  "serverTime": "2026-09-13T08:04:04.000Z",
  "data": {
    "rewardId": "reward_123",
    "speechTurnId": "turn_789",
    "amount": 10,
    "sender": {
      "userId": "guest_123",
      "identityType": "guest",
      "displayName": "围观群众",
      "avatarUrl": null,
      "level": 1,
      "levelTitle": "蛰伏"
    },
    "recipient": {
      "userId": "user_456",
      "identityType": "zhihu",
      "displayName": "某知友",
      "avatarUrl": null,
      "level": 2,
      "levelTitle": "破土"
    }
  }
}
```

同时会产生一条 `type=system` 的 `chat:created` 消息，并进入公屏历史。

### 4.11 `account:updated`

余额或经验变化后只向对应用户本人的连接发送，不向房间广播，也不带 `roomId` 和 `roomVersion`。

```json
{
  "eventId": "evt_account_1",
  "serverTime": "2026-09-13T08:04:04.000Z",
  "data": {
    "coinBalance": 90,
    "experience": 12,
    "level": 1,
    "levelTitle": "蛰伏",
    "nextLevelExperience": 500
  }
}
```

### 4.12 `speech:closed`

一次发言结束后广播，提示发言者上传录音，并提示其他客户端日志即将更新。

```json
{
  "eventId": "evt_10",
  "roomId": "room_123",
  "roomVersion": 32,
  "serverTime": "2026-09-13T08:04:04.000Z",
  "data": {
    "speechTurnId": "turn_789",
    "speakerUserId": "user_456",
    "startedAt": "2026-09-13T08:02:00.000Z",
    "endedAt": "2026-09-13T08:04:00.000Z",
    "releaseReason": "time_limit",
    "transcriptStatus": "pending"
  }
}
```

### 4.13 `transcript:updated`

```json
{
  "eventId": "evt_11",
  "roomId": "room_123",
  "roomVersion": 33,
  "serverTime": "2026-09-13T08:04:10.000Z",
  "data": {
    "speechTurnId": "turn_789",
    "status": "ready",
    "source": "asr",
    "text": "这是本次发言的转写内容。",
    "failureCode": null
  }
}
```

`status`：`pending`、`processing`、`ready`、`failed`。失败后前端向发言者提供手填摘要入口。

### 4.14 `summary:updated`

```json
{
  "eventId": "evt_12",
  "roomId": "room_123",
  "roomVersion": 34,
  "serverTime": "2026-09-13T08:04:20.000Z",
  "data": {
    "status": "ready",
    "summaryVersion": 3,
    "sourceTranscriptVersion": 8,
    "updatedAt": "2026-09-13T08:04:20.000Z"
  }
}
```

正文通过 REST `GET /rooms/{roomId}/summary` 获取，避免在广播中重复传输长文本。

### 4.15 `room:closed`

```json
{
  "eventId": "evt_13",
  "roomId": "room_123",
  "roomVersion": 35,
  "serverTime": "2026-09-13T08:10:00.000Z",
  "data": {
    "reason": "empty_timeout"
  }
}
```

## 5. 房间快照结构

```ts
type RoomSnapshot = {
  room: Room;
  seats: Array<{
    seatNumber: 1 | 2 | 3 | 4 | 5 | 6;
    occupant: PublicUser | null;
  }>;
  queue: Array<{
    position: number;
    userId: string;
    displayName: string;
    enqueuedAt: string;
  }>;
  speakerLock: {
    speechTurnId: string;
    userId: string;
    seatNumber: number;
    acquiredAt: string;
    expiresAt: string;
  } | null;
  cooldowns: Array<{
    userId: string;
    expiresAt: string;
  }>;
};
```

共享 TypeScript 类型位于 `packages/shared/src/realtime.ts`。前端使用 `Socket<ServerToClientEvents, ClientToServerEvents>`，服务端使用 `Server<ClientToServerEvents, ServerToClientEvents>`；本文档继续作为网络协议语义的事实来源。

## 6. 重连与清理

1. Socket.IO 断线后客户端按退避策略自动重连。
2. 重连成功后发送 `room:join`，携带 `lastKnownVersion`。
3. 服务端总是以完整快照恢复客户端，不能假设增量事件全部送达。
4. 短暂网络抖动使用服务端宽限时间；宽限期内保留麦位，但持有发言锁的用户停止心跳后应尽快释放锁。
5. 宽限时间由服务端配置，客户端不得写死。
6. 同一会话的新连接替换旧连接，避免同一用户重复占麦。

## 7. 限频建议

| 命令              | 建议限制                               |
| ----------------- | -------------------------------------- |
| `chat:send`       | 每会话 5 条/10 秒                      |
| `reaction:like`   | 每会话 10 次/10 秒，且同一发言只计一次 |
| `reward:send`     | 每会话 5 次/10 秒                      |
| `seat:request`    | 每会话 3 次/10 秒                      |
| `speaker:acquire` | 每会话 3 次/5 秒                       |

具体数值可通过服务端配置调整，但错误码固定为 `RATE_LIMITED`。
