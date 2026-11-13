# 架构

[한국어](../ko/architecture.md) · [English](../en/architecture.md) · **简体中文** · [日本語](../ja/architecture.md)

[Rebut](../../../README.zh-CN.md) · [用户指南](../zh-CN.md)

## 本地与 Worker 执行

新安装使用本地 stdio MCP → 共用审查服务 → 私有 SQLite 预留 → 一次 OpenAI Responses 调用 → 验证与元数据结算，无需 Cloudflare 账户、本地 HTTP 端口或守护进程。明确选择的 Worker 模式继续使用认证 HTTP MCP → D1 → 同一供应商适配器。

src/service.ts 负责哈希、配置方案、请求所有权和结算，src/review.ts 负责供应商／证据验证，src/local.ts 负责 Node SQLite／stdio，src/worker.ts 保留 HTTP 认证与 D1 绑定。本地供应商密钥与 Worker 访问／管理员令牌分离。两种账本都不存储源码、审查正文或密钥。本地预算和 ID 仅属于一个目录；Worker 共享该部署账本。后端切换不迁移历史，也不授权重放不确定请求。

以下为 Worker 专用流程和参考。


客户端明确允许列表 → 脱敏/冻结/哈希 → 经过身份验证的 Streamable HTTP MCP → 验证配置方案/哈希 → 原子 D1 预留 → 一次受限 Responses 调用 → 模式/证据/用量验证 → 元数据结算 → 将审查返回客户端。

与宿主无关的契约和提供商适配器位于 `src/contracts.ts` 和 `src/review.ts`；`src/worker.ts` 提供 MCP/身份验证，`src/ledger.ts` 提供 D1 适配器。Cloudflare 的逐请求 `createMcpHandler` 使用 MCP SDK v2，并支持旧版无状态客户端。有状态会话、后台任务、OAuth、模型驱动的工具、仓库访问及持久化审查重放均不在此 MVP 范围内。

单条 `INSERT ... SELECT` 在写入请求行的同时，评估全局 UTC 预算、有效预留及每日请求数。唯一键 `(principal,request_id)` 通过不可预测的认领值选出唯一拥有者。只有该拥有者会分派提供商调用并结算该行。崩溃窗口会保留预留；执行从不依赖 `waitUntil` 或自动到期的租约。提供的资料中包含的指令被视为数据，发现必须引用所提供的行，模型也没有执行工具。

以下参考资料核查于 2026-11-12：

- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Cloudflare MCP 处理器](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

已通过真实的本地 Workers/D1 运行时，使用合成的上游响应检查兼容性。这不能证明支持任意客户端，也不能证明审查质量与其他模型相当。
