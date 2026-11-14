# 安装与使用

[한국어](../ko/installation.md) · [English](../en/installation.md) · **简体中文** · [日本語](../ja/installation.md)

[README](../../../README.zh-CN.md) · [配置](configuration.md) · [运维](operations.md)

需要 Node.js 24+。已验证 macOS/Linux；Windows 行为与 ACL 尚未验证。

## 本地 MCP

新安装使用 macOS Keychain 的示例：

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

重启宿主后运行本地 stdio 服务器，无需 Cloudflare 或 HTTP 服务器。审查材料使用自己的密钥发送至 OpenAI。`doctor --connect` 检查凭据是否可用及 MCP 工具，不进行付费审查，也不验证 API 账户权限。

已有 endpoint 配置会保留 Worker 模式。切换到本地时执行 `rebut set mode local`、设置密钥并更新注册。切换不会迁移账本。

其他凭据方式：

| 方式                   | 选择                                 | 本地 OpenAI 密钥                                               |
| ---------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Keychain（macOS 默认） | `rebut set secret-store keychain`    | `rebut set api-key` 隐藏输入                                   |
| 环境变量（Linux 默认） | `rebut set secret-store env`         | 实际 MCP 宿主环境中的 `REBUT_OPENAI_API_KEY`                   |
| Vaultwarden            | `rebut set secret-store vaultwarden` | 准备 `bw-get` 后执行 `rebut set vaultwarden-api-key-item NAME` |

Vaultwarden 需要已认证的 `bw-get` 可执行文件：以项目名为参数，将秘密值输出到 stdout。可在 MCP 宿主环境中通过 `REBUT_BW_GET` 指定其路径。

不要把凭据放入 CLI 参数或跟踪文件。env 注册只记录变量名。共享 `OPENAI_API_KEY` 需显式执行 `rebut set api-key-env OPENAI_API_KEY`，没有自动回退。各角色见[配置](configuration.md)。

## Codex 注册与更新

```sh
npm install -g rebut-mcp
rebut setup --client codex --replace
rebut doctor --connect
```

注册使用 `CODEX_HOME` 或 `~/.codex`，其他位置用 `--codex-home PATH`。执行 `setup --replace` 前备份整个 `config.toml`，并在 setup 所在 shell 提供相同的自定义 `REBUT_CONFIG_DIR`。注册后重启宿主；运行中的进程不会重载设置。

Worker 用户按 **CLI → 注册 → 重启宿主 → Worker** 更新。供应商/HTTP 客户端/Codex 工具限制分别为 1,800/1,830/1,860 秒，不保证网络连接持续存在；其他宿主也需设置适合长审查的期限。

`rebut remove --client codex` 仅删除注册，不删除设置、凭据或账本。备份与降级见[运维](operations.md)。

## 执行审查

```sh
umask 077
rebut collect --root /path/to/project --request-id review-001 --requirements 'Check the supplied code' --profile astra-medium -- src/example.ts > /protected/path/review-001.bundle.json
rebut review < /protected/path/review-001.bundle.json
rebut status review-001
```

明确选择文件。收集器拒绝危险文件、符号链接、FIFO 和二进制文件，并屏蔽常见秘密模式；发送前仍需检查材料。`review` 是付费调用，`status` 查询元数据。保存首次响应，审查正文不能重放。

明确选择付费审查。确认 `completed`，将返回的模型和输入哈希与冻结材料及配置档对照，再逐条核对原始证据。独立审查应使用同一份冻结材料，不共享各审查者结果。timeout/unknown 后保留原 ID 与后端，不以新 ID 重试，按[恢复流程](operations.md#unknown-恢复)处理。

## 可选 Worker 部署

需要跨设备共享预算和请求账本时使用。部署需要源码、自己的 Cloudflare 账户和 D1。

1. 检出源码并执行 `npm ci --ignore-scripts`。将 `wrangler.jsonc` 复制为被忽略的 `wrangler.private.json`，填写自己的账户、Worker 名称和主机设置。
2. 执行 `npx wrangler d1 create rebut-ledger --config wrangler.private.json` 创建 D1，把 ID 写入私有 `DB` 绑定。
3. 执行 `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json` 应用现有 `0001`、`0002`。升级保留同一 D1 和请求行。
4. 执行 `npx wrangler deploy --config wrangler.private.json` 部署。配置完成前返回 503。
5. 使用 `npx wrangler secret put NAME --config wrangler.private.json` 的交互输入保存以下秘密，值不要放在参数中。

| Worker 秘密          | 内容                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| `OPENAI_API_KEY`     | 自己的供应商密钥                                                                     |
| `REBUT_CONFIG`       | 符合[配置示例](../../../config.example.json)的 JSON，`hostname` 为实际 endpoint 主机 |
| `AUTH_TOKENS`        | 稳定 principal ID → 独立随机 256 位 bearer 的 SHA-256 摘要                           |
| `ADMIN_TOKEN_SHA256` | 需要管理配置档时，使用独立管理员 bearer 的 SHA-256 摘要                              |

原 bearer 存入凭据存储。区分审查和管理员令牌，轮换令牌时保留 principal ID。这是 Bearer 认证，不实现 OAuth。

macOS 客户端设置：

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
rebut setup --client codex --replace
rebut doctor --connect
```

设置 endpoint 会选择 Worker 模式，使用接入令牌而非本地 OpenAI 密钥。env/Vaultwarden 项目及管理员凭据见[配置](configuration.md)。Worker 部署与 npm 更新是独立操作。
