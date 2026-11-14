# Operations and recovery

[한국어](../ko/operations.md) · **English** · [简体中文](../zh-CN/operations.md) · [日本語](../ja/operations.md)

[README](../../../README.en.md) · [Installation](installation.md) · [Configuration](configuration.md)

## Unknown recovery

`reserved` may still be running or interrupted; `unknown` has an uncertain result or usage. Either may be billed. Neither automatically retries, expires, or refunds. One unresolved request can occupy the default slot and block new reviews.

1. Query `rebut status REQUEST_ID` with the same backend, principal, and `REBUT_CONFIG_DIR`. If the ID is lost, local `rebut status --pending` lists up to 100 entries with `has_more`. Local metadata queries need no OpenAI key; Worker queries use the existing access token. Neither invokes a paid model.
2. Stop hosts and back up the closed local SQLite ledger and settings. Back up Worker D1 using Cloudflare export/Time Travel.
3. Compare the original ID, input hash, profile, and available provider request/usage evidence. `not_found` alone does not prove non-execution; do not retry through a new ID or backend.
4. Preserve uncertain rows, full accounting reservations, and slots. Only an operator with independent evidence should reconcile the exact `(principal, request_id)`; the app offers no forced release/refund/deletion tool.
5. An operator intentionally starting a **different new review** can add only the required local capacity with `rebut set max-concurrent N` (maximum 10), retaining existing reservations. This neither releases the old request nor authorizes replay. Money ceilings still apply, custom limit snapshots remain intact, and hosts must restart.

`budget_reserved_microusd` and `budget_accounted_microusd` are app accounting values, not confirmed invoices. If all ten slots are uncertain, stop until evidence-based reconciliation. Restore temporary capacity to its intended value afterward and restart. Deleting rows removes deduplication and is not recovery.

## Diagnostics

`rebut doctor` checks local configuration/credentials; `doctor --connect` checks the selected backend and tool list. Neither is a paid review or a provider account-access test. Distinguish SSH Keychain failure from success in the same machine's logged-in session.

New unknown records may include `unknown_reason`, `provider_elapsed_ms`, provider IDs, and `upstream_status`. Bodies and exception strings are not retained. An HTTP error can precede a body-read timeout, so interpret fields together. Elapsed time is not proof of completed execution/billing, and missing historical fields are not reconstructed.

SIGINT/SIGTERM attempt to record unknown and close. SIGKILL, crashes, and network loss can leave reserved rows. No path automatically replays the call.

## Upgrades and key rotation

Update **CLI → Codex registration → host restart → Worker**. Retain custom directories and back up all of `config.toml` before registration. See [installation commands](installation.md#codex-registration-and-updates).

Back up `config.json` before using 0.2.0-only fields. Version 0.1.0 rejects them, including for Worker users, so a downgrade may need the older settings backup. Downgrading to 0.1.0 after using a local ledger is not ledger recovery. Never delete the ledger to restore settings compatibility.

Keep the same D1 and apply only pending migrations. For bearer rotation, update the `AUTH_TOKENS` digest and client credential store while preserving the principal ID. Rotate `OPENAI_API_KEY` separately. Do not place administrator tokens in MCP settings. `rebut remove` removes registration only.

## Development checks

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm run test:package
```

Worker tests use build output. Automated tests/package smoke mock the provider; they do not prove paid API access or model quality. Default actual API tests use `luna-test`; the operational default is `astra-medium`. Luna success does not establish Astra availability/quality. Historical details remain in the [0.2.0 source record](https://github.com/abruption/rebut/tree/v0.2.0/docs/guide/en).

Source boundaries: `service.ts` owns hashing, profiles, reservation/accounting; `review.ts` owns provider/evidence validation; `local.ts` supplies stdio/SQLite; `worker.ts` supplies HTTP authentication/D1. Local ledgers cover one directory; Workers share a deployment ledger.

## npm publication

Manual `publish.yml` runs from main, validates tag/source/version, and requires owner approval in the `npm` Environment. Building/smoke testing has no OIDC write permission; only publishing the verified tarball has it. PR merges and GitHub Release events do not publish.

After publication/verification problems, inspect the original run and registry version/integrity before deciding whether to retry. Do not republish an already published version. The [Korean release checklist](../../releases/release-checklist.ko.md#github-actions-trusted-publisher) covers setup, approval, and seven-day artifact retention. The workflow does not deploy Workers or update installed clients.
