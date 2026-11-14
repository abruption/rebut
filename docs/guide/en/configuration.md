# Configuration and MCP contract

[한국어](../ko/configuration.md) · **English** · [简体中文](../zh-CN/configuration.md) · [日本語](../ja/configuration.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)

## Local profiles and budget scope

New settings use local mode; endpoint-only legacy settings remain Worker. `rebut set api-key` stores a local OpenAI key in Keychain, while Worker `set token` and `set admin-token` store different credentials. env uses REBUT_OPENAI_API_KEY locally, REBUT_TOKEN/REBUT_ADMIN_TOKEN for Worker. Vaultwarden local keys use vaultwarden-api-key-item. `rebut profile list/set/remove` targets the selected backend; local profile changes require no Worker admin token. Local profiles, revisions and metadata are stored in private SQLite. Limits apply to one data directory, not all devices or the OpenAI account. Use a shared Worker for a central ledger. A mode switch does not migrate uncertain requests or release reservations.

## Model and reasoning preferences

Set local preferences for newly collected bundles, or select a server profile directly:

```sh
rebut set model MODEL_ID
rebut set reasoning EFFORT
rebut set profile PROFILE_ID
```

`MODEL_ID`, `EFFORT`, and `PROFILE_ID` are placeholders. Model/reasoning preferences resolve an allowlisted server profile; they do not grant arbitrary model access. An explicit collector `--profile` overrides local preferences. With no preferences the default remains `astra-medium`. `rebut review` respects the profile embedded in the frozen bundle and does not rewrite it using current preferences.

## Owner-managed server profiles

Worker mode only: local profile management does not require these admin credentials.

The owner/admin instructions in this section apply only to Worker mode. Local profile commands use OS ownership and the local SQLite registry.

`rebut profile list` makes an authenticated, read-only GET to list server profiles, models, reasoning settings, output limits, rates, and revisions. It does not call the provider or start a paid review.

```sh
rebut profile list
rebut set admin-token
```

Profile mutation requires a separate owner admin bearer. `rebut set admin-token` uses hidden interactive input; `rebut set admin-token --stdin` explicitly accepts a protected pipe. Never pass tokens as arguments or put them in tracked files. macOS Keychain uses service `com.abruption.rebut`, review account `codex-mcp-bearer`, and admin account `codex-mcp-admin`. The selected Vaultwarden backend can use a separate user-selected item: default `Rebut — MCP Admin Token`, configured with `rebut set vaultwarden-admin-item NAME`. The env backend reads `REBUT_ADMIN_TOKEN` from a secure execution environment. The admin token is never forwarded to Codex. There is no automatic backend fallback.

After a one-time Worker upgrade, D1 migration `0002`, and `ADMIN_TOKEN_SHA256` secret setup described in [installation](installation.md), the owner can add/update a profile. This example uses the existing Astra/medium configuration and its dated 2026-11-12 Standard rates; verify the official [model](https://developers.openai.com/api/docs/models/gpt-6-astra) and [pricing](https://developers.openai.com/api/docs/pricing) documents before choosing values. For a new model, substitute the placeholder `MODEL_ID` with a verified Responses-compatible model ID and explicitly supply its supported reasoning setting, output limit, and official rates.

```sh
rebut profile set astra-medium --model gpt-6-astra --reasoning medium --max-output-tokens 8192 --input-usd-per-million 10 --output-usd-per-million 50 --price-version official-2026-11-12
```

Both prices and `--price-version` are required; the server uses them for budget reservations and cost estimates. Rebut does not automatically fetch prices or call a provider models endpoint. `--if-revision N` adds an explicit compare-and-swap revision condition to set/remove. A `409` conflict requires rereading `rebut profile list` and deciding what to change; never overwrite automatically.

```sh
rebut profile remove PROFILE_ID --if-revision N
```

Removal creates a disabling tombstone rather than deleting review history. Once Worker/D1 support is installed, these profile changes write D1 only: Responses-compatible new model IDs or reasoning values require no Worker build/deploy or npm upgrade. Existing requests retain their original model and revision after profile updates or removal. Changes never rerun requests or automatically release/refund reservations. The normal review bearer cannot mutate profiles; this owner API is not exposed as an MCP tool and cannot change budgets, authentication, or the provider URL.

## Server configuration

[`config.example.json`](../../../config.example.json) defines the structure of the `REBUT_CONFIG` secret. Set `hostname` to the exact endpoint hostname, configure server-side profile IDs, and set deployment-wide limits. Clients choose profile IDs; they cannot override model names or the provider URL. The example is configuration, not a promise of account-level model access.

`REBUT_CONFIG` supplies seed profiles. D1 overrides and disabling tombstones take precedence; profile removal does not restore a seed with the same ID. The server freezes the resolved profile and revision for each reserved request.

| Profile        | Model         | Reasoning | Maximum output tokens | Standard input/output per 1M tokens |
| -------------- | ------------- | --------- | --------------------- | ----------------------------------- |
| `astra-medium` | `gpt-6-astra` | `medium`  | 8,192                 | $10 / $50                           |
| `luna-test`    | `gpt-6-luna`  | `medium`  | 2,048                 | $0.10 / $0.50                       |

Output limits include reasoning tokens. The dated price table is `openai-standard-2026-11-12`; estimates apply no cached-input discount. Use **Luna for real API tests** and mocks for automated tests. The production profile remains Astra/medium; Luna results do not establish Astra runtime availability or equivalent review quality. Verify the official [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), and [pricing](https://developers.openai.com/api/docs/pricing) documents before deploying.

Requests pin `service_tier:default` and `prompt_cache_options.mode:explicit` with no breakpoints, disabling prompt caching for these profiles. No execution tools are supplied. Estimates are not invoices and do not account for other services sharing the key or project.

## Budget and concurrency

| Setting                             | Example value                      |
| ----------------------------------- | ---------------------------------- |
| UTC calendar day                    | $6.66 (`dailyMicrousd:6660000`)    |
| UTC calendar month                  | $200 (`monthlyMicrousd:200000000`) |
| Per request                         | $6.66 (`requestMicrousd:6660000`)  |
| Concurrent pending/unknown requests | 1 (`maxConcurrent:1`)              |
| New review requests per UTC day     | 100 (`dailyRequests:100`)          |

These limits aggregate all principals in the deployment. Reserve before calling: serialized request bytes plus framing padding count as input tokens, and the maximum output budget is reserved. Validated usage settles conservatively at uncached Standard rates. Unknown execution or missing usage keeps the full reservation. A new UTC day/month resets that period's spend window; unresolved executions continue occupying concurrency. Budget windows follow the original submission date, not a subscription credit's grant or expiration date. This ledger cannot enforce an OpenAI account-wide limit across other consumers. Confirm your account/organization's credit eligibility separately.

## Input limits and hashing

| Material                                | Limit              |
| --------------------------------------- | ------------------ |
| Canonically serialized UTF-8 JSON input | 128,000 bytes      |
| Files                                   | 40                 |
| Diff                                    | 100,000 characters |
| Requirements                            | 16,000 characters  |
| Transport envelope                      | 160,000 bytes      |

The SHA-256 covers canonical `{schema_version,task_kind,requirements,files,diff}` after redaction, with file key order `{path,start_line,content}`. Request IDs and profile names are separate from this frozen evidence hash. See [`ReviewInputSchema`](../../../src/contracts.ts) for the full contract. Preserve the same evidence for independent first-pass reviewers and keep their outputs separate.

## MCP tools

- `review`: choose an allowlisted profile ID and supply the frozen material. Returns status, validated findings, provider model/IDs, hash, usage and estimated microUSD. Only `completed` is a successful review. Refusal, incomplete generation, invalid output, and unknown execution remain distinct. Every finding must reference supplied file lines or supplied new-side diff lines. An empty findings array with a nonempty summary is valid; an empty or malformed response is not.
- `review_status`: `{request_id}` returns only metadata for the caller's principal. It cannot replay the review body.

After a timeout, query **the same request ID**. Repeating it never creates another provider execution. Reusing an ID with a changed input hash or profile returns `conflict`. A completed duplicate returns metadata rather than the review body: clients must save their initial response locally. See [operations](operations.md) for reconciliation; `not_found` after a transport failure is not by itself permission to use a new ID.

## Storage and privacy

The metadata-only D1 ledger retains request IDs, hashes, profile, status, reservation, sanitized provider IDs and usage. It never stores source or review text. Worker observability is disabled in the example. `AUTH_TOKENS` contains token digests, not bearer values; keep original bearer tokens in your password manager. See [installation](installation.md) for setup.

The OpenAI request uses `store:false`; this does **not** promise zero provider retention or replace your organization's data policy. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). Keep credentials and private deployment identifiers outside public source and logs.

When the result is `invalid_output`, `invalid_output_reason` identifies the failed validation stage without retaining source or review text. Intermediate `commentary` messages are excluded; only `final_answer` (or a legacy message with no phase) is parsed as the structured review. Multiple final outputs, invalid JSON/schema, and findings outside supplied evidence remain errors.

## Claude provider — 0.3.0

Select `rebut set provider anthropic`, then use the existing `rebut set api-key` flow for one key. Keychain service/account: `com.abruption.rebut` / `anthropic-api-key`. For Vaultwarden, `rebut set vaultwarden-api-key-item NAME` sets the selected provider item; its default is `Rebut — Anthropic API Key`. No account aliases, key rotation, or provider fallback is added.

`claude-medium` uses Claude Opus 5.5 / medium. Explicitly add `--provider anthropic` when creating an Anthropic profile. Omitting it preserves an existing active profile provider; new/disabled profiles default to OpenAI, independently of the key-selection preference. Legacy profiles without provider remain OpenAI. The frozen bundle profile determines the actual provider and key, so retain the original bundle/ID after preference changes.

Each local/Worker ledger aggregates both providers under the same budget/concurrency limits. New requests retain `requested_provider` through reservation, completion, and errors; historical rows are unchanged. Missing thinking detail omits `reasoning_tokens`. Cache reads are conservatively charged at full base input rate; unexpected cache writes or nonstandard usage retain unknown reservations.

Claude uses the Messages API with standard tier/global geo and no tools or prompt caching. Workspace regional policies may reject a request; do not retry another key. Workers need a separate `ANTHROPIC_API_KEY` secret and an Anthropic profile; update clients before the Worker. Never forward administrator tokens to hosts.

Check [Claude Console billing](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage) for API costs and credit eligibility. Rebut API calls are distinct from Claude Code subscription usage.
