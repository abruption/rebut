# Installation and input collection

[한국어](../ko/installation.md) · **English** · [简体中文](../zh-CN/installation.md) · [日本語](../ja/installation.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)

## npm CLI installation

Use Node.js **24 or later** and npm. Install the client/stdio bridge for your self-hosted Worker with:

```sh
npm install -g rebut
```

## Configure the client

Set your own endpoint, then store your bearer token. On macOS the default is Keychain; `rebut set token` prompts with hidden input. `rebut set token --stdin` explicitly accepts a protected pipe. Never supply token values as arguments or in tracked files.

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
```

For an existing Vaultwarden installation, select the backend explicitly. It uses `bw-get` and the default item `Rebut — MCP Access Token`; customize the item name if needed:

```sh
rebut set secret-store vaultwarden
rebut set vaultwarden-item NAME
```

On non-macOS, explicitly select `env` and supply `REBUT_TOKEN` through a secure execution environment. Do not write it to tracked files or command arguments. Backends never fall back automatically. The client needs no OpenAI provider key.

For the `env` backend, Codex setup stores only `env_vars = ['REBUT_TOKEN']` (the variable name), never its value. Supply the token in the secure execution environment of the actual Codex host; setting it only for the setup command does not make it available to later Codex sessions.

```sh
rebut set secret-store env
```

## Connect Codex and check configuration

```sh
rebut setup --client codex
rebut doctor
rebut doctor --connect
```

Setup uses `CODEX_HOME` or `~/.codex`; use `--codex-home PATH` for an explicit destination. It registers `rebut mcp` as the stdio server, preserves other MCP entries, and requires `--replace` to migrate an existing private `rebut` bridge.

`rebut doctor` reports sanitized local configuration and credential availability. `rebut doctor --connect` makes a free remote `tools/list` check; neither command starts a paid review.

## Source checkout and developer validation

The npm package is a client, not a hosted review service. Deploy Worker/D1 from a GitHub source checkout using your own Cloudflare account with Workers/D1 permissions and your own OpenAI Responses API key. Public source/npm grants no access to a personal Worker or credits. The package includes no real endpoint, private config, bearer, provider key, or reviews. These instructions target CLI `0.1.0`.

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

Save the initial response locally with restrictive permissions; the server stores only metadata and cannot replay review bodies. Keep the same request ID after timeout or uncertainty. Set the MCP client deadline above 60 seconds; the provider timeout is 45 seconds. See the [opt-in reviewer workflow](reviewer-integration.md).

## Upgrade or remove

Use the [operations guide](operations.md) to preserve the D1 ledger and reconcile pending executions before upgrading or removing a deployment. Source publication and a private paid deployment are separate actions.
