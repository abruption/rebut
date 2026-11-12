# 配置与 MCP 契约

[한국어](../ko/configuration.md) · [English](../en/configuration.md) · **简体中文** · [日本語](../ja/configuration.md)

[Rebut](../../../README.zh-CN.md) · [用户指南](../zh-CN.md)

## 服务器配置

[`config.example.json`](../../../config.example.json) 定义了 `REBUT_CONFIG` Secret 的结构。将 `hostname` 设为端点的准确主机名，配置服务器端的配置方案 ID，并设置部署范围内的限制。客户端选择配置方案 ID，不能覆盖模型名称或提供商 URL。示例只是配置，不承诺账户级模型访问权限。

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
