# Configuration

[한국어](../ko/configuration.md) · **English** · [简体中文](../zh-CN/configuration.md) · [日本語](../ja/configuration.md)

[README](../../../README.en.md) · [Installation](installation.md) · [Operations](operations.md)

## Modes and storage

| Mode                        | Selection                                                                        | Ledger scope                              |
| --------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| Local (new-install default) | `rebut set mode local`                                                           | Private SQLite in one data directory      |
| Worker                      | `rebut set endpoint URL` or `rebut set mode worker` (existing endpoint required) | One deployment's D1 shared by its clients |

Existing endpoint settings remain Worker mode. There is no automatic backend fallback; switching neither migrates records nor releases reservations.

On macOS/Linux, settings are `~/.config/rebut/config.json` and the local ledger is `~/.local/share/rebut/local/ledger.sqlite`. With `REBUT_CONFIG_DIR`, use `config.json` and `local/` inside that directory. Registration and status queries must use the same directory.

## Credentials

`rebut set secret-store keychain|vaultwarden|env` selects the backend for every role without fallback. Keychain service: `com.abruption.rebut`.

| Role                 | Keychain account / hidden-input command | Env                    | Default Vaultwarden item / setting key                |
| -------------------- | --------------------------------------- | ---------------------- | ----------------------------------------------------- |
| Local provider       | `openai-api-key` / `set api-key`        | `REBUT_OPENAI_API_KEY` | `Rebut — OpenAI API Key` / `vaultwarden-api-key-item` |
| Worker access        | `codex-mcp-bearer` / `set token`        | `REBUT_TOKEN`          | `Rebut — MCP Access Token` / `vaultwarden-item`       |
| Worker administrator | `codex-mcp-admin` / `set admin-token`   | `REBUT_ADMIN_TOKEN`    | `Rebut — MCP Admin Token` / `vaultwarden-admin-item`  |

Prefix commands with `rebut`. Change a Vaultwarden item with `rebut set SETTING_KEY NAME`. Use `--stdin` only for an explicitly protected pipe instead of hidden input. `rebut set api-key-env OPENAI_API_KEY` explicitly changes the local env name; the two variables do not fall back to each other. Administrator tokens are not forwarded to MCP hosts.

## Model profiles

```sh
rebut profile list
rebut set model MODEL_ID
rebut set reasoning EFFORT
rebut set profile PROFILE_ID
```

Preferences affect new collection. Explicit `collect --profile` wins; `review` retains the frozen bundle's profile. The default is `astra-medium`. Allowlisting does not grant provider model access.

The OS owner manages local profiles. Worker changes require migration `0002`, `ADMIN_TOKEN_SHA256`, and a separate administrator token. Listing profiles makes no paid model call.

```sh
rebut profile set PROFILE_ID --model MODEL_ID --reasoning medium --max-output-tokens 8192 --input-usd-per-million INPUT_USD --output-usd-per-million OUTPUT_USD --price-version PRICE_VERSION
rebut profile remove PROFILE_ID --if-revision N
```

Replace uppercase placeholders with verified values. Check model/reasoning support and rates; both rates and the price version are required. `set` also accepts `--if-revision N`. On conflict, refresh the list and decide rather than automatically overwriting.

Changes affect future requests. Removal leaves an inactive tombstone without deleting history or reviving seeded profiles. Existing IDs retain their model, revision, and reservation. Dynamic profile edits do not require Worker redeployment.

## Budgets

| Setting                        | Default | Local command                       |
| ------------------------------ | ------- | ----------------------------------- |
| UTC day                        | $6.66   | `rebut set daily-budget USD`        |
| UTC month                      | $200    | `rebut set monthly-budget USD`      |
| Per request                    | $6.66   | `rebut set request-budget USD`      |
| Concurrent unresolved requests | 1       | `rebut set max-concurrent N` (1–10) |
| New requests per day           | 100     | Deployment/initial configuration    |

Local limits apply to one data directory; Worker limits apply across its deployment. They do not aggregate other devices, Workers, API usage, or OpenAI account balance. Manage Worker limits in `REBUT_CONFIG`. Daily, monthly, and request ceilings are independent; changing one does not increase the others. Restart hosts after settings changes.

The service reserves conservatively for input and maximum output, then accounts for verified usage. Estimates are not invoices. Unknown keeps the full reservation and concurrency slot, including after date changes. Period accounting remains attached to the original UTC submission day/month.

## Input and result contract

| Item                  | Limit                       |
| --------------------- | --------------------------- |
| Canonical UTF-8 input | 128,000 bytes               |
| Files                 | 40                          |
| Diff / requirements   | 100,000 / 16,000 characters |
| Transport envelope    | 160,000 bytes               |

SHA-256 covers masked `{schema_version,provider,task_kind,requirements,files,diff}` with file keys ordered `{path,start_line,content}`. ID and profile are separate from the evidence hash. See [the full schema](../../../src/contracts.ts).

- `review` processes frozen material. Only `completed` means success; results include file/diff line evidence, model, input hash, usage, and estimated cost. Empty findings do not prove correctness.
- `review_status` returns metadata for the original principal. Reusing an ID does not create another provider call; changing its hash/profile conflicts. Review bodies are not replayed.

Ledgers retain request/usage metadata, not code, review text, or keys. Material is sent to OpenAI; `store:false` does not promise zero provider retention. The prompt instructs the model to treat instructions inside supplied material as review data. Models receive no repository/URL fetching, shell, test, editing, or PR tools.

## Claude provider — 0.3.0

Select `rebut set provider anthropic`, then use the existing `rebut set api-key` flow for one key. Keychain service/account: `com.abruption.rebut` / `anthropic-api-key`. For Vaultwarden, `rebut set vaultwarden-api-key-item NAME` sets the selected provider item; its default is `Rebut — Anthropic API Key`. No account aliases, key rotation, or provider fallback is added.

`claude-medium` uses Claude Opus 5.5 / medium. Explicitly add `--provider anthropic` when creating an Anthropic profile. Omitting it preserves an existing active profile provider; new/disabled profiles default to OpenAI, independently of the key-selection preference. Legacy profiles without provider remain OpenAI. The frozen bundle profile determines the actual provider and key, so retain the original bundle/ID after preference changes.

Each local/Worker ledger aggregates both providers under the same budget/concurrency limits. New requests retain `requested_provider` through reservation, completion, and errors; historical rows are unchanged. Missing thinking detail omits `reasoning_tokens`. Cache reads are conservatively charged at full base input rate; unexpected cache writes or nonstandard usage retain unknown reservations.

Claude uses the Messages API with standard tier/global geo and no tools or prompt caching. Workspace regional policies may reject a request; do not retry another key. Deploy Worker code with its existing OpenAI configuration, update clients, and only then add the `ANTHROPIC_API_KEY` secret and Anthropic profiles. Never forward administrator tokens to hosts.

Check [Claude Console billing](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage) for API costs and credit eligibility. Rebut API calls are distinct from Claude Code subscription usage.

New schema 2 bundles freeze the provider and include it in the hash. Collection reads profile metadata from the selected backend, so Worker collection requires its access token. Submission rejects a changed profile supplier with `provider_mismatch` before key loading or reservation. New legacy schema 1 requests are OpenAI-only; previously submitted IDs retain metadata access with their original bundle. Confirm a supplier change before collecting a new bundle.

Local collection may initialize the profile store. Schema 1 hashes omit provider and retain their original ordering.
