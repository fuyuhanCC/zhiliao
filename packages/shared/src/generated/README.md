# OpenAPI 生成类型

`openapi.ts` 由 `docs/api/openapi.yaml` 自动生成。契约变化后运行 `pnpm --filter @zhiliao/shared generate:api` 并提交更新；业务代码不要手工修改生成文件。

前后端通过 `import type { paths, components, operations } from "@zhiliao/shared/openapi"` 使用这些类型。
