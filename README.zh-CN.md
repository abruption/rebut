<div align="center">

# Rebut

**默认本地运行的独立代码审查 MCP，可选 Cloudflare Worker。**

[한국어](README.md) · [English](README.en.md) · **简体中文** · [日本語](README.ja.md)

</div>

通过 OpenAI API 审查所提供代码和 diff 的 MCP。审查材料会发送至 OpenAI。

## 快速开始

需要 Node.js 24+。本例使用 macOS Keychain。

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

注册后重启 Codex。Linux/env 与 Vaultwarden 设置见[安装指南](docs/guide/zh-CN/installation.md)。

新安装使用本地 stdio。跨设备共享预算与请求账本时选择 [Worker 模式](docs/guide/zh-CN/installation.md#可选-worker-部署)。已有 Worker 设置保持不变。

`review` 是付费调用，`doctor --connect` 仅检查连接，不进行付费审查。结果不确定时保留原请求 ID。

## 指南

- [安装](docs/guide/zh-CN/installation.md)
- [配置](docs/guide/zh-CN/configuration.md)
- [运维](docs/guide/zh-CN/operations.md)

[发行记录](https://github.com/abruption/rebut/releases) · [MIT](LICENSE)
