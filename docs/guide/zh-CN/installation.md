# 安装与使用

[한국어](../ko/installation.md) · [English](../en/installation.md) · **简体中文** · [日本語](../ja/installation.md)

[README](../../../README.zh-CN.md) · [配置](configuration.md) · [运维](operations.md)

需要 Node.js 24 或更高版本。已在 macOS 和 Linux 上验证。Windows 本地 MCP 的使用范围见下文。

## CLI 帮助与注册检查

使用 `rebut help setup` 或 `rebut profile list --help` 查看具体命令的用法。

运行 `rebut setup --check --client codex` 或 `rebut setup --check --client claude`，查看宿主配置中 Rebut 的启动设置。如果设置了 `CODEX_HOME`，Codex 会使用该位置，也可以用 `--codex-home PATH` 指定其他位置。如果 Claude 的用户配置文件放在其他位置，或已设置 `CLAUDE_CONFIG_DIR`，请指定 `--claude-config PATH`。

`current_launcher` 表示已注册的 Node.js 和 Rebut CLI 指向当前命令所用的文件，且宿主参数也一致。检查会区分未注册（`not_registered`）、文件缺失（`missing_launcher`）和启动设置不同（`different_launcher`），也会标明自定义注册（`custom_registration`）、已禁用的 Codex 注册（`disabled`）和无法验证的路径（`unverified_launcher`）。此命令读取所选用户配置并检查启动文件。实际连接状态请在宿主中确认。

## Windows 本地 MCP

在 Windows 上，本地 MCP 从环境变量 `REBUT_OPENAI_API_KEY` 读取 OpenAI API 密钥。请在 Windows 用户配置文件目录下选择一个专用数据目录，避开共享文件夹。如果该目录中没有 `config.json`，Rebut 会按默认的本地配置启动。如果文件已存在，Rebut 会拒绝启动。运行 `rebut.cmd set mode local` 等写入配置的命令也会报错。

我们在 Windows 10 x64 和 Node.js 24 上安装了 `rebut-mcp@0.4.1`，分别通过 Codex CLI 的 App Server 和 Claude Code CLI 使用模拟响应完成了审查，然后在新的 MCP 进程中查询了原请求的状态。在 0.4.1 上实际向 OpenAI 发起的审查请求遇到传输错误，状态为 `unknown`。桌面应用连接和 Worker 模式仍需在 Windows 上验证。

以下命令适用于首次安装。如果已在 Windows 上使用 Rebut，请继续使用原有的 `REBUT_CONFIG_DIR`，以便查看之前的请求和用量记录。要注册到 Claude Code，请在最后一行使用 `--client claude`。

```powershell
npm.cmd install -g rebut-mcp
$env:REBUT_CONFIG_DIR = Join-Path $env:LOCALAPPDATA 'Rebut\local-mvp'
$rebutKey = Read-Host 'OpenAI API key' -AsSecureString
try {
    $env:REBUT_OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $rebutKey).Password
} finally {
    $rebutKey.Dispose()
    Remove-Variable rebutKey
}
rebut.cmd doctor --connect
rebut.cmd setup --client codex
```

如果全局安装需要管理员权限，请运行 `npm.cmd install -g --prefix "$env:APPDATA\npm" rebut-mcp`，安装到当前用户的目录。如果 PowerShell 找不到 `rebut.cmd`，请将 `%APPDATA%\npm` 加入 Windows 环境变量设置中的用户 `PATH`，然后重新打开 PowerShell。更新时也请使用相同的 `--prefix`。

注册后，请从同一个 PowerShell 启动 Codex 或 Claude Code。已经注册过的用户可参阅[更新注册](#codex-注册与更新)。从这个会话启动的程序可能会继承密钥。关闭宿主后，可以用 `Remove-Item Env:REBUT_OPENAI_API_KEY` 清除当前会话中的密钥。

如果 `rebut.cmd doctor --provider` 显示 `tls_certificate_error`，请查看 `tls_error_code` 确认具体的证书错误。如果 Node.js 拒绝了 Windows 信任的证书，请使用 Node.js 24.6 或更高版本，并在 PowerShell 中设置 `$env:NODE_USE_SYSTEM_CA = '1'`，让 Node.js 也使用 Windows 信任的证书，包括所在组织安装的证书。通过该网络发送 API 密钥或审查材料时，请遵循组织的规定。在同一个 PowerShell 会话中重新运行诊断以检查连接。这项诊断只查询模型元数据。[Node.js `NODE_USE_SYSTEM_CA`](https://nodejs.org/download/release/v24.22.2/docs/api/cli.html#node_use_system_ca1)

从同一个 PowerShell 会话启动 Claude Code CLI 时，它会继承这项设置。要让 Codex CLI 使用同一个证书库，请在 Codex 配置文件（默认为 `%USERPROFILE%\.codex\config.toml`）的 `[mcp_servers.rebut.env]` 表中加入 `NODE_USE_SYSTEM_CA = "1"`，然后重启 Codex。如果重新注册 Rebut 后这一项被移除，请再加回去。

下次继续使用同一个 `REBUT_CONFIG_DIR`。请求和用量记录保存在该目录下的 `local\ledger.sqlite`。结果不确定时，在设置了同一 `REBUT_CONFIG_DIR` 的会话中，通过 `rebut.cmd status REQUEST_ID` 查询原请求 ID。参见[恢复流程](operations.md#unknown-恢复)。

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

## 更新 Rebut

关闭正在运行 Rebut MCP 的宿主，然后运行 `rebut update`。命令会确认当前使用的 npm 全局安装，并在同一目录安装 npm 上标记为 `latest` 的版本。即使只在安装时指定过 `--prefix`，也会沿用该目录。

如果 `latest` 指向预发布版本，命令会停止。如果无法验证当前安装，或 npm 在更新过程中失败，请按原来的安装方式在同一目录重新安装。

使用该安装目录中的 `rebut --version` 确认版本，再重启宿主。如果该版本需要重新注册，请根据使用的宿主运行 `rebut setup --client codex --replace` 或 `rebut setup --client claude --replace`。

## Codex 注册与更新

```sh
npm install -g rebut-mcp
rebut setup --client codex --replace
rebut doctor --connect
```

注册使用 `CODEX_HOME` 或 `~/.codex`，其他位置用 `--codex-home PATH`。执行 `setup --replace` 前备份整个 `config.toml`，并在 setup 所在 shell 提供相同的自定义 `REBUT_CONFIG_DIR`。注册后重启宿主；运行中的进程不会重载设置。

0.2.x → 0.3.0 按 **保持 OpenAI 配置更新 Worker 代码 → CLI/注册/重启宿主 → 启用 Claude 密钥和配置档** 更新。0.1.x 用户先升级 CLI 到 0.2.x 以获得较长的期限。供应商/HTTP 客户端/Codex 工具限制分别为 1,800/1,830/1,860 秒，不保证网络连接持续存在；其他宿主也需设置适合长审查的期限。

`rebut remove --client codex` 仅删除注册，不删除设置、凭据或账本。备份与降级见[运维](operations.md)。

## 执行审查

```sh
umask 077
rebut collect --root /path/to/project --request-id review-001 --requirements 'AC-1: 保持排序顺序。AC-2: 保留空结果。' --profile astra-medium -- src/example.ts > /protected/path/review-001.bundle.json
```

使用问题单或规范中由人工批准的验收标准。尽可能在开始实现前固定该版本，并将它与补丁分开。选择评估补丁所需的文件，默认将作者摘要排除在 `requirements` 之外。

提交前，确认固定的版本仍适用于本次审查，并将包中脱敏后的实际 `requirements` 与批准版本逐项核对。Rebut 检查提交的内容与随请求提供的哈希是否一致。它无法确认谁批准了标准或是否遗漏了条目。如果修订改变了范围，或脱敏改变了某条标准的含义，请在提交前向标准批准人确认。

本例需要能够判断 AC-1 和 AC-2 的证据。如果缺少 AC-2 或判断该项所需的代码或测试，即使没有发现问题，AC-2 也应视为未评估。如果缺少已批准的标准或标准互相冲突，请先确认标准，或将审查范围限定为一般性缺陷。没有发现问题本身不能证明符合验收标准，也不代表批准合并。

```sh
rebut review < /protected/path/review-001.bundle.json
rebut status review-001
```

如果包中包含可识别的验收标准，即使没有发现问题，也会要求审查模型在摘要中说明评估了哪些标准并引用证据。例如，`summary` 可以写“AC-1：已检查 src/example.ts:12–16 中的排序代码，没有证据支持的问题发现。AC-2：未评估。” `additional_evidence` 则可请求处理空结果的代码路径或相关测试。

把审查报告与已批准的标准和送审材料逐项对照。标准未出现在审查包或报告中，或引用的证据不足时，仍记为未评估。模型摘要可作为人工核对证据的参考。验收和合并沿用现有审批流程。

明确指定要送审的文件。收集时会拒绝不安全的文件、符号链接、FIFO 和二进制文件，并屏蔽常见的敏感信息模式。发送前请检查审查包。`review` 会发起付费调用，`status` 只查询元数据。审查正文无法重新获取，请保存首次响应。

仅在用户明确选择付费审查后发起调用。响应为 `completed` 时，核对模型和输入哈希是否与冻结的审查包及配置档相符，并逐条核对原始证据。独立审查使用同一份材料，各审查方之间不共享结果。如果调用超时或结果为 `unknown`，请在同一后端查询原请求 ID，避免用新 ID 重试。参见[恢复流程](operations.md#unknown-恢复)。

### 扩展审查输出

在 `rebut collect` 中加上 `--output-schema 2 --criterion-id AC-1`。请指定 1 至 12 个基准 ID。在需求中为每个 ID 单独写一行，把区分大小写的 ID 放在行首，例如 `AC-1: 保持输入顺序`。这项设置会写入资料包的 `result_format`，并纳入哈希计算。

扩展输出包含问题对应的 `requirement_refs`、建议的复现步骤 `reproduction`，以及各项基准的 `requirement_coverage`。与已关联问题完全相同的引用会在基准依据中省略。资料不足或只能审查部分内容时，基准可以保留为 `unassessed`。模型遗漏的基准由 Rebut 补为 `unassessed`。`assessed` 表示模型报告所收到的材料足以审查整项基准，是否验收由调用方判断。基准关联和复现步骤均由模型提出。

默认使用原有输出格式。提交扩展资料包时，本地 Rebut 或 Worker 必须支持此功能。`review_pair` 会将同一设置用于两次审查，并分别返回结果。如需换一种输出格式重新发起审查，请使用新请求 ID 重新收集资料。状态不确定的请求请使用原 ID 查询。

### 用两个配置进行独立审查

用户明确选择两次付费审查时，可在 Codex 或 Claude Code 中使用 `review_pair`。`first` 传入收集好的完整 schema 2 审查包，`second` 传入不同的 `request_id`、第二个 `profile` 和对应的 `provider`。例如，使用 `astra-medium` / `openai` 收集 `first`，再将 `{"request_id":"review-002","profile":"claude-medium","provider":"anthropic"}` 传给 `second`。请用 `rebut profile list` 确认配置。

两个请求使用相同材料，各自的输入哈希绑定对应供应商。每个请求分别受预算和并发限制，因此可能只接收一个。本地默认并发上限为 1。运行 `rebut set max-concurrent 2` 并重启 MCP 宿主，即可启用本地并行审查。本地并发上限低于 2 时，Rebut 会在发送前拒绝该调用。各结果包含请求 ID 和 `has_review`。只收到一份审查正文时为 `partial`，两份都缺失时为 `incomplete`。如果两个请求均已完成且正文无法重放，则返回 `completed_without_review`。连接中断后，请在同一后端用原来的两个 ID 查询 `review_status`，再判断是否需要新的付费调用。状态查询无法重放审查正文。

该工具由本地模式和 Worker 模式下的 Rebut 客户端提供。已有 Codex 注册时，运行 `rebut setup --client codex --replace` 并重启宿主。请重启 Claude Code 更新工具列表。

本地使用不同供应商时，Rebut 进程必须能访问两把密钥。通过环境变量注册宿主时，默认只转发首选供应商的变量。

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

## Claude API 与 Claude Code — 0.3.0

0.3.0+ 将审查供应商和 MCP 宿主分别选择。本地 macOS Keychain 示例：

```sh
rebut set mode local
rebut set provider anthropic
rebut set api-key
rebut setup --client claude
rebut doctor --connect
```

切换供应商会选择其默认配置档并清除模型/推理覆盖；重复选择同一供应商则保留。已有 OpenAI 密钥、配置档和账本不删除。

注册前停止 Claude Code 并备份配置。仅更新 `~/.claude.json` 中的 Rebut 用户项。其他文件用 `--claude-config PATH`，设置 `CLAUDE_CONFIG_DIR` 时必须提供此选项。冲突的 Rebut 项需 `--replace`。项目/管理级同名覆盖需另外检查。注册通过原子替换生成 0600 文件，不保留 ACL/xattr。重启 Claude Code 后查看 `/mcp`。

env 方式使用 `rebut set secret-store env`，向实际宿主提供 `REBUT_ANTHROPIC_API_KEY`。不支持选择共享 `ANTHROPIC_API_KEY`，避免改变 Claude Code 认证。Keychain/Vaultwarden 注册不添加供应商 env 占位符。env setup 解析配置档时也可能初始化本地 SQLite。 env 注册传递当前默认配置档的供应商变量，其他供应商冻结材料缺少对应 env 密钥时会在预留前失败。如果 `doctor` 解析了配置档，`provider` 会显示所选供应商。未查询或无法解析配置档时，会显示共享设置中的供应商。如果 `--client` 指定的客户端有自己的默认配置档，且该配置档未查询或无法解析，则省略 `provider`。`keyConfigurationProvider` 显示 `set api-key` 的目标供应商。供应商/后端/env 改变后，为每个宿主重跑 `setup --replace` 并重启。

可选、本地专用 `rebut doctor --provider` 仅查询模型元数据，不生成内容、预留审查费用或新增用量记录。解析配置档时可能初始化本地 SQLite。`doctor --connect` 仍只检查 MCP。元数据可达不证明生成权限、余额、geo、结构化输出支持或质量。
