# Opt-in independent review

[한국어](../ko/reviewer-integration.md) · **English** · [简体中文](../zh-CN/reviewer-integration.md) · [日本語](../ja/reviewer-integration.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)

Keep the host’s existing reviewer policy; choose Rebut only for an explicitly requested OpenAI review. There is no automatic fallback or three-reviewer fanout.

1. Collect only needed evidence, redact and inspect it, freeze it and record the canonical SHA-256. Independent reviewers receive the same evidence, never each other’s output.
2. Select the local or Worker backend and an enabled profile. A new review uses a deliberately new ID; an uncertain review keeps its original ID and backend.
3. Local mode needs an OpenAI API key (macOS set api-key, env REBUT_OPENAI_API_KEY, or vaultwarden-api-key-item). Worker mode uses its own endpoint and access token (set token, REBUT_TOKEN or vaultwarden-item); the provider key remains on the Worker.
4. After explicit paid-review selection, run `rebut review < /protected/path/request-001.bundle.json`. Save the initial response with restrictive permissions. Do not put credentials in arguments or tracked files.
5. Confirm completed, expected model/profile/hash and validated usage; inspect every claimed defect against supplied source. Empty findings and valid JSON do not prove correctness. Report evidence, actual model, usage estimates and limits.
6. After timeout, cancellation or uncertainty, query `rebut status REQUEST_ID`. reserved/unknown may mean billed execution and retain reservations. Duplicates return metadata only. Never replay on another backend to bypass an unknown or limit.

The model gains no execution or publication rights. doctor --connect checks the selected backend without a provider call; it is not proof of API account access. Local budgets are per directory and are not shared across devices. Each additional MCP host needs its own compatibility/deadline check.
