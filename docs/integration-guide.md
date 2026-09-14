# 前后端开发与联调指南

本文说明“知了”前后端并行开发时的契约、启动方式和联调验收流程。日常联调不需要先部署服务器；OAuth 回调、跨设备测试和非 localhost 的麦克风采集可能需要临时 HTTPS 地址。

## 1. 协作边界

| 角色     | 主要目录                      | 主要职责                                                    |
| -------- | ----------------------------- | ----------------------------------------------------------- |
| 前端     | `apps/web`                    | 页面、交互、客户端状态、Socket.IO 客户端和 TRTC Web SDK     |
| 后端     | `apps/server`                 | REST、会话、房间规则、Socket.IO 服务端、TRTC 凭证和外部接口 |
| 双方共享 | `packages/shared`、`docs/api` | 网络契约、生成类型、事件名和公共常量                        |

前端不得通过本地状态自行裁决麦位、发言锁或冷却；后端不得在未更新契约的情况下静默修改字段和事件。

## 2. 单一事实来源

- REST：[`api/openapi.yaml`](./api/openapi.yaml)
- Socket.IO：[`api/realtime-events.md`](./api/realtime-events.md)
- OpenAPI 生成类型：`packages/shared/src/generated/openapi.ts`
- Socket.IO 类型：`packages/shared/src/realtime.ts`

OpenAPI 变化后执行：

```bash
pnpm --filter @zhiliao/shared generate:api
pnpm --filter @zhiliao/shared build
```

生成文件需要和契约一起提交，不能手工修改。

## 3. 第一次启动

```bash
pnpm install
cp .env.example .env
pnpm dev
```

默认地址：

| 服务      | 地址                                  |
| --------- | ------------------------------------- |
| Web       | `http://localhost:5173`               |
| Server    | `http://localhost:3000`               |
| REST      | `http://localhost:5173/api/v1`        |
| Socket.IO | `http://localhost:5173/socket.io`     |
| 健康检查  | `http://localhost:5173/api/v1/health` |

开发时浏览器只访问 Vite：

```text
Browser :5173 ── /api/* ──────> Vite proxy ──> Server :3000
              └─ /socket.io/* ─> Vite proxy ──> Server :3000
```

这种方式让 Cookie、REST 和 Socket.IO 在浏览器看来保持同源。前端业务代码不得写死 `localhost:3000`。

### 3.1 知乎 OAuth 本地配置

按照[知乎 OAuth 官方文档](https://developer.zhihu.com/docs?key=zhihu_oauth_integrated)申请 `app_id` 和 `app_key`，并将登记的回调地址与环境变量保持完全一致：

```dotenv
ZHIHU_OAUTH_APP_ID=<申请到的 app_id>
ZHIHU_OAUTH_APP_KEY=<申请到的 app_key>
ZHIHU_REDIRECT_URI=http://localhost:3000/api/v1/auth/zhihu/callback
```

前端从 `GET /api/v1/auth/zhihu/authorize?returnTo=<站内路径>` 开始登录，不应自行拼装知乎授权地址，也不能接触 `app_key` 或用户 Token。当前官方文档尚未公布“获取用户信息”接口的 URL 和响应结构，因此现阶段授权成功后保留用户已有昵称与头像；知乎补充该接口后再在服务端 OAuth 网关中接入真实资料。

### 3.2 多用户本地调试

同时配置 `NODE_ENV=development` 和 `ENABLE_DEVELOPMENT_SESSIONS=true` 时，服务端额外注册 `POST /api/v1/auth/dev-session`，用于创建具备上麦权限的模拟知乎用户。该接口不属于正式 OpenAPI；生产环境禁止启用这个开关，也不会注册该路由。

请求示例：

```http
POST /api/v1/auth/dev-session
Content-Type: application/json

{
  "userIndex": 1,
  "displayName": "一号测试员"
}
```

`userIndex` 取值为 `1..99`，映射为稳定的 `dev_zhihu_<userIndex>`。在不同 Chrome Profile 中分别使用不同编号，即可获得相互隔离的 Cookie、账户和 Socket.IO 身份。同一 Profile 的多个标签页共享会话，不能用于模拟不同用户。

可以直接在每个 Profile 的浏览器控制台执行：

```js
await fetch("/api/v1/auth/dev-session", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ userIndex: 1, displayName: "一号测试员" }),
});
location.reload();
```

修改 `userIndex` 后可模拟最多 6 名麦上用户和第 7 名排队用户。这个会话只跳过 OAuth 登录过程，麦位、发言锁、冷却、知豆和打赏仍走真实后端规则。

## 4. 分别启动

后端开发者：

```bash
pnpm build:shared
pnpm --filter @zhiliao/server dev
```

前端开发者：

```bash
pnpm build:shared
pnpm --filter @zhiliao/web dev
```

需要真实接口时，前端开发者在另一个终端启动后端，或者直接在根目录运行 `pnpm dev`。前端不需要修改后端代码，只需拉取包含所需接口的提交。

## 5. 连接另一台电脑上的后端

前端仍然通过 Vite 代理访问后端。在前端电脑的 `.env` 中修改：

```dotenv
DEV_PROXY_TARGET=http://192.168.1.20:3000
```

如果前端页面不是从 `http://localhost:5173` 打开，后端的 `WEB_ORIGIN` 必须改成实际前端 Origin。不要把 OAuth Secret、TRTC SecretKey 或知乎 Token 放入任何 `VITE_` 变量。

使用局域网 IP 打开页面时，浏览器通常不会把它视为安全上下文，麦克风权限可能不可用。跨设备联调 TRTC 时应使用 HTTPS 开发地址；纯 REST 和 Socket.IO 状态联调不受此限制。

## 6. 前端使用契约

REST 类型从共享包导入：

```ts
import type { components, operations } from "@zhiliao/shared/openapi";

type Room = components["schemas"]["Room"];
type CreateRoom = operations["createRoom"];
```

Socket.IO 客户端已经封装为惰性连接：

```ts
import { CLIENT_EVENTS } from "@zhiliao/shared";
import { createAppSocket } from "./lib/socket";

const socket = createAppSocket();
socket.connect();
socket.emit(
  CLIENT_EVENTS.roomJoin,
  {
    requestId: crypto.randomUUID(),
    roomId: "room_123",
    lastKnownVersion: null,
  },
  (ack) => {
    if (ack.ok) {
      console.log(ack.data.room);
    }
  },
);
```

连接 Socket.IO 前，前端必须先调用游客会话接口或恢复已有会话，确保浏览器已经持有 `zhiliao_session` Cookie。服务端会拒绝无有效会话的握手；同一会话只保留最新连接。

`GET /api/v1/auth/session` 的 `account` 是当前用户的私有账户数据，包含知豆余额、经验、等级和下一等级门槛。房间快照及各实时事件中的 `PublicUser` 只包含可公开的 `level` 和 `levelTitle`，不得从这些数据推算或展示他人的余额。

断线后发言锁立即释放，麦位和排队状态默认保留 10 秒供重连恢复。后端可通过 `REALTIME_DISCONNECT_GRACE_MS` 调整宽限时间；前端不要写死该时长，重连后始终发送 `room:join` 获取完整快照。

房间最后一人真正离开后进入默认 60 秒空房回收宽限期，由 `ROOM_EMPTY_RECLAIM_MS` 配置。宽限期内重新进入会取消回收；超时后收到 `room:closed` 的客户端应返回大厅。私人房表示用户创建的公开自定义话题房，当前版本没有邀请码流程。

服务端 `Socket.IO Server` 已绑定 `ClientToServerEvents` 和 `ServerToClientEvents`，错误的事件名、载荷或 ACK 会在编译阶段暴露。

公屏和发言日志首屏分别通过 `GET /rooms/{roomId}/messages` 与 `GET /rooms/{roomId}/speech-turns` 获取。接口返回最近一页、页内按时间正序排列；继续加载更早内容时原样传回 `nextCursor`，不要解析游标内容。

房间背景资料通过 `GET /rooms/{roomId}/materials?limit=5` 获取。搜索词由后端根据房间主题生成；前端不要额外传入关键词。点击资料时打开响应中的 `zhihuUrl`，新窗口链接应设置 `rel="noopener noreferrer"`。

官方热榜房通过 `GET /topics/hot` 与 `GET /rooms?type=hot` 获取。后端会使用知乎热榜内容生成稳定的官方房：`room.type` 为 `hot`、`visibility` 为 `public`、`creator` 为 `null`。知乎上游不可用时返回 `source=fallback` 的预置话题与对应官方房；前端可以展示降级提示，但不应阻断进入房间。

打赏只能发生在某次仍有效的当前发言中。前端发送 `reward:send` 时传入当前 `speechTurnId` 和 `amount`（仅 `5 | 10 | 50`），收款人由后端根据发言锁确定，不能由前端指定。成功 ACK 直接返回打赏者的 `remainingBalance`；房间内所有人收到不含余额的 `reward:created` 和高亮系统消息，打赏双方分别收到只发给本人的 `account:updated`。重复发送同一个 `requestId` 不会重复扣款。

### 6.1 单次发言录音、转写与总结

前端使用 `apps/web/src/lib/speech-turn-recorder.ts` 中的 `SpeechTurnRecorder`。在 `speaker:acquire` 成功 ACK 且 TRTC 开始发布后，复制 TRTC 的本地麦克风音轨用于本轮录制，避免再次申请麦克风；收到对应 `speech:closed`（主动闭麦也会产生该事件）后停止录制，并调用 `uploadSpeechTurnAudio`。不要录制整场房间，也不要把远端混音上传。上传或 ASR 失败时，浏览器会在当前页面会话内保留该段录音，发言者可在辩论日志中重试；刷新或关闭页面后不保留原始录音。

浏览器必须从 `audio/mp4`（m4a）和 `audio/ogg;codecs=opus` 中选择实际支持的格式。腾讯云极速版 ASR 不接受 WebM，因此仅支持 `audio/webm` 的浏览器要提示“当前浏览器不支持转写”，但这不影响 TRTC 实时语音。

上传接口返回 `202 processing` 后，页面以 Socket.IO 的 `transcript:updated` 为准更新状态；刷新后则通过发言日志 REST 恢复。用户打开辩论日志时调用 `POST /rooms/{roomId}/summary/generate`，随后监听 `summary:updated`，再通过 `GET /rooms/{roomId}/summary` 拉取完整正文。相同 `transcriptVersion` 会复用已有结果。

本地启用完整链路需要服务端 `.env` 至少配置：

```dotenv
ASR_PROVIDER=tencent_flash
TENCENT_CLOUD_APP_ID=<腾讯云账号 AppID>
TENCENT_CLOUD_SECRET_ID=<API SecretId>
TENCENT_CLOUD_SECRET_KEY=<API SecretKey>
ZHIHU_ACCESS_SECRET=<知乎开放平台 Access Secret>
```

`TENCENT_CLOUD_APP_ID` 是腾讯云账号 AppID，不是 TRTC 的 `SDKAppID`。密钥仅放在服务端，不得写入 `VITE_` 变量。

## 7. 后端未完成时的前端开发

前端可以根据 OpenAPI 和实时事件文档维护少量 fixture，但必须遵守以下规则：

1. fixture 类型使用 `@zhiliao/shared/openapi`，禁止重新声明同名业务类型。
2. fixture 只模拟契约中已有的状态和错误码。
3. 不确定的字段先修改或确认契约，不在 Mock 中自行发明。
4. 接入真实接口后删除对应临时分支，避免 Mock 长期掩盖服务端问题。

当前工程尚未引入 Mock 框架；需要大规模模拟 REST 时可单独引入 MSW，不应把 Mock 判断散落在页面组件里。

## 8. 推荐联调顺序

1. `GET /health`：确认代理和服务运行。
2. 游客会话：确认 Cookie 能写入并随 REST、Socket.IO 请求携带。
3. 话题与房间 REST：大厅、详情和创建房间。
4. `room:join`：首次快照、版本号和重连恢复。
5. 麦位与队列：上麦、取消、下麦和自动补位。
6. 发言锁：同时抢锁、120 秒超时、主动释放和 60 秒冷却。
7. 公屏与点赞：幂等、限频、经验更新和广播。
8. 打赏：仅当前发言者可收款、三档金额、余额不足、重复请求与余额私有更新。
9. TRTC：凭证、进房、获得发言锁后发布音频。
10. 转写与总结：状态广播、REST 正文和失败降级。

## 9. 每次联调的最低验收

- 普通窗口和无痕窗口至少模拟两个独立会话。
- 游客可旁听和公屏互动，但不能创建房间或上麦。
- OAuth 成功后能回到原页面，浏览器拿不到知乎 Token。
- 两人同时申请发言锁时，服务端只允许一人成功。
- `roomVersion` 断层后客户端通过 `room:resync` 恢复完整快照。
- 断线、下麦和超时都会释放发言锁并产生一致的结束原因。
- 前端只在发言锁成功 ACK 后发布 TRTC 音频。
- 打赏只能转给当前发言者；房间广播不包含任何用户的知豆余额。
- 所有失败分支依据稳定的错误码处理，不解析错误文案。

## 10. 分支与变更流程

1. 接口变化先修改 `docs/api`，并说明是否兼容。
2. REST 变化重新生成 OpenAPI 类型；实时协议同步修改共享事件类型。
3. 后端和前端分别在 `feat/server-*`、`feat/web-*` 分支开发。
4. 一端完成后先合并可独立验证的契约兼容实现，另一端同步最新 `main`。
5. 联调通过后再合并依赖另一端的页面或业务流程。

不建议长期维护独立的“前端版接口”和“后端版接口”，也不建议在聊天记录中约定字段而不更新仓库契约。

## 11. 常见问题

| 现象                  | 优先检查                                                    |
| --------------------- | ----------------------------------------------------------- |
| REST 404              | 路径是否包含 `/api/v1`，后端路由是否已实现                  |
| Cookie 没带上         | 是否使用相对 URL、`credentials: "include"`，Origin 是否匹配 |
| Socket.IO 连接失败    | `path` 是否为 `/socket.io`，Vite WebSocket 代理是否生效     |
| 收到事件但页面不更新  | `roomVersion` 是否连续，是否错误地用本地缓存覆盖快照        |
| OAuth 回调失败        | 回调 URL 是否在知乎后台登记，环境变量是否与当前地址一致     |
| 浏览器无法开麦        | 页面是否为 localhost 或 HTTPS，麦克风权限和设备是否可用     |
| TRTC 能进房但不能说话 | 是否拿到发言锁成功 ACK，凭证角色是否为 speaker              |
