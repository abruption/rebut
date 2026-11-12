# Rebut

An authenticated Cloudflare Worker MCP for independent, evidence-grounded reviews through the OpenAI Responses API. MIT licensed; deploy with your own Cloudflare account and OpenAI key.

Rebut reviews only the frozen material you explicitly submit. It cannot clone repositories, fetch arbitrary URLs, run commands or tests, change files, or create pull requests. It is an **opt-in reviewer**: it does not replace an existing Claude/Gemini review workflow.

## Develop

Node 24 is recommended (tests use `node:sqlite`).

```sh
npm ci
npm run typecheck
npm run build
npm test
```

Tests use synthetic inputs, mocked provider responses, real SQLite statements, and a local Workers/D1 runtime. `npm test` requires the Worker bundle from `npm run build`. No test makes a paid model call.

## Freeze a review input

Use an explicit source-file allowlist; do not collect an entire repository automatically.

```sh
umask 077
npm run --silent collect -- /path/to/project request-001 'Check that the supplied function preserves its input' src/example.ts > /protected/path/request-001.bundle.json
```

The collector rejects symlinks, secret filenames, binary files, and oversize material; it removes common recognizable secret patterns while preserving line numbers. Pattern redaction is incomplete: inspect the resulting bundle before sending. The SHA-256 covers canonical `{schema_version,task_kind,requirements,files,diff}` after redaction, with file key order `{path,start_line,content}`. Request IDs and profile names are separate from the frozen evidence hash. Files may also be supplied as numbered snippets, or a unified diff may be provided directly. Limits: 128,000 UTF-8 JSON bytes, 40 files, 100,000 diff characters, 16,000 requirement characters, and a 160,000-byte transport envelope.

## Deploy privately

1. Copy `wrangler.jsonc` to `wrangler.private.json` (ignored by Git). Set your account ID, an available Worker name, actual D1 ID, and `workers_dev:true` or your own route. Create a dedicated D1 database with `npx wrangler d1 create rebut-ledger`; set its ID in the private config.
2. Apply `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json`.
3. Deploy with `npx wrangler deploy --config wrangler.private.json`. An unconfigured Worker returns 503 and cannot call the provider.
4. Store three Workers Secrets: `OPENAI_API_KEY`, `REBUT_CONFIG`, and `AUTH_TOKENS`. Use Wrangler's interactive secret prompt or `secret bulk` via protected stdin; never put secret values in arguments or tracked files. `REBUT_CONFIG` uses the structure in `config.example.json`; change `hostname` to your exact endpoint hostname. `AUTH_TOKENS` is a JSON object mapping stable principal IDs to SHA-256 digests of independently generated random 256-bit bearer tokens. Store original tokens in your password manager. Clients with the same token share a principal; distinct tokens isolate request/status access.
5. Connect a bearer-header-capable MCP client to `https://YOUR_HOST/mcp`, and verify `tools/list`. Host and browser Origin validation apply before tool execution. This bearer setup does not implement OAuth for clients that require OAuth discovery.

The example profile is `astra-medium`: `gpt-6-astra`, medium reasoning, 8,192 maximum output tokens (including reasoning). Its dated price table uses Standard input $10/M and output $50/M, with no cached-token discount in estimates. The `luna-test` profile is reserved for tests: `gpt-6-luna`, medium reasoning, 2,048 output tokens, Standard input $0.10/M and output $0.50/M. Actual smoke tests use Luna; Astra runtime availability is not inferred from Luna results. Verify the [official model](https://developers.openai.com/api/docs/models/gpt-6-astra) and [pricing](https://developers.openai.com/api/docs/pricing) before deployment. Requests pin `service_tier:default` and `prompt_cache_options.mode:explicit` with no breakpoints, disabling prompt caching for these profiles; no tools are supplied. Estimates are not invoices and do not account for other services sharing the key or project.

The configuration sets UTC calendar-day $6.66, UTC calendar-month $200, request $6.66, one concurrent pending/unknown request, and 100 new requests/day. These are deployment-wide aggregate limits across principals. Reserve before calling: serialized request bytes plus framing padding count as input tokens, and the maximum output budget is reserved. Validated usage settles conservatively at uncached Standard rates. Unknown usage keeps the full reservation. A new UTC day/month resets that period's spend window; unresolved executions continue occupying concurrency. This application ledger cannot enforce an OpenAI account-wide limit across other consumers. Confirm your account/organization's credit eligibility separately.

## MCP tools

- `review`: input is `ReviewInputSchema` in `src/contracts.ts`; choose an allowlisted profile ID. Returns status, validated findings, provider model/IDs, hash, usage and estimated microUSD. Only `completed` is a successful review. Refusal, incomplete generation, invalid output, and unknown execution remain distinct. Every finding must reference supplied file lines or supplied new-side diff lines. An empty findings array with a nonempty summary is valid; an empty or malformed response is not.
- `review_status`: `{request_id}` returns only metadata for the caller's principal. It cannot replay the review body.

The Worker times out the provider call after 45 seconds; set your MCP client deadline above 60 seconds. If a client times out, query **the same request ID**. Repeating it never creates another provider execution. Reusing an ID with a changed input hash or profile returns `conflict`. A completed duplicate returns metadata, not the review body: clients must save their initial response locally.

The metadata-only D1 ledger retains request IDs, hashes, profile, status, reservation, sanitized provider IDs and usage. It never stores source or review text. Worker observability is disabled in the example. The OpenAI request uses `store:false`; this does **not** promise zero provider retention or replace your organization's data policy. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

## Operations and recovery

See [operations](docs/operations.md), [reviewer integration](docs/reviewer-integration.md), and [architecture](docs/architecture.md). The repository contains no deployed account identifiers or credentials. A private deployment is separate from publication of this source.
