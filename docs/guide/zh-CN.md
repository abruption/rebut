# Rebut 用户指南

[한국어](ko.md) · [English](en.md) · **简体中文** · [日本語](ja.md)

[Rebut](../../README.zh-CN.md)

Rebut 是一个需要明确选择启用、经过身份验证的 Cloudflare Worker MCP，通过 OpenAI Responses API 提供独立审查。它仅审查明确提供并已冻结的证据。它不会克隆仓库、获取任意 URL、运行命令或测试、编辑文件，也不会创建拉取请求。

使用 `npm install -g rebut` 安装客户端，配置自己的 Worker 和凭据后端，然后运行 `rebut setup --client codex`。此包是自托管 Worker 的桥接程序；Worker/D1 部署仍需 GitHub 源代码检出目录、自己的 Cloudflare 账户及 OpenAI 密钥。从[安装](zh-CN/installation.md)了解 Keychain、Vaultwarden、明确选择的 env 模式、免费诊断和按需付费审查。

| 指南                                        | 内容                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| [安装](zh-CN/installation.md)               | 环境要求、源码设置、输入收集、私有部署、MCP 客户端             |
| [配置](zh-CN/configuration.md)              | 配置方案、模型与测试策略、UTC 预算、输入/哈希/工具契约、隐私   |
| [运维](zh-CN/operations.md)                 | 超时/结果未知时的核对、账本保留、升级、轮换与移除              |
| [审查器集成](zh-CN/reviewer-integration.md) | 明确选择审查器、共享冻结的证据、Vaultwarden 包装脚本、结果检查 |
| [架构](zh-CN/architecture.md)               | MCP/提供商边界、原子预留及重复调用防护                         |
| [验证](zh-CN/validation.md)                 | 模拟测试、真实 Luna 冒烟测试、用量及尚未验证的范围             |

请从安装和配置开始。在处理未知执行结果或修改部署之前，请先阅读运维指南。现有的 Claude/Gemini 默认设置仍由宿主控制。
