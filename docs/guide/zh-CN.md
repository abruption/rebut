# Rebut 用户指南

[한국어](ko.md) · [English](en.md) · **简体中文** · [日本語](ja.md)

[Rebut](../../README.zh-CN.md)

Rebut 是默认本地、明确选择使用的代码审查 MCP，使用自己的 OpenAI Responses API 密钥。新安装运行本地 stdio，可选 Cloudflare Worker 用于共享账本。仅审查明确提供的冻结资料，不赋予模型仓库、URL 获取、shell、测试、编辑或 PR 工具。

安装 rebut-mcp，配置本地供应商密钥，再运行 rebut setup --client codex。已有 endpoint 配置保持 Worker。[安装](zh-CN/installation.md)介绍 Keychain、Vaultwarden、env 和可选 Worker。

| 指南                                        | 内容                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| [安装](zh-CN/installation.md)               | 环境要求、源码设置、输入收集、私有部署、MCP 客户端             |
| [配置](zh-CN/configuration.md)              | 配置方案、模型与测试策略、UTC 预算、输入/哈希/工具契约、隐私   |
| [运维](zh-CN/operations.md)                 | 超时/结果未知时的核对、账本保留、升级、轮换与移除              |
| [审查器集成](zh-CN/reviewer-integration.md) | 明确选择审查器、共享冻结的证据、Vaultwarden 包装脚本、结果检查 |
| [架构](zh-CN/architecture.md)               | MCP/提供商边界、原子预留及重复调用防护                         |
| [验证](zh-CN/validation.md)                 | 模拟测试、真实 Luna 冒烟测试、用量及尚未验证的范围             |

请从安装和配置开始。在处理未知执行结果或修改部署之前，请先阅读运维指南。现有的 Claude/Gemini 默认设置仍由宿主控制。
