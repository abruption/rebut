// Keep outer layers open long enough to receive the provider's bounded outcome
// and commit/retrieve ledger metadata instead of timing out first.
export const PROVIDER_TIMEOUT_MS = 1_800_000;
export const CLIENT_TOOL_TIMEOUT_MS = PROVIDER_TIMEOUT_MS + 30_000;
export const CODEX_TOOL_TIMEOUT_SECONDS = CLIENT_TOOL_TIMEOUT_MS / 1000 + 30;
