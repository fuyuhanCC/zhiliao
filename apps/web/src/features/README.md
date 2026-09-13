# Web feature 边界

业务代码按功能纵向拆分：`auth`、`lobby`、`topic`、`room`、`seats`、`speaker`、`rtc`、`chat` 和 `debate-log`。每个 feature 可以包含自己的组件、状态、请求封装与测试；跨 feature 的通用代码放在 `src/lib`，页面级编排放在 `src/pages`。

前端不得自行裁决麦位、发言锁或冷却状态，必须以服务端 REST/Socket.IO 契约为准。
