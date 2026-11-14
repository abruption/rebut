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

本地配置档由 OS 所有者管理。Worker 更改需要 `0002` 迁移、`ADMIN_TOKEN_SHA256` 和独立管理员令牌。列表查询不调用付费模型。

```sh
rebut profile set PROFILE_ID --model MODEL_ID --reasoning medium --max-output-tokens 8192 --input-usd-per-million INPUT_USD --output-usd-per-million OUTPUT_USD --price-version PRICE_VERSION
rebut profile remove PROFILE_ID --if-revision N
```

将大写占位符替换为已确认值。自行确认模型、推理设置和费率；输入/输出费率及价格版本必填。`set` 也支持 `--if-revision N`。冲突时重新读取列表再决定，不自动覆盖。

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

调用前保守预留输入及最大输出费用，再按已验证用量记账。估算不是账单。unknown 保留全额预留与并发槽位，日期切换也不释放槽位。费用归属于最初提交的 UTC 日期和月份。

## 输入与结果契约

| 项目              | 上限                  |
| ----------------- | --------------------- |
| 规范化 UTF-8 输入 | 128,000 字节          |
| 文件              | 40                    |
| diff / 要求       | 100,000 / 16,000 字符 |
| 传输封套          | 160,000 字节          |

SHA-256 覆盖屏蔽后的 `{schema_version,task_kind,requirements,files,diff}`，文件键顺序为 `{path,start_line,content}`。ID 和配置档不属于证据哈希。参见[完整 schema](../../../src/contracts.ts)。

- `review` 审查冻结材料。只有 `completed` 表示成功；返回文件/diff 行证据、模型、输入哈希、用量和估算费用。空 findings 不保证正确。
- `review_status` 查询原 principal 的元数据。相同 ID 不触发新供应商调用，更改哈希/配置档会冲突；不重放正文。

账本仅保留请求/用量元数据，不存代码、审查正文或密钥。材料发送至 OpenAI，`store:false` 不保证供应商零保留。提示词要求模型将材料内的指令视为审查数据。模型没有仓库/URL 获取、shell、测试、编辑或 PR 工具。
