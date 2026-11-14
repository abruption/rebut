# 运维与恢复

[한국어](../ko/operations.md) · [English](../en/operations.md) · **简体中文** · [日本語](../ja/operations.md)

[README](../../../README.zh-CN.md) · [安装](installation.md) · [配置](configuration.md)

## unknown 恢复

`reserved` 可能仍在运行或已中断；`unknown` 表示结果或用量不确定。两者均可能已计费，不自动重试、到期或退款。一个未解决请求就可能占用默认槽位并阻止新审查。

1. 用相同后端、principal 和 `REBUT_CONFIG_DIR` 查询 `rebut status REQUEST_ID`。ID 丢失时，本地 `rebut status --pending` 最多列出 100 条并显示 `has_more`。本地查询无需 OpenAI 密钥，Worker 查询使用已有接入令牌；均不调用付费模型。
2. 停止宿主，备份已关闭的本地 SQLite 和设置。Worker D1 使用 Cloudflare 导出/Time Travel 备份。
3. 对照原 ID、输入哈希、配置档及可用的供应商请求/用量证据。仅 `not_found` 不证明未执行，不以其他后端或新 ID 重试。
4. 不确定时保留行、全额记账预留和槽位。只有具有独立证据的操作者才可核对并结算对应 `(principal, request_id)`；应用没有强制释放、退款或删除工具。
5. 明确要启动**另一项新审查**的操作者可用本地 `rebut set max-concurrent N` 增加必要容量（最多 10），保留原预留。这不是释放原请求或重放授权；金额上限继续生效，自定义限制快照不变，之后重启宿主。

`budget_reserved_microusd`、`budget_accounted_microusd` 是应用记账值，不是确认账单。十个槽位都不确定时，停止直到有证据结算。之后恢复预期容量并重启。删除行会丢失去重能力，不是恢复手段。

## 诊断

`rebut doctor` 检查本地设置和凭据，`doctor --connect` 检查所选后端与工具列表；均不进行付费审查，也不验证供应商账户访问。区分 SSH 下 Keychain 失败和同一设备登录会话中的成功。

新的 unknown 记录可能包含 `unknown_reason`、`provider_elapsed_ms`、供应商 ID 和 `upstream_status`，不保留正文或异常字符串。HTTP 错误之后也可能在读正文时超时，需结合字段判断。耗时不证明执行/计费已完成，也不补回历史缺失字段。

SIGINT/SIGTERM 尝试记录 unknown 并关闭。SIGKILL、崩溃或断网可能留下 reserved。任何路径都不自动重放。

## 升级与密钥轮换

按 **CLI → Codex 注册 → 重启宿主 → Worker** 更新。保留自定义目录，注册前备份整个 `config.toml`。参见[安装命令](installation.md#codex-注册与更新)。

使用 0.2.0 专有字段前备份 `config.json`。0.1.0 会拒绝这些字段，Worker 用户降级也可能需要恢复旧设置。使用本地账本后降到 0.1.0 不等于恢复账本，不能为兼容设置而删除账本。

Worker 保持相同 D1，只应用未完成迁移。轮换 bearer 时更新 `AUTH_TOKENS` 摘要和客户端凭据存储，保留 principal ID。单独轮换 `OPENAI_API_KEY`。管理员令牌不放入 MCP 配置。`rebut remove` 仅删除注册。

## 开发验证

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run test:package
```

Worker 测试使用构建产物。自动测试/包 smoke 模拟供应商，不证明付费 API 权限或模型质量。实际 API 测试默认 `luna-test`，运行默认 `astra-medium`；Luna 成功不证明 Astra 可用性或质量。历史详情见 [0.2.0 源码记录](https://github.com/abruption/rebut/tree/v0.2.0/docs/guide/zh-CN)。

源码边界：`service.ts` 负责哈希、配置档和预留/记账；`review.ts` 负责供应商/证据验证；`local.ts` 提供 stdio/SQLite；`worker.ts` 提供 HTTP 认证/D1。本地按目录记账，Worker 共享部署账本。

## npm 发布

手动 `publish.yml` 从 main 运行，验证标签/源码/版本，并在 `npm` Environment 获得所有者批准。构建和 smoke 没有 OIDC 写权限，只有已验证 tarball 的发布任务有。PR 合并或 GitHub Release 事件不自动发布。

发布/验证出错时先检查原运行及注册表版本、完整性，再决定是否重试。不要重新发布已公开的版本。[韩语发布清单](../../releases/release-checklist.ko.md#github-actions-trusted-publisher)说明设置、批准和七天 artifact 保留期。此工作流不部署 Worker 或更新已有客户端。
