# Architecture

[한국어](../ko/architecture.md) · **English** · [简体中文](../zh-CN/architecture.md) · [日本語](../ja/architecture.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)

## Local and Worker execution

New installations use local stdio MCP → the shared review service → private SQLite reservation → one OpenAI Responses call → validation and metadata settlement. No Cloudflare account, local HTTP port or daemon is required. Explicit Worker mode retains authenticated HTTP MCP → D1 → the same provider adapter.

src/service.ts owns hash/profile selection, request ownership and settlement; src/review.ts owns provider and evidence validation; src/local.ts adapts Node SQLite and stdio; src/worker.ts retains HTTP authentication and D1 bindings. Local provider keys, Worker access tokens and admin tokens are separate. Neither ledger stores source, review bodies or keys. Local budgets and IDs cover only one local directory; Worker principals share one deployment. Switching backends does not migrate history or authorize replay of an uncertain request.

The existing Worker-specific path and references follow.


Client explicit allowlist → redact/freeze/hash → authenticated Streamable HTTP MCP → validated profile/hash → atomic D1 reservation → one bounded Responses call → schema/evidence/usage validation → metadata settlement → return review to client.

The host-independent contract and provider adapter live in `src/contracts.ts` and `src/review.ts`; `src/worker.ts` supplies MCP/authentication and `src/ledger.ts` supplies the D1 adapter. Cloudflare's per-request `createMcpHandler` uses MCP SDK v2 and supports legacy stateless clients. Stateful sessions, background tasks, OAuth, model-driven tools, repository access, and persisted review replay are outside this MVP.

A single `INSERT ... SELECT` evaluates global UTC budgets, active reservations, and daily request counts while writing the request row. Its unique `(principal,request_id)` key selects a single owner with an unpredictable claim. Only that owner dispatches the provider call and settles the row. Crash windows retain the reservation; execution never depends on `waitUntil` or an automatically expired lease. Instructions embedded in supplied material are treated as data, findings must cite supplied lines, and the model has no execution tools.

References checked 2026-11-12:

- [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Cloudflare MCP handler](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

Compatibility was checked through a real local Workers/D1 runtime using synthetic upstream responses. This does not establish arbitrary client support or review quality parity with other models.
