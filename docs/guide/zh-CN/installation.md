# 安装与输入收集

[한국어](../ko/installation.md) · [English](../en/installation.md) · **简体中文** · [日本語](../ja/installation.md)

[Rebut](../../../README.zh-CN.md) · [用户指南](../zh-CN.md)

## 环境要求与本地验证

使用 Node.js **24 或更高版本**、npm、具有 Workers/D1 权限的 Cloudflare 账户，以及您自己具有 Responses API 访问权限的 OpenAI 密钥。从源代码检出目录安装；这些说明不要求已发布 npm 包或存在公开仓库。

```sh
npm ci
npm run typecheck
npm run build
npm test
```

测试使用合成输入、模拟的提供商响应、真实 SQLite 语句及本地 Workers/D1 运行时。`npm test` 需要 `npm run build` 生成的 Worker 包。自动化测试不会进行付费模型调用。单独进行的 Luna 冒烟测试见[验证记录](validation.md)。

## 冻结审查输入

使用明确的源文件允许列表；不要自动收集整个仓库。请在 Rebut 检出目录中运行命令。

```sh
umask 077
npm run --silent collect -- /path/to/project request-001 'Check that the supplied function preserves its input' src/example.ts > /protected/path/request-001.bundle.json
```

收集器会拒绝符号链接、FIFO、秘密信息文件名、二进制文件及超出大小限制的材料。它会移除可识别的常见秘密信息模式，并保留行号。基于模式的脱敏并不完整：发送前请检查生成的输入包。也可以将文件作为带行号的片段提供，或直接提供 unified diff。规范化哈希和限制见[配置](configuration.md)。

## 私有部署

1. 将 `wrangler.jsonc` 复制为 `wrangler.private.json`（已被 Git 忽略）。设置您的账户 ID、可用的 Worker 名称、实际 D1 ID，以及 `workers_dev:true` 或您自己的路由。使用 `npx wrangler d1 create rebut-ledger` 创建专用 D1 数据库；将其 ID 填入私有配置。
2. 执行 `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json`。
3. 使用 `npx wrangler deploy --config wrangler.private.json` 部署。尚未配置的 Worker 返回 503，且无法调用提供商。
4. 保存三个 Workers Secret：`OPENAI_API_KEY`、`REBUT_CONFIG` 和 `AUTH_TOKENS`。使用 Wrangler 的交互式 Secret 提示，或通过受保护的标准输入使用 `secret bulk`；绝不要将秘密值放入参数或受版本控制的文件中。`REBUT_CONFIG` 使用 [`config.example.json`](../../../config.example.json) 中的结构；将 `hostname` 改为端点的准确主机名。`AUTH_TOKENS` 是一个 JSON 对象，将稳定的主体 ID 映射到独立生成的随机 256 位 Bearer 令牌的 SHA-256 摘要。将原始令牌存储在密码管理器中。使用相同令牌的客户端共享一个主体；不同令牌隔离请求/状态访问权限。
5. 将支持 Bearer 请求头的 MCP 客户端连接到 `https://YOUR_HOST/mcp`，并验证 `tools/list`。工具执行前会验证 Host 和浏览器 Origin。此 Bearer 配置未为要求 OAuth 发现的客户端实现 OAuth。

## 运行客户端

随附的客户端接受 `list`、`status REQUEST_ID`，或通过标准输入接收 JSON 输入包的 `review`。通过安全的环境提供 `REBUT_ENDPOINT` 和 `REBUT_TOKEN`。绝不要将令牌值粘贴到命令或受版本控制的文件中。

```sh
npm run client -- list
npm run client -- review < /protected/path/request-001.bundle.json
npm run client -- status request-001
```

可选的 [Vaultwarden 包装脚本与审查器工作流](reviewer-integration.md)在内存中获取 Bearer 令牌。客户端从不需要 OpenAI 提供商密钥。请以严格权限将首次响应保存在本地；服务器仅存储元数据，无法重放审查正文。请将 MCP 客户端截止时间设置为超过 60 秒；提供商调用的超时时间为 45 秒。

## 升级或移除

升级或移除部署之前，请按照[运维指南](operations.md)保留 D1 账本并核对待处理的执行。公开源代码与部署私有付费服务是两个独立的操作。
