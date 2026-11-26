# 配置

[한국어](../ko/configuration.md) · [English](../en/configuration.md) · **简体中文** · [日本語](../ja/configuration.md)

[README](../../../README.zh-CN.md) · [安装](installation.md) · [运维](operations.md)

## 模式与存储

| 模式               | 选择                                                                   | 账本范围                      |
| ------------------ | ---------------------------------------------------------------------- | ----------------------------- |
| 本地（新安装默认） | `rebut set mode local`                                                 | 一个数据目录内的私有 SQLite   |
| Worker             | `rebut set endpoint URL` 或 `rebut set mode worker`（需已有 endpoint） | 此部署的 D1，供多个客户端共享 |

已有 endpoint 保留 Worker 模式。故障时不自动切换后端，切换也不迁移记录或释放预留。

macOS/Linux 配置为 `~/.config/rebut/config.json`，本地账本为 `~/.local/share/rebut/local/ledger.sqlite`。设置 `REBUT_CONFIG_DIR` 后改用该目录中的 `config.json` 和 `local/`。注册与状态查询必须使用同一目录。

配置文件应由当前账户所有，权限设为 `0600`。配置目录也应由当前账户所有，并与上级路径一同放在其他用户无法写入的位置。如果 Rebut 报告配置路径不安全，请检查所有权和权限。

## 凭据

`rebut set secret-store keychain|vaultwarden|env` 对所有角色选择后端，没有自动回退。Keychain 服务为 `com.abruption.rebut`。

| 角色          | Keychain 账户 / 隐藏输入命令          | env                    | Vaultwarden 默认项目 / 设置键                         |
| ------------- | ------------------------------------- | ---------------------- | ----------------------------------------------------- |
| 本地供应商    | `openai-api-key` / `set api-key`      | `REBUT_OPENAI_API_KEY` | `Rebut — OpenAI API Key` / `vaultwarden-api-key-item` |
| Worker 接入   | `codex-mcp-bearer` / `set token`      | `REBUT_TOKEN`          | `Rebut — MCP Access Token` / `vaultwarden-item`       |
| Worker 管理员 | `codex-mcp-admin` / `set admin-token` | `REBUT_ADMIN_TOKEN`    | `Rebut — MCP Admin Token` / `vaultwarden-admin-item`  |

命令前加 `rebut`。更改 Vaultwarden 项目用 `rebut set SETTING_KEY NAME`。只有明确使用受保护管道时才添加 `--stdin`。`rebut set api-key-env OPENAI_API_KEY` 显式更改本地变量名，两变量间不回退。管理员令牌不传给 MCP 宿主。

## 模型配置档

```sh
rebut profile list
rebut set model MODEL_ID
rebut set reasoning EFFORT
rebut set profile PROFILE_ID
```

偏好应用于新收集的材料。显式 `collect --profile` 优先，`review` 保留冻结材料的配置档。默认 `astra-medium`，允许列表不授予供应商模型权限。

Codex 和 Claude Code 可以共享同一配置与账本，同时各自选择默认审查配置档。

```sh
rebut set profile claude-medium --client codex
rebut set profile astra-medium --client claude
rebut set profile --client codex --clear
```

`--clear` 将该客户端恢复为共享默认配置档。在终端或代理命令中用 `collect --client codex` 或 `collect --client claude` 选择对应默认值，显式传入的 `collect --profile` 优先。客户端默认配置不可用时，按默认值收集会失败。已冻结的审查包会保留原有的配置档和供应商。可用 `rebut doctor --client codex` 或 `--client claude` 查看设置。

更新现有注册时，运行 `rebut setup --client codex --replace` 或 `rebut setup --client claude --replace`，然后重启宿主。本地环境变量模式下，如果所需密钥变量变化，请重新注册。通过 `rebut profile set --model` 定义配置中的模型。选为默认值后，将使用该配置的模型、推理设置和费率。 回退到不支持客户端默认值的版本前，先清除两个客户端的覆盖值，再用旧版 CLI 重新注册两个 MCP 宿主。

随附的 `astra-medium` 配置档使用 GPT-6.2 Astra（`gpt-6.2-astra`）和 medium 推理。示例采用[短上下文 Standard 费率](https://developers.openai.com/api/docs/models/gpt-6.2-astra)，每百万令牌输入 $8、输出 $40。现有 Worker 和本地配置档覆盖项保留已保存的设置。迁移时请查看 `rebut profile list`，使用当前的 `--if-revision` 一次性更新模型 `gpt-6.2-astra`、推理级别 `medium`、两项费率和价格版本 `openai-standard-2026-11-18`。如果客户端显式选择了旧模型 ID，请更新该偏好，或通过配置档 ID 选择 `astra-medium`。

本地配置档由 OS 所有者管理。Worker 更改需要 `0002` 迁移、`ADMIN_TOKEN_SHA256` 和独立管理员令牌。列表查询不调用付费模型。

```sh
rebut profile set PROFILE_ID --model MODEL_ID --reasoning medium --max-output-tokens 8192 --input-usd-per-million INPUT_USD --output-usd-per-million OUTPUT_USD --price-version PRICE_VERSION
rebut profile remove PROFILE_ID --if-revision N
```

将 `PROFILE_ID` 和 `MODEL_ID` 等占位符替换为实际值。请确认模型支持的推理级别和费率，并填写输入费率、输出费率和价格版本。`set` 也支持 `--if-revision N`。版本冲突时，先重新查询列表，避免自动覆盖。

更改只影响后续请求。删除留下停用 tombstone，不删除历史或恢复初始配置档。已有 ID 保留模型、修订和预留。动态修改配置档不需重新部署 Worker。

## 预算

| 项目           | 默认值 | 本地命令                             |
| -------------- | ------ | ------------------------------------ |
| UTC 每日       | $6.66  | `rebut set daily-budget USD`         |
| UTC 每月       | $200   | `rebut set monthly-budget USD`       |
| 每次请求       | $6.66  | `rebut set request-budget USD`       |
| 并发未解决请求 | 1      | `rebut set max-concurrent N`（1–10） |
| 每日新请求     | 100    | 部署/初始配置                        |

本地限制按数据目录，Worker 限制按整个部署。不合计其他设备、Worker、API 使用或 OpenAI 账户余额。Worker 限制由 `REBUT_CONFIG` 管理。日、月和单次上限相互独立，更改一个不会扩大其他上限。设置更改后重启宿主。

可选的 Worker 绑定 `REBUT_BUDGET_LIMITS` 接受 JSON 对象，其中可指定 `dailyMicrousd`、`monthlyMicrousd` 或两者。数值的单位为百万分之一美元。每日金额设为 `0` 时取消每日支出上限。月度支出、单次支出、每日请求数和并发上限继续生效。管理员可在 `rebut budget` 的 JSON 输出中查看日度和月度支出上限。`daily_limit_microusd` 为 `0` 表示每日支出上限已取消。绑定值无效时，Worker 返回 503。GPT-6.2 Astra 和 Claude Fable 5.2 的配置档可将 `maxOutputTokens` 设置为最高 50,000。将启用的配置档提高到 16,384 以上前，请先更新使用该 Worker 的 CLI。

调用前保守预留输入及最大输出费用，再按已验证用量记账。估算不是账单。unknown 保留全额预留与并发槽位，日期切换也不释放槽位。费用归属于最初提交的 UTC 日期和月份。

运行 `rebut budget` 查看月度已计入金额、下次 UTC 重置时间和未解决请求占用的并发槽位。台账金额与供应商的额度余额无关。Worker 模式下使用 Worker 管理员令牌。可分别比较月度已计入金额与月度上限、占用槽位与并发上限。每日及单次请求上限也适用。

如需更改月度 UTC 起始日，请运行 `rebut budget set-start-day DAY`（1–28）。空台账立即采用该设置。已有请求记录的台账会将当前日历月预算延长到下个月的指定日期。例如在 11 月设置为 15 日，会继续使用 11 月预算直到 12 月 15 日 00:00 UTC。默认从 1 日开始，每个台账只允许切换一次。重复设置相同日期是安全的，再改为其他日期会被拒绝。

Worker 上请先部署新代码并应用 D1 迁移 `0003_budget_cycle.sql`，再设置自定义日期。日历月模式无需此次迁移。本地切换成功后会自动升级台账，旧版 CLI 无法打开升级后的台账。旧版 Worker 在切换后无法新增预留。已有请求 ID、费用所属周期和未解决槽位均会保留。

## 输入与结果契约

| 项目              | 上限                  |
| ----------------- | --------------------- |
| 规范化 UTF-8 输入 | 128,000 字节          |
| 文件              | 40                    |
| diff / 要求       | 100,000 / 16,000 字符 |
| 传输封套          | 160,000 字节          |

SHA-256 对脱敏后的 `{schema_version,provider,task_kind,requirements,files,diff}` 使用 JavaScript 紧凑 JSON 序列化得到的 UTF-8 字节，文件键顺序为 `{path,start_line,content}`。输入模式 1 省略 `provider`。选用扩展输出时，在末尾添加 `result_format`，键顺序为 `{version,criterion_ids}`，基准 ID 按原数组顺序保留。请求 ID 和配置档不纳入哈希。输入 `schema_version` 和输出 `result_format.version` 是两个独立的字段。 参见[完整模式](../../../src/contracts.ts)。

下面是输入模式 2 使用原有输出的示例。

```json
{"schema_version":2,"provider":"openai","task_kind":"code","requirements":"AC-1: Preserve 순서.","files":[{"path":"sample.ts","start_line":1,"content":"export const value = 1;"}],"diff":""}
```

同一份资料的 SHA-256 分别为：输入模式 1 省略 `provider` 时 `412b5f538cfa6fac93c83813b6f4b723156f40ae06d50848072c58a5dabc8ca0`，上例 `f8add8f03abd7292de2918d02a70b435953019074a35d6a45d3a182f177417c5`，输入模式 2 在末尾添加 `result_format: {"version":2,"criterion_ids":["AC-1"]}` 时 `fd39d1847c3a55e9a318020874a96b55fcaad132c5c7c2df6325d4e8d1cf032a`。

| CLI 和后端 | 支持的输出 |
| --- | --- |
| v0.5.0 CLI 与兼容的本地运行时或 Worker | 原有输出 |
| 已更新的 CLI 与 v0.5.0 Worker | 默认值或 `--output-schema 1` |
| 已更新的 CLI 与支持扩展输出的本地运行时或 Worker | 原有输出，或使用 `--criterion-id ID` 选择扩展输出 |

收集时固定配置档 ID 和供应商。后端在首次预留预算前从当前配置档读取模型、推理级别和费率。已记录的请求会返回原 ID 的元数据。

在 shell 自动化中，`rebut review --strict-exit` 仅在返回指定格式的已完成审查正文时以状态码 0 退出。重复请求若只返回 `completed` 元数据，则以非零状态码退出。标准输出的 JSON 格式保持不变。结果不确定时，请查看 JSON 状态并使用原请求 ID 查询。

- `review` 审查冻结材料。新 `completed` 结果的正文包含文件/diff 行证据、模型、输入哈希、用量和估算费用。空 findings 不保证正确。
- `review_status` 仅向原认证主体返回元数据。如果请求 ID 已在同一后端、同一认证主体的账本中登记，使用相同的输入哈希和配置档再次调用 `review`不会调用供应商。输入哈希或配置档与记录不符时，返回 `conflict`。状态查询无法取回审查正文。

账本仅保留请求/用量元数据，不存代码、审查正文或密钥。审查材料会发送给配置档指定的供应商。OpenAI 的 `store:false` 设置并不保证数据零留存。提示词要求模型将材料内的指令视为审查数据。模型没有仓库/URL 获取、shell、测试、编辑或 PR 工具。

## Claude 供应商 — 0.3.0

先执行 `rebut set provider anthropic`，再用原有 `rebut set api-key` 设置一个密钥。Keychain 服务/账户为 `com.abruption.rebut` / `anthropic-api-key`。Vaultwarden 的 `rebut set vaultwarden-api-key-item NAME` 设置所选供应商项目，默认 `Rebut — Anthropic API Key`。不添加账户别名、密钥轮换或供应商回退。

`claude-medium` 使用 Claude Opus 5.5 / medium。创建 Anthropic 配置档需显式加 `--provider anthropic`。省略时保留已有活动配置档供应商，新/停用配置档默认 OpenAI，不继承密钥选择偏好。旧配置档没有 provider 时仍为 OpenAI。冻结材料的配置档决定实际供应商与密钥，偏好改变后保留原材料/ID。

每个本地/Worker 账本在同一预算和并发限制下合计两个供应商。新请求在预留、完成和错误路径保留 `requested_provider`，旧行不改写。未报告 thinking 时省略 `reasoning_tokens`。缓存读取按完整基础输入费率保守估算，未请求的缓存写入或非标准用量保留 unknown。

Claude 使用 standard tier/global geo 的 Messages API，无工具或提示缓存。workspace 地区政策可能拒绝请求，不改用其他密钥重试。先保留 OpenAI 配置部署 Worker 代码，再更新客户端，最后添加 `ANTHROPIC_API_KEY` 秘密和 Anthropic 配置档。管理员令牌不传给宿主。

API 费用及信用额资格见 [Claude Console 计费说明](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage)，不要混淆 Rebut API 调用与 Claude Code 订阅用量。

新 schema 2 材料固定供应商并将其纳入哈希。收集时读取所选后端的配置档元数据，因此 Worker 需要接入令牌。首次提交若配置档供应商已改变，会在读取密钥/预留前返回 `provider_mismatch`。旧 schema 1 的新请求仅允许 OpenAI，已提交 ID 仍用原材料查询元数据。确认供应商变化后再收集新材料。

本地收集可能初始化配置档存储。schema 1 哈希省略 provider，保持原顺序。
