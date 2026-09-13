# 前后端接口契约

本目录是前后端协作的单一事实来源（Single Source of Truth）。实现与文档不一致时，应先确认并更新契约，再修改两端代码。

## 文件

- [`openapi.yaml`](./openapi.yaml)：HTTP REST API，采用 OpenAPI 3.1。
- [`realtime-events.md`](./realtime-events.md)：Socket.IO 命令、事件、ACK、重连与状态同步规则。
- [`../integration-guide.md`](../integration-guide.md)：本地启动、分开开发、Mock 和联调验收流程。

对应的 TypeScript 类型位于 `packages/shared`：OpenAPI 生成类型通过 `@zhiliao/shared/openapi` 导入，Socket.IO 类型和事件名通过 `@zhiliao/shared` 导入。

## 协议职责

### HTTP REST

- 游客会话和知乎 OAuth。
- 热榜、知乎问题与房间查询。
- 创建房间、查询房间详情和获取 TRTC 凭证。
- 获取 TRTC 临时凭证。
- 获取房间主题的知乎背景资料、公屏历史、发言记录和 AI 总结。
- 上传发言音频、查询转写状态和触发结构化 AI 总结。

### Socket.IO

- 在线成员与房间快照同步。
- 进入、离开房间和断线清理。
- 6 个麦位与等待队列。
- 唯一发言锁、倒计时和冷却。
- 公屏消息、点赞、打赏和本人账户更新。
- 断线、重连和版本补偿。

## 通用约定

### 基础路径

```text
/api/v1
```

### 时间与标识

- 时间统一使用 UTC ISO 8601，例如 `2026-09-13T08:00:00.000Z`。
- 服务端生成的标识使用不可预测字符串；客户端不得依赖标识格式。
- 麦位编号为整数 `1..6`。
- 房间状态使用从 `1` 开始递增的 `version`。

### 会话

- 服务端通过 HttpOnly Cookie 保存会话。
- 首次访问调用 `POST /auth/guest` 建立游客会话。
- OAuth 成功后升级同一会话，避免丢失原房间和返回路径。
- REST 与 Socket.IO 共用该 Cookie；不得把知乎 Token 返回给 Web。

### 幂等与追踪

- 创建房间、点赞、触发总结、上传音频等写操作支持 `Idempotency-Key`。
- Socket.IO 命令使用 `requestId` 幂等去重。
- 每个 HTTP 响应返回 `X-Request-Id`；错误体也包含 `requestId`。

### 成功响应

HTTP 成功响应直接返回资源或结果，不额外套 `data`：

```json
{
  "roomId": "room_123",
  "status": "active"
}
```

### 错误响应

```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "需要登录知乎后才能上麦",
    "details": {},
    "requestId": "req_123"
  }
}
```

客户端根据稳定的 `code` 分支处理，不解析 `message`。建议的 HTTP 映射：

| HTTP | 错误码示例                                                                                        | 含义               |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------ |
| 400  | `VALIDATION_ERROR`                                                                                | 参数不合法         |
| 401  | `AUTH_REQUIRED`、`SESSION_EXPIRED`                                                                | 缺少或失效会话     |
| 403  | `FORBIDDEN`、`ZHIHU_LOGIN_REQUIRED`、`INVITE_REQUIRED`、`INVALID_INVITE_CODE`                     | 身份或邀请权限不足 |
| 404  | `ROOM_NOT_FOUND`、`SPEECH_TURN_NOT_FOUND`                                                         | 资源不存在         |
| 409  | `ALREADY_SEATED`、`SPEAKER_LOCKED`、`COOLDOWN_ACTIVE`                                             | 当前状态冲突       |
| 413  | `AUDIO_TOO_LARGE`                                                                                 | 音频超过上限       |
| 429  | `RATE_LIMITED`                                                                                    | 请求过于频繁       |
| 502  | `TRTC_UNAVAILABLE`、`ZHIHU_OAUTH_FAILED`、`ZHIHU_API_UNAVAILABLE`、`ASR_FAILED`、`SUMMARY_FAILED` | 外部服务失败       |

## 权限摘要

| 操作               | 游客 | 知乎登录用户 |
| ------------------ | :--: | :----------: |
| 浏览话题与房间     |  ✓   |      ✓       |
| 进房旁听、查看日志 |  ✓   |      ✓       |
| 发公屏、点赞       |  ✓   |      ✓       |
| 打赏当前发言者     |  ✓   |      ✓       |
| 创建房间           |  —   |      ✓       |
| 排队、上麦、发言   |  —   |      ✓       |
| 上传本人发言音频   |  —   |      ✓       |

## 知乎上游接口注意事项

- 通用数据接口位于 `https://developer.zhihu.com/api/v1`，使用 `Authorization: Bearer <access_secret>` 和秒级 `X-Request-Timestamp`。
- 直答接口地址为 `https://developer.zhihu.com/v1/chat/completions`，不与通用数据接口共用同一个路径前缀。
- OAuth 授权入口和 Token 接口位于 `https://openapi.zhihu.com`；回调参数名是 `authorization_code`。
- 知乎问题回答接口接收完整 `QuestionUrl`，返回回答链接与摘要，但不保证返回问题标题。因此通过问题创建房间时，前端必须允许用户补充或确认标题。
- 热榜接口当前单次最多返回 30 条；本服务可以缓存并转换字段，但不得伪造知乎热度值。
- 知乎搜索接口单次最多返回 10 条；房间背景资料由服务端使用房间主题搜索并缓存，前端只使用返回的 `zhihuUrl` 跳转原文。
- OAuth `app_key`、开放平台 `Access Secret` 和用户 `access_token` 只能保存在服务端。

## 变更流程

1. 在功能分支先修改 OpenAPI 或实时事件文档。
2. 在 PR 中明确兼容性：兼容、需前后端同时升级或破坏性变更。
3. 前后端基于同一字段名并行实现。
4. 联调通过后再合并到 `main`。

MVP 阶段禁止静默修改字段语义。删除字段或改变类型时，应新增接口版本或先经历弃用周期。
