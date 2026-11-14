# Rebut user guide

[한국어](ko.md) · **English** · [简体中文](zh-CN.md) · [日本語](ja.md)

[Rebut](../../README.en.md)

Rebut is a local-first, opt-in code review MCP using your own OpenAI or Claude API key. New installs run stdio locally; Cloudflare Worker is optional for a shared ledger. It reviews only supplied frozen evidence and gives the model no repository, URL-fetch, shell, test, edit or PR tools.

Install rebut-mcp, configure the local provider key, then run rebut setup --client codex. Existing endpoint-only configurations stay Worker. See [installation](en/installation.md) for Keychain, Vaultwarden, env credentials and optional Worker setup.

| Guide                                              | Contents                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Installation](en/installation.md)                 | Requirements, source setup, input collection, private deployment, MCP client            |
| [Configuration](en/configuration.md)               | Profiles, model/test policy, UTC budgets, input/hash/tool contract, privacy             |
| [Operations](en/operations.md)                     | Timeout/unknown reconciliation, ledger preservation, upgrade, rotation and removal      |
| [Reviewer integration](en/reviewer-integration.md) | Explicit reviewer selection, shared frozen evidence, Vaultwarden wrapper, result checks |
| [Architecture](en/architecture.md)                 | MCP/provider boundaries, atomic reservation and duplicate prevention                    |
| [Validation](en/validation.md)                     | Mock tests, real Luna smoke test, usage and unverified scope                            |

Start with installation and configuration. Read operations before handling an unknown execution or changing a deployment. Existing Claude/Gemini defaults remain under the host's control.
