<div align="center">

# Rebut

**通过 OpenAI Responses API 提供独立、基于证据的审查。**

[한국어](README.md) · [English](README.en.md) · **简体中文** · [日本語](README.ja.md)

**一个经过身份验证的 Cloudflare Worker MCP，仅审查您明确提供并已冻结的材料。**

</div>

Rebut 是一个**需要明确选择启用的审查器**。它不会替代现有的 Claude/Gemini 工作流，也不会自动调用三个审查器。采用 MIT 许可证；使用您自己的 Cloudflare 账户和 OpenAI 密钥部署。公开源代码与部署个人付费服务是两个独立的操作。

## 快速开始

需要 **Node.js 24 或更高版本**。安装 npm CLI，并配置您自行部署的 Worker：

```sh
npm install -g rebut-mcp
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
rebut setup --client codex
rebut doctor
rebut doctor --connect
```

在 macOS 上，`rebut set token` 使用隐藏输入的交互式提示，默认将 Bearer 令牌保存在 Keychain 中。绝不要将令牌作为参数传递。明确选择 Vaultwarden/env 后端及 Codex 迁移选项见[安装指南](docs/guide/zh-CN/installation.md)。

`rebut-mcp`（初始 CLI 版本 `0.1.0`，命令 `rebut`）是**自托管 Worker**的客户端和 stdio 桥接程序。Worker/D1 仍需从 GitHub 源代码检出目录使用您自己的 Cloudflare 账户和 OpenAI 密钥部署。公开源代码或 npm 包不会授予个人 Worker 或额度的访问权限。包中不包含真实端点、私有配置、Bearer 令牌、提供商密钥或审查正文。这些说明适用于 CLI `0.1.0`。

开发者验证仍在源代码检出目录中执行：

```sh
npm ci
npm run typecheck
npm run build
npm test
```

自动化测试模拟提供商，不会进行付费模型调用。真实 API 测试使用 **gpt-6-luna**，生产使用 **gpt-6-astra / medium**。Luna 结果不能证明 Astra 可用或审查质量相当。Worker 部署需要 D1 及 `OPENAI_API_KEY`、`REBUT_CONFIG`、`AUTH_TOKENS` 三个 Secret；请按照[安装与私有部署](docs/guide/zh-CN/installation.md)操作。

## 功能

- 收集明确允许的文本来源，移除常见的秘密信息模式，并对冻结的证据计算哈希。发送前请检查脱敏结果。
- 在进行一次受限的 Responses 调用之前，检查身份验证、允许列表中的配置、重复请求 ID，以及部署范围内的原子预算预留。
- 返回结构化发现，包含所提供文件和行的证据、模型身份、令牌用量及估算费用。
- 提供 `review` 和仅返回元数据的 `review_status`。超时或结果未知后，请保留同一个请求 ID；服务器绝不会自动创建替代的付费调用。

示例限制为：**每个 UTC 日 $6.66**、**每个 UTC 月 $200**、同一时间仅允许一个待处理/结果未知的请求，以及每天 100 个新的审查请求。账本仅跟踪 Rebut，不代表整个账户的余额。执行结果未知时会保留预算预留。审查正文无法重放；请将首次响应保存在本地。

审查器不能克隆仓库、获取任意 URL、执行命令或测试、编辑文件，也不能创建拉取请求。源代码、审查正文和密钥不会存储在 D1 或 Worker 日志中。`store:false` 不保证提供商零保留数据。

## 文档

- [用户指南](docs/guide/zh-CN.md)
- [安装与输入收集](docs/guide/zh-CN/installation.md)
- [配置、预算与 MCP 契约](docs/guide/zh-CN/configuration.md)
- [运维与恢复](docs/guide/zh-CN/operations.md)
- [可选审查器集成](docs/guide/zh-CN/reviewer-integration.md)
- [架构](docs/guide/zh-CN/architecture.md)
- [验证及结果的局限](docs/guide/zh-CN/validation.md)
- [MIT 许可证](LICENSE)
