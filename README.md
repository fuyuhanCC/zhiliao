# 知了

「知了」是一个面向知乎用户的实时语音辩论 Web 产品，以语音上麦辩论为核心、公屏互动为辅助，并通过知豆与辩手称号形成长期激励。用户可以围绕知乎热点或自定义主题进入房间；房间包含 6 个平等麦位，并通过唯一发言锁保证同一时间只有一人发言。讨论内容可整理为“刘看山辩论日志”。

## 需求文档基准

- [`docs/知了语音辩论产品PRD_MVP.md`](./docs/知了语音辩论产品PRD_MVP.md) 是本项目的产品 PRD 和需求基准。
- [`docs/current-version-scope.md`](./docs/current-version-scope.md) 只描述当前开发版本要完成的功能，是原始 PRD 的阶段性实现范围，不替代或删除原始需求。
- 未在当前版本范围中调整的产品规则，一律以原始 PRD 为准。

## 当前开发阶段

当前版本优先跑通“进入房间 → OAuth 登录上麦 → 6 席位轮流发言 → 公屏互动 → 刘看山辩论日志”的核心链路。知豆、打赏、每日任务、称号和简版商城仍保留在产品 PRD 中，暂不作为这一阶段的首要开发内容。

## 文档

- [产品 PRD（需求基准）](./docs/知了语音辩论产品PRD_MVP.md)
- [当前版本功能范围](./docs/current-version-scope.md)
- [技术架构与模块边界](./docs/architecture.md)
- [接口文档总览](./docs/api/README.md)
- [REST OpenAPI 契约](./docs/api/openapi.yaml)
- [Socket.IO 实时事件契约](./docs/api/realtime-events.md)
- [前后端开发与联调指南](./docs/integration-guide.md)
- [协作开发约定](./CONTRIBUTING.md)

## 工程结构

```text
apps/
  web/                 React + Vite + TypeScript
    src/features/      前端业务模块
  server/              Node.js + Express + Socket.IO
    src/domain/        房间、麦位和发言锁规则
    src/modules/       HTTP 用例与外部服务适配
    src/realtime/      Socket.IO 网关
    src/stores/        状态存储接口及内存实现
packages/
  shared/              前后端共享类型、事件名和常量
docs/
  api/                 HTTP 与实时事件协议
```

前端构建产物最终由 Node 服务托管，使整个项目可以通过一个 `npm run build` 和一个 `npm start` 运行，便于上传到 AI Works，也便于迁移到普通云服务器。

## 本地开发

建议使用项目在 `package.json` 中声明的 pnpm 版本：

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- Web 开发地址：`http://localhost:5173`
- Server 地址：`http://localhost:3000`
- 健康检查：`http://localhost:3000/api/v1/health`

生产构建与启动：

```bash
pnpm build
pnpm start
```

根级 `build` 和 `start` 脚本也可由部署平台通过 `npm run build` 与 `npm start` 调用。

## 协作约定

- `main` 保持可运行；功能开发使用短生命周期分支。
- API 字段或 Socket.IO 事件发生变化时，先更新 `docs/api` 中的契约。
- 密钥只能放在本地 `.env` 或部署平台环境变量中，不得提交到 Git。
- TRTC `SecretKey`、知乎 OAuth Secret 和用户 Token 只能由服务端使用。
