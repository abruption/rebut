# 按需启用独立审查

[한국어](../ko/reviewer-integration.md) · [English](../en/reviewer-integration.md) · **简体中文** · [日本語](../ja/reviewer-integration.md)

[Rebut](../../../README.zh-CN.md) · [用户指南](../zh-CN.md)

保留宿主已有审查政策，仅在明确请求 OpenAI 审查时选择 Rebut。不自动回退或同时调用三个审查器。

1. 仅收集必要证据，脱敏、检查、冻结并记录 canonical SHA-256。独立审查器获得同一资料，不获得彼此结果。
2. 选择本地或 Worker 后端和启用的配置方案。只有有意的新审查使用新 ID，不确定请求保留原 ID 和后端。
3. 本地需要 OpenAI API 密钥（set api-key、REBUT_OPENAI_API_KEY 或 vaultwarden-api-key-item）；Worker 使用独立 endpoint 和访问令牌（set token、REBUT_TOKEN、vaultwarden-item），供应商密钥留在 Worker。
4. 明确选择付费审查后执行 `rebut review < /protected/path/request-001.bundle.json`，以严格权限保存首次响应。不要将凭据放入参数或跟踪文件。
5. 确认 completed、预期模型／配置方案／哈希和用量，逐条核实证据。空发现或合法 JSON 不证明正确性；报告实际模型、估算用量、证据和限制。
6. 超时、取消或不确定后查询 rebut status REQUEST_ID。reserved/unknown 可能已计费，继续保留预留；重复仅返回元数据。不在另一后端重放以绕过 unknown 或限额。

模型没有执行或发布权限。doctor --connect 不调用供应商，只检查所选后端，不证明 API 权限。本地预算仅属于一个目录，不跨设备共享；其他 MCP 宿主须单独验证兼容性和期限。
