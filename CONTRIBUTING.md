# 协作开发约定

## 分支

- `main`：保持可运行，不直接堆叠未完成开发。
- `feat/<scope>-<name>`：新功能，例如 `feat/server-room-lock`。
- `fix/<scope>-<name>`：问题修复。
- `docs/<name>`：仅文档或契约调整。

## 提交

建议使用简洁的 Conventional Commits：

```text
feat(room): implement speaker lock
fix(auth): restore return path after oauth
docs(api): add transcript contract
```

一个提交只处理一个可解释的变化，不提交 `.env`、密钥、Token、录音或构建产物。

## 接口优先

涉及前后端交互时：

1. 先修改 `docs/api/openapi.yaml` 或 `docs/api/realtime-events.md`。
2. 在 PR 描述中说明兼容性和需要同步修改的模块。
3. 前后端分别基于同一契约实现。
4. 联调后再合并。

## Pull Request

- 保持 PR 聚焦，避免同时重构无关模块。
- 写明已验证的用户链路和未验证项。
- API 变化必须附请求/响应或事件示例。
- 涉及发言锁时，至少验证两名用户同时抢锁最终只有一人成功。
- 涉及登录时，至少验证游客旁听、OAuth 返回原房间以及未登录不能上麦。
