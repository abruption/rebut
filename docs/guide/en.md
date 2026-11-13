# Rebut user guide

[한국어](ko.md) · **English** · [简体中文](zh-CN.md) · [日本語](ja.md)

[Rebut](../../README.en.md)

Rebut is an opt-in, authenticated Cloudflare Worker MCP for independent reviews through the OpenAI Responses API. It reviews only explicitly supplied frozen evidence. It does not clone repositories, fetch arbitrary URLs, run commands or tests, edit files, or create pull requests.

Install the client with `npm install -g rebut`, configure your own Worker and credential backend, then run `rebut setup --client codex`. The package bridges a self-hosted Worker; Worker/D1 deployment still requires a GitHub source checkout, your own Cloudflare account, and your own OpenAI key. Start with [installation](en/installation.md) for Keychain, Vaultwarden, explicit env mode, free diagnostics, and opt-in paid review.

| Guide                                              | Contents                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Installation](en/installation.md)                 | Requirements, source setup, input collection, private deployment, MCP client            |
| [Configuration](en/configuration.md)               | Profiles, model/test policy, UTC budgets, input/hash/tool contract, privacy             |
| [Operations](en/operations.md)                     | Timeout/unknown reconciliation, ledger preservation, upgrade, rotation and removal      |
| [Reviewer integration](en/reviewer-integration.md) | Explicit reviewer selection, shared frozen evidence, Vaultwarden wrapper, result checks |
| [Architecture](en/architecture.md)                 | MCP/provider boundaries, atomic reservation and duplicate prevention                    |
| [Validation](en/validation.md)                     | Mock tests, real Luna smoke test, usage and unverified scope                            |

Start with installation and configuration. Read operations before handling an unknown execution or changing a deployment. Existing Claude/Gemini defaults remain under the host's control.
