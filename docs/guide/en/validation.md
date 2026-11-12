# Validation — 2026-11-12

[한국어](../ko/validation.md) · **English** · [简体中文](../zh-CN/validation.md) · [日本語](../ja/validation.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)

- TypeScript check and Worker dry-run bundle succeeded.
- 23 automated tests cover synthetic provider success/refusal/incomplete/malformed evidence and usage, timeout, response-size and source limits, real SQLite budget/claim isolation, and local Worker + D1 + MCP calls. Local simultaneous identical reviews dispatch exactly one mocked provider request.
- A deployed authenticated Worker was reached through the official MCP TypeScript SDK v2 client using the existing password-manager wrapper. No OpenAI key was sent to the client.
- One successful paid smoke test used **gpt-6-luna / medium**, explicitly selected for testing. Supplied synthetic `sum.ts` returned `a - b` under a requirement to return the sum. The model reported line 2 with the counterexample `sum(3, 2) = 1` instead of `5`; that finding was checked directly against the supplied source.
- Reported usage: 308 input tokens, 143 output tokens (24 reasoning), 0 cached input. Conservative Standard-price estimate: 103 microUSD ($0.000103). This is an application estimate, not an invoice.

The operating profile remains **gpt-6-astra / medium**. The initial Luna validation did not exercise Astra; its results establish neither Astra availability nor equivalent review quality. A prior attempt with an existing Decisions-only key was refused by the provider; that shared key's permissions were preserved and the deployment was switched to a separate user-supplied Rebut key. No automatic paid retry was performed after the initial unknown response.

Account IDs, endpoint hostname, principal credentials, private deployment config, and provider request/response IDs remain outside these public-source artifacts. OAuth-only clients, MacBook installation, asynchronous replay, and any public GitHub/npm release are not established by this validation.

Remote unauthenticated requests returned 401; cross-origin requests returned 403. Resubmitting the successful Luna request returned only the original metadata and did not create another ledger row or provider execution. Additional collector checks reject FIFO/symlink sources and redact quoted JSON keys and Bearer assignments while preserving source line counts.

## Final-answer parsing regression

Seven additional synthetic tests reproduce and cover commentary followed by a structured final answer, JSON-looking commentary, legacy phases, missing or ambiguous final output, and bounded validation reasons. The complete Worker suite passes 30 tests. No new paid API request was made to validate this fix. A user-authorized Astra review returned model/usage metadata but was rejected as `invalid_output`; its discarded body does not establish which validation branch failed. A successfully validated Astra review and quality parity remain unverified.
