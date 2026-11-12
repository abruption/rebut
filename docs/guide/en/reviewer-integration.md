# Opt-in independent review

[한국어](../ko/reviewer-integration.md) · **English** · [简体中文](../zh-CN/reviewer-integration.md) · [日本語](../ja/reviewer-integration.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)

Keep your existing reviewer's default policy. Select Rebut only when the user explicitly requests the OpenAI API reviewer. Selecting Rebut alone does not authorize Claude/Gemini calls, and the presence of this adapter never implies a three-reviewer fanout.

1. Collect only needed evidence, remove secrets, inspect it, freeze it, and record the canonical SHA-256. Use the same evidence for independent reviewers and keep their outputs separate. Do not include another reviewer's output or the primary agent's intermediate conclusion in an independent first pass.
2. Choose the server's allowlisted profile. The supplied example uses Astra/medium. Set a fresh request ID for an intentionally new review; keep the same ID after any timeout or uncertain response.
3. Use `rebut review < /protected/path/request-001.bundle.json` only after the user explicitly selects the paid review. Configure your endpoint and credential backend as described in [installation](installation.md). Save the response locally with restrictive permissions. Never put bearer values in command arguments or tracked files.
4. macOS defaults to Keychain (`rebut set token`, hidden prompt). For an existing Vaultwarden workflow, explicitly select `rebut set secret-store vaultwarden`; default item `Rebut — MCP Access Token`, overridden with `rebut set vaultwarden-item NAME`. Non-macOS requires explicit `rebut set secret-store env` with `REBUT_TOKEN` supplied via a secure execution environment. There is no automatic backend fallback. No OpenAI key goes to the client. `rebut doctor --connect` and `rebut status REQUEST_ID` are free checks, not paid reviews.
5. Confirm status `completed`, expected model/profile/hash and valid findings/usage. Empty findings are not proof of correctness. Check each claimed defect against the original source. Report actual model, input hash, usage, estimated cost, and limitations; schema conformance does not validate a finding's truth.
6. For a failed/timeout request use `rebut status REQUEST_ID`; never retry under a new ID automatically. `unknown`/`reserved` can mean billed execution and retain reservations. A completed duplicate returns metadata only. Preserve the first response locally.

This API adapter is distinct from Codex CLI and grants no tools, repository access, shell execution, code changes or publication rights to the reviewer. Only the deployment's tested client/device can be claimed compatible; verify every additional host separately without copying browser profiles or credentials.
