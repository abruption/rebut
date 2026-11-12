# Configuration and MCP contract

[한국어](../ko/configuration.md) · **English** · [简体中文](../zh-CN/configuration.md) · [日本語](../ja/configuration.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)

## Server configuration

[`config.example.json`](../../../config.example.json) defines the structure of the `REBUT_CONFIG` secret. Set `hostname` to the exact endpoint hostname, configure server-side profile IDs, and set deployment-wide limits. Clients choose profile IDs; they cannot override model names or the provider URL. The example is configuration, not a promise of account-level model access.

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
