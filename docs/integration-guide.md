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
    inviteCode: null,
  },
  (ack) => {
    if (ack.ok) {
      console.log(ack.data.room);
    }
  },
);
```

服务端 `Socket.IO Server` 已绑定 `ClientToServerEvents` 和 `ServerToClientEvents`，错误的事件名、载荷或 ACK 会在编译阶段暴露。

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
7. 公屏与点赞：幂等、限频和广播。
8. TRTC：凭证、进房、获得发言锁后发布音频。
9. 转写与总结：状态广播、REST 正文和失败降级。

## 9. 每次联调的最低验收

- 普通窗口和无痕窗口至少模拟两个独立会话。
- 游客可旁听和公屏互动，但不能创建房间或上麦。
- OAuth 成功后能回到原页面，浏览器拿不到知乎 Token。
- 两人同时申请发言锁时，服务端只允许一人成功。
- `roomVersion` 断层后客户端通过 `room:resync` 恢复完整快照。
- 断线、下麦和超时都会释放发言锁并产生一致的结束原因。
- 前端只在发言锁成功 ACK 后发布 TRTC 音频。
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
