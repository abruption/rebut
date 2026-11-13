# 安装与输入收集

[한국어](../ko/installation.md) · [English](../en/installation.md) · **简体中文** · [日本語](../ja/installation.md)

[Rebut](../../../README.zh-CN.md) · [用户指南](../zh-CN.md)

## 安装 npm CLI

使用 Node.js **24 或更高版本**和 npm。安装自托管 Worker 的客户端及 stdio 桥接程序：

```sh
npm install -g rebut-mcp
```

## 配置客户端

设置自己的端点后保存 Bearer 令牌。macOS 默认使用 Keychain；`rebut set token` 使用隐藏输入的提示。`rebut set token --stdin` 明确接受受保护的管道输入。绝不要将令牌值放入参数或受版本控制的文件。

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
```

使用现有 Vaultwarden 安装时，请明确选择后端。它使用 `bw-get` 和默认条目 `Rebut — MCP Access Token`；需要时可自定义条目名称：

```sh
rebut set secret-store vaultwarden
rebut set vaultwarden-item NAME
```

非 macOS 环境请明确选择 `env`，通过安全执行环境提供 `REBUT_TOKEN`，不要写入受版本控制的文件或命令参数。后端不会自动回退。客户端无需 OpenAI 提供商密钥。

使用 `env` 后端时，Codex 设置仅保存变量名 `env_vars = ['REBUT_TOKEN']`，绝不保存其值。令牌必须通过实际运行 Codex 的宿主的安全执行环境提供；仅为设置命令提供该变量，不会使其在后续 Codex 会话中可用。

```sh
rebut set secret-store env
```

## 连接 Codex 并检查配置

```sh
rebut setup --client codex
rebut doctor
rebut doctor --connect
```

设置使用 `CODEX_HOME` 或 `~/.codex`；可通过 `--codex-home PATH` 指定目标。它将 `rebut mcp` 注册为 stdio 服务器，保留其他 MCP 条目。迁移现有私有 `rebut` 桥接配置需要 `--replace`。

`rebut doctor` 显示已清理敏感值的本地配置及凭据可用性。`rebut doctor --connect` 免费检查远程 `tools/list`；两者都不会启动付费审查。

## 源代码检出与开发者验证

npm 包是客户端，并非托管审查服务。Worker/D1 仍从 GitHub 源代码检出目录使用具有 Workers/D1 权限的自己的 Cloudflare 账户和 OpenAI Responses API 密钥部署。公开源代码/npm 不授予个人 Worker 或额度的访问权限。包中不包含真实端点、私有配置、Bearer 令牌、提供商密钥或审查正文。这些说明适用于 CLI `0.1.0`。

```sh
npm ci
npm run typecheck
npm run build
npm test
```

测试使用合成输入、模拟的提供商响应、真实 SQLite 语句及本地 Workers/D1 运行时。`npm test` 需要 `npm run build` 生成的 Worker 包。自动化测试不会进行付费模型调用。单独进行的 Luna 冒烟测试见[验证记录](validation.md)。

## 冻结审查输入

使用明确的源文件允许列表；不要自动收集整个仓库。收集器将冻结的 JSON 输出到标准输出。默认配置方案为 `astra-medium`；真实 API 测试必须明确使用 `luna-test`。

```sh
umask 077
rebut collect --root /path/to/project --request-id request-001 --requirements 'Check that the supplied function preserves its input' --profile astra-medium -- src/example.ts > /protected/path/request-001.bundle.json
```

收集器会拒绝符号链接、FIFO、秘密信息文件名、二进制文件及超出大小限制的材料。它会移除可识别的常见秘密信息模式，并保留行号。基于模式的脱敏并不完整：发送前请检查生成的输入包。也可以将文件作为带行号的片段提供，或直接提供 unified diff。规范化哈希和限制见[配置](configuration.md)。

## 私有部署

1. 将 `wrangler.jsonc` 复制为 `wrangler.private.json`（已被 Git 忽略）。设置您的账户 ID、可用的 Worker 名称、实际 D1 ID，以及 `workers_dev:true` 或您自己的路由。使用 `npx wrangler d1 create rebut-ledger` 创建专用 D1 数据库；将其 ID 填入私有配置。
2. 执行 `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json`。
3. 使用 `npx wrangler deploy --config wrangler.private.json` 部署。尚未配置的 Worker 返回 503，且无法调用提供商。
4. 保存三个 Workers Secret：`OPENAI_API_KEY`、`REBUT_CONFIG` 和 `AUTH_TOKENS`。使用 Wrangler 的交互式 Secret 提示，或通过受保护的标准输入使用 `secret bulk`；绝不要将秘密值放入参数或受版本控制的文件中。`REBUT_CONFIG` 使用 [`config.example.json`](../../../config.example.json) 中的结构；将 `hostname` 改为端点的准确主机名。`AUTH_TOKENS` 是一个 JSON 对象，将稳定的主体 ID 映射到独立生成的随机 256 位 Bearer 令牌的 SHA-256 摘要。将原始令牌存储在密码管理器中。使用相同令牌的客户端共享一个主体；不同令牌隔离请求/状态访问权限。
5. 将支持 Bearer 请求头的 MCP 客户端连接到 `https://YOUR_HOST/mcp`，并验证 `tools/list`。工具执行前会验证 Host 和浏览器 Origin。此 Bearer 配置未为要求 OAuth 发现的客户端实现 OAuth。

## 所有者配置方案管理的一次性升级

动态配置方案需要从源代码检出目录升级一次 Worker，应用 D1 迁移 `0002` 并设置 Worker Secret `ADMIN_TOKEN_SHA256`。保留账本，在现有 D1 数据库应用待处理迁移后，使用私有配置部署升级后的 Worker。生成单独的随机 256 位管理 Bearer 令牌，通过受保护的交互式 Secret 提示将其 SHA-256 哈希保存为 `ADMIN_TOKEN_SHA256`，并将原始令牌保存在凭据存储中。不要复用审查令牌或更改现有主体 ID。完成这一次性设置后，CLI 配置方案变更仅写入 D1，无需再次构建/部署 Worker 或升级 npm。

通过 `rebut set admin-token` 的隐藏输入保存所有者令牌，或明确使用 `rebut set admin-token --stdin` 接收受保护管道。已选择的 Vaultwarden 后端默认管理条目为 `Rebut — MCP Admin Token`，可用 `rebut set vaultwarden-admin-item NAME` 修改。env 后端使用安全执行环境中的 `REBUT_ADMIN_TOKEN`，绝不转发给 Codex。Keychain 服务 `com.abruption.rebut` 分开使用审查账户 `codex-mcp-bearer` 与管理账户 `codex-mcp-admin`。后端不会自动回退。模型偏好、列表查询、明确的费率及带修订条件的更新/移除见[配置](configuration.md)。

## 运行客户端

`rebut review` 从标准输入读取 JSON 输入包，仅在用户明确选择时启动付费审查。`rebut status REQUEST_ID` 是免费的元数据查询。

```sh
rebut review < /protected/path/request-001.bundle.json
rebut status request-001
```

服务器仅存储元数据，无法重放审查正文，请以严格权限在本地保存首次响应。超时或结果不确定后保留同一请求 ID。供应商等待期限为 1,800 秒（30 分钟），MCP HTTP 客户端为 1,830 秒，Codex 的 `tool_timeout_sec` 为 1,860 秒，为记录和传输结果留出时间。启动与握手仍使用独立的短期限。需同时更新 Worker 和 CLI，执行 `rebut setup --client codex --replace` 刷新已有配置并重启 Codex。仅修改宿主配置不能更新 0.1.0 CLI 内部的旧期限。参见[按需审查工作流](reviewer-integration.md)。

## 升级或移除

升级或移除部署之前，请按照[运维指南](operations.md)保留 D1 账本并核对待处理的执行。公开源代码与部署私有付费服务是两个独立的操作。

升级顺序为 **安装 CLI → 保留原选项并更新 Codex 注册 → 重启 Codex/MCP → 部署 Worker**。先部署更长期限的 Worker，旧 CLI 可能仍在 65 秒断开。保留 `REBUT_CONFIG_DIR` 等已有自定义注册选项。Node HTTP 的响应头／正文期限也与 MCP 工具期限一致。30 分钟是应用上限，不是所有网络或宿主的连接保证。休眠、终止或断线可能留下 reserved 或 unknown 预留；应查询原请求 ID，不自动重放或释放预留。
