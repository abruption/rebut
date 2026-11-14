# Installation and use

[한국어](../ko/installation.md) · **English** · [简体中文](../zh-CN/installation.md) · [日本語](../ja/installation.md)

[README](../../../README.en.md) · [Configuration](configuration.md) · [Operations](operations.md)

Requires Node.js 24+. macOS/Linux are tested; Windows behavior and ACLs are unverified.

## Local MCP

New installation using macOS Keychain:

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

Restart the host to start the local stdio server. No Cloudflare account or HTTP server is required. Review material goes to OpenAI using your key. `doctor --connect` checks credential availability and MCP tools without a paid review; it does not validate API account access.

An existing endpoint keeps Worker mode. To switch, run `rebut set mode local`, configure the key, and refresh registration. Switching does not migrate the ledger.

Other credential backends:

| Backend                     | Selection                            | Local OpenAI key                                                 |
| --------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| Keychain (macOS default)    | `rebut set secret-store keychain`    | Hidden input with `rebut set api-key`                            |
| Environment (Linux default) | `rebut set secret-store env`         | `REBUT_OPENAI_API_KEY` in the actual MCP host environment        |
| Vaultwarden                 | `rebut set secret-store vaultwarden` | Prepare `bw-get`, then `rebut set vaultwarden-api-key-item NAME` |

Vaultwarden needs an authenticated `bw-get` executable that accepts the item name as an argument and returns the secret on stdout. Override its path with `REBUT_BW_GET` in the MCP host environment if needed.

Keep credentials out of CLI arguments and tracked files. Env registration stores variable names only. Sharing `OPENAI_API_KEY` requires explicit `rebut set api-key-env OPENAI_API_KEY`; there is no fallback. See [credential roles](configuration.md).

## Codex registration and updates

```sh
npm install -g rebut-mcp
rebut setup --client codex --replace
rebut doctor --connect
```

Registration uses `CODEX_HOME` or `~/.codex`; use `--codex-home PATH` for another location. Back up `config.toml` before `setup --replace`. Supply the same custom `REBUT_CONFIG_DIR` in the setup shell. Restart the host after registration; running processes do not reload settings.

For 0.2.x → 0.3.0, use **Worker code with existing OpenAI configuration → CLI/registration/host restart → Claude key/profile enablement**. From 0.1.x, upgrade the CLI to 0.2.x first for the long deadlines. Provider/HTTP client/Codex tool limits are 1,800/1,830/1,860 seconds. They do not guarantee connection survival; other hosts also need suitable tool limits.

`rebut remove --client codex` removes registration, not settings, credentials, or the ledger. Follow [operations](operations.md) for backups and downgrades.

## Run a review

```sh
umask 077
rebut collect --root /path/to/project --request-id review-001 --requirements 'Check the supplied code' --profile astra-medium -- src/example.ts > /protected/path/review-001.bundle.json
rebut review < /protected/path/review-001.bundle.json
rebut status review-001
```

Select files explicitly. The collector rejects unsafe files, symlinks, FIFOs, and binaries and masks common secret patterns; inspect the bundle before sending it. `review` is a paid call; `status` retrieves metadata. Save the initial response because review bodies cannot be replayed.

Select paid reviews explicitly. Check for `completed` and compare the returned model and input hash with the frozen bundle/profile, then verify each finding against the source. For independent reviews, supply the same frozen material without sharing reviewers' results. After timeout/unknown, retain the ID and backend rather than submitting a new ID. Follow [recovery](operations.md#unknown-recovery).

## Optional Worker deployment

Use a Worker to share budgets and request history across devices. Deployment requires a source checkout, your Cloudflare account, and D1.

1. Check out the source and run `npm ci --ignore-scripts`. Copy `wrangler.jsonc` to ignored `wrangler.private.json`; set your account, Worker name, and host configuration.
2. Create D1 with `npx wrangler d1 create rebut-ledger --config wrangler.private.json` and put its ID in the private `DB` binding.
3. Apply existing migrations `0001` and `0002` with `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json`. Keep the same D1 and request rows on upgrades.
4. Deploy with `npx wrangler deploy --config wrangler.private.json`. Before configuration, the Worker returns 503.
5. Store these secrets through the interactive `npx wrangler secret put NAME --config wrangler.private.json` prompt, never as argument values.

| Worker secret        | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`     | Your provider key                                                                              |
| `REBUT_CONFIG`       | JSON matching [the example](../../../config.example.json), with the actual endpoint `hostname` |
| `AUTH_TOKENS`        | Stable principal ID → SHA-256 digest of a separate random 256-bit bearer token                 |
| `ADMIN_TOKEN_SHA256` | Digest of a separate administrator bearer, if profile management is needed                     |

Keep original bearers in your credential store. Separate review and administrator tokens, and retain principal IDs when rotating tokens. Authentication is Bearer, not OAuth.

Client setup on macOS:

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
rebut setup --client codex --replace
rebut doctor --connect
```

Setting an endpoint selects Worker mode, using an access token instead of a local OpenAI key. See [configuration](configuration.md) for env/Vaultwarden roles and administrator credentials. Worker deployment is separate from npm updates.

## Claude API and Claude Code — 0.3.0

Version 0.3.0+ selects the review provider and MCP host separately. Local macOS Keychain example:

```sh
rebut set mode local
rebut set provider anthropic
rebut set api-key
rebut setup --client claude
rebut doctor --connect
```

Switching providers selects its default profile and clears model/reasoning overrides; selecting the same provider preserves them. Existing OpenAI keys, profiles, and ledger history are not deleted.

Stop Claude Code and back up its config before registration. Only the Rebut user entry in `~/.claude.json` is updated. Use `--claude-config PATH` for another file; this is required when `CLAUDE_CONFIG_DIR` is set. A conflicting Rebut entry requires `--replace`. Project/managed same-name overrides must be checked separately. Registration atomically replaces the file with mode 0600; ACLs/xattrs are not retained. Restart Claude Code and inspect `/mcp`.

For env storage, select `rebut set secret-store env` and supply `REBUT_ANTHROPIC_API_KEY` to the actual host. Shared `ANTHROPIC_API_KEY` selection is not supported, avoiding changes to Claude Code authentication. Keychain/Vaultwarden registration adds no provider env placeholder. Env setup may also initialize local SQLite while resolving profiles. Env registration forwards the current default profile provider variable. A frozen other-provider bundle without its env key fails before reservation. Doctor reports the default profile provider in `provider`, and the `set api-key` target in `keyConfigurationProvider`. Re-register each host with `setup --replace` and restart after provider/backend/env changes.

Optional local-only `rebut doctor --provider` retrieves model metadata without generation, review reservations, or usage records. Resolving profiles may initialize local SQLite. `doctor --connect` remains an MCP check. Metadata reachability does not prove generation access, balance, geo, structured-output support, or quality.
