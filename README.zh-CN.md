<div align="center">

# Rebut

**默认本地运行的独立代码审查 MCP，可选 Cloudflare Worker。**

[한국어](README.md) · [English](README.en.md) · **简体中文** · [日本語](README.ja.md)

</div>

Rebut 使用您自己的 OpenAI 或 Claude API 密钥审查代码。新安装默认运行本地 stdio 服务器，无需 Cloudflare 账户或独立 HTTP 守护进程。

审查资料会发送至所选供应商 API；本地账本仅存储请求和用量元数据。

0.3.0+ 的 Claude 支持按 `rebut set provider anthropic` → `rebut set api-key` → `rebut setup --client claude` 设置；宿主与审查供应商分别选择。

验证目标为 macOS/Linux，Windows 行为与 ACL 未验证。

## 快速开始

需要 Node.js 24 或更高版本。以下示例使用 macOS Keychain。

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

`rebut set api-key` 隐藏输入 OpenAI API 密钥并存入 Keychain。Linux 等环境请选择 `rebut set secret-store env`，通过实际 MCP 宿主的安全环境提供 `REBUT_OPENAI_API_KEY`。配置仅记录变量名，不要把密钥写入参数或受版本控制的文件。

## 可选 Worker

多台设备需要共享预算和请求账本时，可选择自托管 Worker。`rebut set endpoint URL` 会选择 Worker 模式。macOS 可通过 `rebut set token` 保存独立的 Worker 访问令牌。OpenAI API 密钥、Worker 访问令牌和管理员令牌是不同凭据。

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut setup --client codex --replace
```

已有 endpoint 配置继续使用 Worker 模式。通过 `rebut set mode local` 明确切换；失败不会自动切换后端。切换不会迁移已有请求或预留。

## 功能

- 仅收集、脱敏并冻结明确提供的文件、diff 和要求，再调用供应商一次。
- 在本地 SQLite 或 Worker D1 中进行原子预算预留和去重；账本不存储源码、审查正文或密钥。
- 返回结构化发现、给定文件及行号证据、模型标识、用量与预估成本。
- 提供 review 和仅元数据的 review_status。不确定后保留同一 ID，不在另一后端重放 unknown 请求。

默认示例为 UTC 每日 $6.66、每月 $200、一个 pending/unknown 请求及每日 100 个新请求。**本地限额仅覆盖该设备的数据目录**，不汇总另一台 Mac、Worker、外部 API 或 OpenAI 账户余额。Worker 用户共享该部署的账本。预估不是账单；不确定的执行继续占用预留和并发槽。

供应商等待上限为 30 分钟，并配套调整 HTTP/MCP 和 Codex 期限。本地配置方案由 OS 所有者管理；Worker 变更需要独立管理员认证。凭据、模型、预算与可选部署见[安装](docs/guide/zh-CN/installation.md)和[配置](docs/guide/zh-CN/configuration.md)。

## 开发者验证

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run test:package
```

自动化测试与包 smoke 测试模拟供应商。默认真实 API 测试使用 gpt-6-luna，生产使用 gpt-6-astra / medium。Luna 成功不证明 Astra 的审查质量。

## 文档

- [用户指南](docs/guide/zh-CN.md)
- [安装与输入收集](docs/guide/zh-CN/installation.md)
- [配置、预算与 MCP 契约](docs/guide/zh-CN/configuration.md)
- [运维与恢复](docs/guide/zh-CN/operations.md)
- [可选审查器集成](docs/guide/zh-CN/reviewer-integration.md)
- [架构](docs/guide/zh-CN/architecture.md)
- [验证及结果的局限](docs/guide/zh-CN/validation.md)
- [MIT 许可证](LICENSE)
