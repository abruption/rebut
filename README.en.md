<div align="center">

# Rebut

**Independent, evidence-grounded reviews through the OpenAI Responses API.**

[한국어](README.md) · **English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

**An authenticated Cloudflare Worker MCP that reviews the frozen material you explicitly provide.**

</div>

Rebut is an **opt-in reviewer**. It does not replace an existing Claude/Gemini workflow or automatically call three reviewers. MIT licensed; deploy with your own Cloudflare account and OpenAI key. Source publication and a personal paid deployment are separate actions.

## Quick start

Requires **Node.js 24 or later**. From a source checkout:

```sh
npm ci
npm run typecheck
npm run build
npm test
```

Automated tests mock the provider and make no paid model calls. Actual API tests use **gpt-6-luna**; the production example uses **gpt-6-astra / medium**. Luna results do not establish Astra availability or equivalent review quality.

Next, follow [installation and private deployment](docs/guide/en/installation.md). The Worker needs D1 and three secrets: `OPENAI_API_KEY`, `REBUT_CONFIG`, and `AUTH_TOKENS`. Connect a bearer-header-capable MCP client to `https://YOUR_HOST/mcp`. No npm package release is assumed.

## What it does

- Collects explicitly allowed text sources, removes common secret patterns, and hashes frozen evidence. Inspect redaction before sending.
- Checks authentication, an allowlisted profile, duplicate request IDs and a deployment-wide atomic budget reservation before one bounded Responses call.
- Returns structured findings with supplied file/line evidence, model identity, token usage and estimated cost.
- Exposes `review` and metadata-only `review_status`. After timeout/unknown, keep the same request ID; the server never automatically creates a replacement paid call.

The example limits are **$6.66 per UTC day**, **$200 per UTC month**, one pending/unknown request at a time, and 100 new review requests/day. The ledger tracks Rebut, not the account-wide credit balance. Unknown execution retains its reservation. Review bodies are not replayable; save the initial response locally.

The reviewer cannot clone repositories, fetch arbitrary URLs, execute commands/tests, edit files, or create pull requests. Source, review bodies and keys are not stored in D1 or Worker logs. `store:false` is not a zero-retention guarantee for the provider.

## Documentation

- [User guide](docs/guide/en.md)
- [Installation and input collection](docs/guide/en/installation.md)
- [Configuration, budgets and MCP contract](docs/guide/en/configuration.md)
- [Operations and recovery](docs/guide/en/operations.md)
- [Opt-in reviewer integration](docs/guide/en/reviewer-integration.md)
- [Architecture](docs/guide/en/architecture.md)
- [Validation and limits of the results](docs/guide/en/validation.md)
- [MIT license](LICENSE)
