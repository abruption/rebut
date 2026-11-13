<div align="center">

# Rebut

**Local-first independent code review MCP. Cloudflare Worker is optional.**

[한국어](README.md) · **English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

</div>

Rebut reviews code using your own OpenAI API key. New installations run a local stdio server without a Cloudflare account or a separate HTTP daemon.

Review material is sent to the OpenAI API; the local ledger stores only request and usage metadata.

The tested release targets macOS/Linux; Windows behavior and ACLs are not validated.

## Quick start

Use Node.js 24 or later. This example uses macOS Keychain.

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

`rebut set api-key` accepts hidden OpenAI API key input and stores it in Keychain. On Linux and other environments, select `rebut set secret-store env` and supply `REBUT_OPENAI_API_KEY` through the actual MCP host’s secure environment. Setup records the variable name only; never put keys in arguments or tracked files.

## Optional Worker

Choose a self-hosted Worker when multiple machines need a shared budget and request ledger. `rebut set endpoint URL` selects Worker mode. On macOS, `rebut set token` stores the separate Worker access token. The OpenAI API key, Worker access token and admin token are different credentials.

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut setup --client codex --replace
```

Existing endpoint configurations remain in Worker mode. Switch explicitly with `rebut set mode local`; failures never trigger automatic backend fallback. Switching does not move existing requests or reservations.

## What it does

- Collect, redact and freeze explicitly supplied files, diffs and requirements, then make one provider call.
- Use atomic budget reservations and deduplication in local SQLite or Worker D1. Source, reviews and keys are not stored in the ledger.
- Return structured findings with supplied file/line evidence, model identity, usage and estimated cost.
- Expose review and metadata-only review_status. Keep the same ID after uncertainty and do not replay an unknown on another backend.

Example defaults are $6.66/day and $200/month in UTC, one pending/unknown request, and 100 new requests/day. **Local limits cover only that device’s data directory**: they do not aggregate another Mac, Worker, external API usage or the OpenAI account balance. Worker users share that deployment’s ledger. Estimates are not invoices; uncertain executions keep their reservations and slots.

The provider waiting ceiling is 30 minutes, with corresponding HTTP/MCP and Codex deadlines. Local profile changes require OS ownership; Worker changes use separate admin authentication. See [installation](docs/guide/en/installation.md) and [configuration](docs/guide/en/configuration.md) for credentials, models, budgets and optional Worker deployment.

## Developer validation

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run test:package
```

Automated tests and package smoke tests mock the provider. Default real API tests use gpt-6-luna; production uses gpt-6-astra / medium. Luna success does not establish Astra review quality.

## Documentation

- [User guide](docs/guide/en.md)
- [Installation and input collection](docs/guide/en/installation.md)
- [Configuration, budgets and MCP contract](docs/guide/en/configuration.md)
- [Operations and recovery](docs/guide/en/operations.md)
- [Opt-in reviewer integration](docs/guide/en/reviewer-integration.md)
- [Architecture](docs/guide/en/architecture.md)
- [Validation and limits of the results](docs/guide/en/validation.md)
- [MIT license](LICENSE)
