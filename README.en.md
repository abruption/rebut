<div align="center">

# Rebut

[![npm version](https://img.shields.io/npm/v/rebut-mcp)](https://www.npmjs.com/package/rebut-mcp)
[![npm downloads](https://img.shields.io/npm/dm/rebut-mcp)](https://www.npmjs.com/package/rebut-mcp)
[![MIT license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/abruption/rebut/blob/main/LICENSE)

**Local-first independent code review MCP. Cloudflare Worker is optional.**

[한국어](README.md) · **English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

</div>

An MCP for reviewing supplied code and diffs through the OpenAI API. Review material is sent to OpenAI.

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

`review` is a paid call; `doctor --connect` checks connectivity without a paid review. Keep the same request ID when the result is uncertain.

## Guides

- [Installation](docs/guide/en/installation.md)
- [Configuration](docs/guide/en/configuration.md)
- [Operations](docs/guide/en/operations.md)

[Releases](https://github.com/abruption/rebut/releases) · [MIT](LICENSE)
