<div align="center">

# Rebut

[![npm version](https://img.shields.io/npm/v/rebut-mcp)](https://www.npmjs.com/package/rebut-mcp)
[![npm downloads](https://img.shields.io/npm/dm/rebut-mcp)](https://www.npmjs.com/package/rebut-mcp)
[![MIT license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/abruption/rebut/blob/main/LICENSE)

**Local-first independent code review MCP. Cloudflare Worker is optional.**

[한국어](README.md) · **English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

</div>

Rebut is an MCP server for reviewing selected code and diffs with the OpenAI or Claude API. It sends the review material to the provider you choose.

On 0.3.0+, select Claude with `rebut set provider anthropic`, then `rebut set api-key` and `rebut setup --client claude`. Host and provider are independent.

## Quick start

Requires Node.js 24+. This example uses macOS Keychain.

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

Restart Codex after registration. See [installation](docs/guide/en/installation.md) for Linux/env and Vaultwarden.

New installations use local stdio. Choose [Worker mode](docs/guide/en/installation.md#optional-worker-deployment) to share budgets and request history across devices. Existing Worker settings remain unchanged.

`review` starts a paid review. `doctor --connect` checks the connection without calling a model. If a result is uncertain, check the original request ID on the same backend. Never start a replacement review with a new ID while the result is unknown.

## Guides

- [Installation](docs/guide/en/installation.md)
- [Configuration](docs/guide/en/configuration.md)
- [Operations](docs/guide/en/operations.md)

[Releases](https://github.com/abruption/rebut/releases) · [MIT](LICENSE)
