# Server 业务模块

`modules` 负责 REST 用例及外部能力适配：`auth`、`zhihu-gateway`、`rtc-credential`、`transcript` 和 `summary`。模块可以依赖 `domain` 与 `stores`，但领域规则不得反向依赖 Express 或 Socket.IO。
