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

## CLI validation scope

The initial 23-test record above and the 30-test parser regression suite describe historical Worker validation, not npm CLI coverage. CLI validation separately covers argument/configuration handling, credential-backend selection without automatic fallback, Codex setup preserving other MCP entries, frozen collector output, sanitized diagnostics, and mocked client/stdio transport. Run `npm run typecheck`, `npm run build`, then `npm test` in a source checkout; record the actual CLI results separately. These instructions do not establish npm publication, additional device compatibility, a successful Astra review, or a new paid API test. Use `luna-test` for any explicitly authorized real API test; automated tests must mock the provider.

## Unknown-result diagnostics

Newly processed `unknown` outcomes include an allowlisted `unknown_reason` and `provider_elapsed_ms`. These distinguish timeout, transport/body-read errors, size/JSON/encoding limits, and model/usage mismatches without retaining exception strings or response bodies. Already received safe provider request IDs and HTTP error statuses survive body-processing failures. Elapsed time is an application observation, not proof of provider execution or billing completion. Missing metadata in historical records cannot be reconstructed. Unknown reservations and concurrency slots remain held; diagnostics do not extend deadlines, retry requests, or release reservations.

`unknown_reason` describes where processing stopped. If `upstream_status` is also present, an HTTP error was observed before the body-read deadline expired. Interpret both fields together. Historical records and defensive failure paths may omit diagnostic fields.

In an authorized paid comparison, input that ended under the former 45-second deadline completed after about 195 seconds on an isolated version with a 30-minute deadline; provider headers arrived after about 194 seconds. This demonstrates an insufficient old deadline for that input, not a guarantee for all reviews. Apply the provider deadline of 1,800 seconds, MCP client deadline of 1,830 seconds, and Codex deadline of 1,860 seconds together. Unknown budget reservations and deduplication remain unchanged.
