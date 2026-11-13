# 配置与 MCP 契约

[한국어](../ko/configuration.md) · [English](../en/configuration.md) · **简体中文** · [日本語](../ja/configuration.md)

[Rebut](../../../README.zh-CN.md) · [用户指南](../zh-CN.md)

## 本地 CLI 配置

使用 `npm install -g rebut` 安装，通过 `rebut set endpoint https://YOUR_HOST/mcp` 配置 Worker。macOS 默认使用 Keychain：`rebut set token` 使用隐藏输入的交互式提示；`rebut set token --stdin` 明确接受受保护的管道输入。不要将 Bearer 值放入参数或受版本控制的文件。现有 Vaultwarden 工作流使用 `rebut set secret-store vaultwarden` 明确选择；默认条目为 `Rebut — MCP Access Token`，可用 `rebut set vaultwarden-item NAME` 修改。非 macOS 环境须明确使用 `rebut set secret-store env`，并通过安全执行环境提供 `REBUT_TOKEN`。后端不会自动回退。

使用 `env` 后端时，Codex 设置仅保存变量名 `env_vars = ['REBUT_TOKEN']`，绝不保存其值。令牌必须通过实际运行 Codex 的宿主的安全执行环境提供；仅为设置命令提供该变量，不会使其在后续 Codex 会话中可用。

`rebut setup --client codex` 使用 `CODEX_HOME` 或 `~/.codex`；`--codex-home PATH` 指定其他目录。它注册 `rebut mcp` 并保留其他 MCP 条目；迁移现有私有 `rebut` 桥接配置需要 `--replace`。`rebut doctor` 显示已清理敏感值的本地配置及凭据可用性；`rebut doctor --connect` 免费检查远程 `tools/list`。两者均不进行付费审查。参见[安装](installation.md)。

## 模型与推理偏好

为新收集的输入包设置本地偏好，或直接选择服务器配置方案：

```sh
rebut set model MODEL_ID
rebut set reasoning EFFORT
rebut set profile PROFILE_ID
```

`MODEL_ID`、`EFFORT` 和 `PROFILE_ID` 是占位符。模型/推理偏好会匹配服务器允许列表中的配置方案，不授予任意模型的访问权限。收集器显式指定的 `--profile` 优先于本地偏好。未设置偏好时仍默认为 `astra-medium`。`rebut review` 使用冻结输入包中已包含的配置方案，不会根据当前偏好改写它。

## 所有者管理服务器配置方案

`rebut profile list` 通过经过身份验证的只读 GET 列出服务器配置方案、模型、推理设置、输出上限、费率及修订版本，不调用提供商，也不启动付费审查。

```sh
rebut profile list
rebut set admin-token
```

修改配置方案需要单独的所有者管理 Bearer 令牌。`rebut set admin-token` 使用隐藏输入的交互式提示；`rebut set admin-token --stdin` 明确接受受保护的管道。绝不要将令牌放入参数或受版本控制的文件。macOS Keychain 服务为 `com.abruption.rebut`，审查账户为 `codex-mcp-bearer`，管理账户为 `codex-mcp-admin`。已选择的 Vaultwarden 后端可使用用户单独选择的条目：默认为 `Rebut — MCP Admin Token`，通过 `rebut set vaultwarden-admin-item NAME` 修改。env 后端从安全执行环境读取 `REBUT_ADMIN_TOKEN`。管理令牌绝不会转发给 Codex。后端不会自动回退。

完成[安装](installation.md)中的一次性 Worker 升级、D1 迁移 `0002` 及 `ADMIN_TOKEN_SHA256` Secret 设置后，所有者可以添加或更新配置方案。以下示例使用现有 Astra/medium 配置及日期为 2026-11-12 的 Standard 费率；选择数值前请核实官方[模型](https://developers.openai.com/api/docs/models/gpt-6-astra)和[价格](https://developers.openai.com/api/docs/pricing)文档。对于新模型，请将占位符 `MODEL_ID` 替换为已核实的 Responses 兼容模型 ID，并明确提供其支持的推理设置、输出上限和官方费率。

```sh
rebut profile set astra-medium --model gpt-6-astra --reasoning medium --max-output-tokens 8192 --input-usd-per-million 10 --output-usd-per-million 50 --price-version official-2026-11-12
```

两项费率及 `--price-version` 都是必填项；服务器据此预留预算并估算成本。Rebut 不会自动抓取价格或调用提供商的模型端点。`--if-revision N` 为 set/remove 添加明确的比较交换修订条件。发生 `409` 冲突后，应重新读取 `rebut profile list` 并决定如何修改，绝不自动覆盖。

```sh
rebut profile remove PROFILE_ID --if-revision N
```

移除会创建禁用墓碑记录，而不是删除审查历史。一次安装 Worker/D1 支持后，配置方案变更只写入 D1：Responses 兼容的新模型 ID 或推理值无需重新构建/部署 Worker 或升级 npm。配置方案更新或移除后，现有请求保留原始模型和修订版本。变更不会重新运行请求，也不会自动释放或退还预算预留。普通审查 Bearer 令牌不能修改配置方案；此所有者 API 不作为 MCP 工具暴露，也不能修改预算、身份验证或提供商 URL。

## 服务器配置

[`config.example.json`](../../../config.example.json) 定义了 `REBUT_CONFIG` Secret 的结构。将 `hostname` 设为端点的准确主机名，配置服务器端的配置方案 ID，并设置部署范围内的限制。客户端选择配置方案 ID，不能覆盖模型名称或提供商 URL。示例只是配置，不承诺账户级模型访问权限。

`REBUT_CONFIG` 提供初始配置方案。D1 覆盖记录及禁用墓碑优先；移除配置方案不会恢复相同 ID 的初始配置方案。服务器会为每个已预留请求冻结解析后的配置方案及修订版本。

| 配置方案       | 模型          | 推理     | 最大输出令牌数 | 每 1M 令牌的 Standard 输入/输出价格 |
| -------------- | ------------- | -------- | -------------- | ----------------------------------- |
| `astra-medium` | `gpt-6-astra` | `medium` | 8,192          | $10 / $50                           |
| `luna-test`    | `gpt-6-luna`  | `medium` | 2,048          | $0.10 / $0.50                       |

输出限制包含推理令牌。带日期的价格表为 `openai-standard-2026-11-12`；估算不应用缓存输入折扣。**真实 API 测试使用 Luna**，自动化测试使用模拟。生产配置方案仍为 Astra/medium；Luna 的结果不能证明 Astra 运行时可用，也不能证明两者审查质量相当。部署前请核实官方 [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) 及[定价](https://developers.openai.com/api/docs/pricing)文档。

请求固定使用 `service_tier:default` 和不设置断点的 `prompt_cache_options.mode:explicit`，从而为这些配置方案禁用提示缓存。不提供执行工具。估算不是账单，也不涵盖共享同一密钥或项目的其他服务。

## 预算与并发

| 设置                    | 示例值                             |
| ----------------------- | ---------------------------------- |
| UTC 自然日              | $6.66 (`dailyMicrousd:6660000`)    |
| UTC 自然月              | $200 (`monthlyMicrousd:200000000`) |
| 每个请求                | $6.66 (`requestMicrousd:6660000`)  |
| 并发待处理/结果未知请求 | 1 (`maxConcurrent:1`)              |
| 每个 UTC 日的新审查请求 | 100 (`dailyRequests:100`)          |

这些限制汇总部署中所有主体的用量。先预留，再调用：序列化请求字节加上封装填充会计为输入令牌，同时预留最大输出预算。经过验证的用量按未缓存的 Standard 费率保守结算。执行结果未知或缺少用量时，保留全部预留金额。进入新的 UTC 日/月会重置该时段的支出窗口；未解决的执行仍占用并发名额。预算窗口依据原始提交日期，而不是订阅额度的发放或到期日期。此账本无法对其他使用方强制执行 OpenAI 全账户限额。请单独确认您账户/组织的额度适用资格。

## 输入限制与哈希

| 材料                             | 限制           |
| -------------------------------- | -------------- |
| 规范化序列化后的 UTF-8 JSON 输入 | 128,000 字节   |
| 文件                             | 40             |
| Diff                             | 100,000 个字符 |
| 要求                             | 16,000 个字符  |
| 传输封装                         | 160,000 字节   |

SHA-256 涵盖脱敏后规范化的 `{schema_version,task_kind,requirements,files,diff}`，文件键顺序为 `{path,start_line,content}`。请求 ID 和配置方案名称不属于此冻结证据哈希。完整契约见 [`ReviewInputSchema`](../../../src/contracts.ts)。为独立的首轮审查器保留相同证据，并将它们的输出分开保存。

## MCP 工具

- `review`：选择允许列表中的配置方案 ID，并提供冻结的材料。返回状态、经验证的发现、提供商模型/ID、哈希、用量及估算 microUSD。只有 `completed` 表示审查成功。拒绝、生成未完成、无效输出及执行结果未知分别保留为不同状态。每项发现必须引用所提供文件的行，或所提供 diff 中新侧的行。发现数组为空且摘要非空是有效结果；空响应或格式错误的响应无效。
- `review_status`：`{request_id}` 仅返回调用方主体的元数据。它无法重放审查正文。

超时后，请查询**同一个请求 ID**。重复提交该 ID 绝不会创建新的提供商执行。使用相同 ID 但更改输入哈希或配置方案会返回 `conflict`。已完成请求的重复提交仅返回元数据，而非审查正文：客户端必须将首次响应保存在本地。核对流程见[运维](operations.md)；传输失败后收到 `not_found`，本身并不意味着可以使用新 ID。

## 存储与隐私

仅存元数据的 D1 账本保留请求 ID、哈希、配置方案、状态、预留金额、经过清理的提供商 ID 及用量。它从不存储源代码或审查文本。示例禁用了 Worker 可观测性。`AUTH_TOKENS` 包含令牌摘要，而非 Bearer 原值；请将原始 Bearer 令牌保存在密码管理器中。设置方法见[安装](installation.md)。

OpenAI 请求使用 `store:false`；这**不**保证提供商零保留数据，也不能替代您组织的数据政策。参见 [OpenAI 数据控制](https://developers.openai.com/api/docs/guides/your-data)。请将凭据和私有部署标识符保留在公开源代码及日志之外。

结果为 `invalid_output` 时，`invalid_output_reason` 可在不保留源代码或审查正文的情况下标识失败的验证阶段。中间 `commentary` 消息会被排除，仅将 `final_answer` 或未指定 phase 的旧格式消息解析为结构化审查。多个最终输出、无效 JSON 或模式以及超出所提供证据范围的发现仍会被拒绝。
