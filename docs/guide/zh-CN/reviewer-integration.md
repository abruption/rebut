# 按需启用独立审查

[한국어](../ko/reviewer-integration.md) · [English](../en/reviewer-integration.md) · **简体中文** · [日本語](../ja/reviewer-integration.md)

[Rebut](../../../README.zh-CN.md) · [用户指南](../zh-CN.md)

保留现有审查器的默认策略。只有用户明确请求 OpenAI API 审查器时，才选择 Rebut。单独选择 Rebut 并不授权调用 Claude/Gemini；存在此适配器也绝不意味着会同时调用三个审查器。

1. 仅收集所需证据，移除秘密信息，检查并冻结材料，记录规范化 SHA-256。独立审查器应使用相同的证据，输出分开保存。独立首轮审查的输入中，不要包含另一个审查器的输出或主代理的中间结论。
2. 选择服务器允许列表中的配置方案。所提供的示例使用 Astra/medium。有意进行新审查时设置新的请求 ID；发生任何超时或不确定响应后，保留同一个 ID。
3. 仅在用户明确选择付费审查后使用 `rebut review < /protected/path/request-001.bundle.json`。按照[安装](installation.md)配置端点及凭据后端。以严格权限在本地保存响应。绝不要将 Bearer 值放入命令参数或受版本控制的文件。
4. macOS 默认使用 Keychain（`rebut set token`，隐藏输入提示）。现有 Vaultwarden 工作流须明确选择 `rebut set secret-store vaultwarden`；默认条目为 `Rebut — MCP Access Token`，可用 `rebut set vaultwarden-item NAME` 修改。非 macOS 环境需明确选择 `rebut set secret-store env`，通过安全执行环境提供 `REBUT_TOKEN`。后端不会自动回退。客户端不接收 OpenAI 密钥。`rebut doctor --connect` 和 `rebut status REQUEST_ID` 是免费检查，不进行付费审查。
5. 确认状态为 `completed`，模型/配置方案/哈希符合预期，发现和用量有效。没有发现问题不代表代码正确。请对照原始源代码核查每项声称的缺陷。报告实际模型、输入哈希、用量、估算费用及局限；符合模式并不能证明发现属实。
6. 对失败/超时请求使用 `rebut status REQUEST_ID`；绝不要自动换用新 ID 重试。`unknown`/`reserved` 可能意味着执行已计费，因此会保留预算预留。已完成请求的重复提交仅返回元数据。请将首次响应保存在本地。

此 API 适配器与 Codex CLI 不同，不授予审查器任何工具、仓库访问、Shell 执行、代码修改或发布权限。只能声明部署中已测试的客户端/设备兼容；请分别验证每个新增宿主，不要复制浏览器配置文件或凭据。
