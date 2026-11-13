# Installation and input collection

[한국어](../ko/installation.md) · **English** · [简体中文](../zh-CN/installation.md) · [日本語](../ja/installation.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)


Use Node.js **24 or later**. New installations default to a local stdio MCP server. No Cloudflare account, Worker endpoint or HTTP daemon is required.

```sh
npm install -g rebut-mcp
```

## Local setup

On macOS, `rebut set api-key` takes hidden OpenAI API key input and stores it in the login Keychain. The provider account is `openai-api-key` under `com.abruption.rebut`, separate from the Worker access/admin accounts. `--stdin` accepts a protected pipe; never use credential values as command arguments.

```sh
rebut set api-key
```

For environment-backed credentials, select `rebut set secret-store env` and provide `REBUT_OPENAI_API_KEY` in the secure environment of the actual MCP host. Setup records only that variable name. For Vaultwarden, use `rebut set secret-store vaultwarden` and `rebut set vaultwarden-api-key-item NAME`; the default local item is `Rebut — OpenAI API Key`. Existing bw-get login is required. There is no automatic credential or backend fallback.

## Connect and verify

```sh
rebut setup --client codex
rebut doctor --connect
```

`rebut setup --client codex` registers `rebut mcp` using CODEX_HOME or ~/.codex; select another home with --codex-home PATH. The host starts the server automatically. `doctor --connect` checks local credential availability, SQLite and real MCP tool registration without making a provider call; it does not prove API account access. Local env setup forwards REBUT_OPENAI_API_KEY by name only. Preserve custom REBUT_CONFIG_DIR when replacing a registration.

## Optional Worker mode

Setting an endpoint explicitly selects Worker mode. Existing endpoint-only configurations keep Worker mode on upgrade. Worker mode uses its separate MCP access token, not the local OpenAI key: on macOS store it with `rebut set token`; env mode reads REBUT_TOKEN and Vaultwarden uses vaultwarden-item. Admin operations use the separate admin credential. Use the private deployment section below if you need to create a Worker.

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut setup --client codex --replace
```

Use `rebut set mode local` to switch explicitly. No automatic fallback occurs. Backends do not share or migrate request history, reservations or budgets: never replay an unknown against another backend. Local SQLite lives at ~/.local/share/rebut/local/ledger.sqlite, or local/ under a custom REBUT_CONFIG_DIR. Defaults are UTC $6.66/day and $200/month for this data directory only; local budget commands are `set daily-budget`, `set monthly-budget`, and `set request-budget` with decimal USD values. Worker limits remain deployment configuration.

## Source checkout and developer validation

This guide targets CLI 0.2.0. The npm package runs the local server and optional Worker bridge; it is not a hosted review service and grants no API credits. Only optional Worker deployment needs a Cloudflare account and source checkout. Packages contain no real endpoint, private settings, credentials or review bodies.

```sh
npm ci
npm run typecheck
npm run build
npm test
```

Tests use synthetic inputs, mocked provider responses, real SQLite statements, and a local Workers/D1 runtime. `npm test` requires the Worker bundle from `npm run build`. No automated test makes a paid model call. See the [validation record](validation.md) for the separate Luna smoke test.

## Freeze a review input

Use an explicit source-file allowlist; do not collect an entire repository automatically. The collector emits frozen JSON on stdout. Default profile: `astra-medium`; real API tests must explicitly use `luna-test`.

```sh
umask 077
rebut collect --root /path/to/project --request-id request-001 --requirements 'Check that the supplied function preserves its input' --profile astra-medium -- src/example.ts > /protected/path/request-001.bundle.json
```

The collector rejects symlinks, FIFOs, secret filenames, binary files, and oversize material. It removes common recognizable secret patterns while preserving line numbers. Pattern redaction is incomplete: inspect the resulting bundle before sending. Files may also be supplied as numbered snippets, or a unified diff may be provided directly. The canonical hash and limits are explained under [configuration](configuration.md).

## Deploy privately

1. Copy `wrangler.jsonc` to `wrangler.private.json` (ignored by Git). Set your account ID, an available Worker name, actual D1 ID, and `workers_dev:true` or your own route. Create a dedicated D1 database with `npx wrangler d1 create rebut-ledger`; set its ID in the private config.
2. Apply `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json`.
3. Deploy with `npx wrangler deploy --config wrangler.private.json`. An unconfigured Worker returns 503 and cannot call the provider.
4. Store three Workers Secrets: `OPENAI_API_KEY`, `REBUT_CONFIG`, and `AUTH_TOKENS`. Use Wrangler's interactive secret prompt or `secret bulk` via protected stdin; never put secret values in arguments or tracked files. `REBUT_CONFIG` uses the structure in [`config.example.json`](../../../config.example.json); change `hostname` to your exact endpoint hostname. `AUTH_TOKENS` is a JSON object mapping stable principal IDs to SHA-256 digests of independently generated random 256-bit bearer tokens. Store original tokens in your password manager. Clients with the same token share a principal; distinct tokens isolate request/status access.
5. Connect a bearer-header-capable MCP client to `https://YOUR_HOST/mcp`, and verify `tools/list`. Host and browser Origin validation apply before tool execution. This bearer setup does not implement OAuth for clients that require OAuth discovery.

## One-time upgrade for owner-managed profiles

Dynamic profiles require one Worker upgrade from the source checkout, D1 migration `0002`, and the `ADMIN_TOKEN_SHA256` Worker secret. Apply pending migrations to the existing D1 database, preserving its ledger, then deploy the upgraded Worker with your private config. Generate a separate random 256-bit admin bearer, store its SHA-256 hash as `ADMIN_TOKEN_SHA256` using a protected interactive secret prompt, and keep the original bearer in your credential store. Do not reuse the review bearer or change existing principal IDs. After this one-time setup, CLI profile changes write D1 without another Worker build/deploy or npm upgrade.

Store the owner bearer with `rebut set admin-token` (hidden input), or explicitly use `rebut set admin-token --stdin` with a protected pipe. With the selected Vaultwarden backend, the default admin item is `Rebut — MCP Admin Token`; change it with `rebut set vaultwarden-admin-item NAME`. The env backend uses `REBUT_ADMIN_TOKEN` in a secure execution environment; it is never forwarded to Codex. Keychain service `com.abruption.rebut` separates review account `codex-mcp-bearer` from admin account `codex-mcp-admin`. Backends do not fall back automatically. See [configuration](configuration.md) for model preferences, listing, explicit prices, and revision-safe updates/removal.

## Run the client

`rebut review` reads a JSON bundle from stdin and starts a paid review only when explicitly selected by the user. `rebut status REQUEST_ID` is a free metadata query.

```sh
rebut review < /protected/path/request-001.bundle.json
rebut status request-001
```

Save the initial response locally with restrictive permissions; the server stores only metadata and cannot replay review bodies. Keep the same request ID after timeout or uncertainty. The provider deadline is 1,800 seconds (30 minutes). The MCP HTTP client allows 1,830 seconds and Codex `tool_timeout_sec` is 1,860 seconds, leaving time to record and deliver the outcome. Startup and handshake limits remain short and separate. Update both the Worker and CLI, refresh existing registration with `rebut setup --client codex --replace`, and restart Codex. Editing host configuration alone does not update the older limit inside the 0.1.0 CLI. See the [opt-in reviewer workflow](reviewer-integration.md).

## Upgrade or remove

Use the [operations guide](operations.md) to preserve the D1 ledger and reconcile pending executions before upgrading or removing a deployment. Source publication and a private paid deployment are separate actions.

Upgrade in this order: **install the CLI → refresh Codex registration with existing options preserved → restart Codex/MCP → deploy the Worker**. Deploying the longer Worker deadline first can let the old CLI disconnect at 65 seconds. Preserve custom registration options such as `REBUT_CONFIG_DIR`. Node HTTP headers/body deadlines also match the MCP tool deadline. Thirty minutes is an application upper bound, not a guarantee from every network or host. Sleep, termination or disconnection can leave a request reserved or unknown; query its original ID without automatic replay or reservation release.

After changing mode, credential backend or local budgets, refresh registration with `rebut setup --client codex --replace` when needed and restart MCP hosts. Existing processes keep their startup settings; doctor does not reload them. Preserve custom `REBUT_CONFIG_DIR` (for example, provide the same environment variable when rerunning setup). The chosen secret-store backend applies to all credential roles, which use separate accounts/items.

Local env mode defaults to REBUT_OPENAI_API_KEY so a key belonging to Codex or another application is not silently reused. To deliberately share OPENAI_API_KEY, run `rebut set api-key-env OPENAI_API_KEY`, refresh registration and restart. There is no fallback between these variables. Daily, monthly and per-request ceilings are independent; changing one does not scale the others. Custom limits are retained across upgrades. Tool descriptions are startup hints; execution resolves the explicit request profile dynamically.

The tested release targets macOS/Linux; Windows behavior and ACLs are not validated.
