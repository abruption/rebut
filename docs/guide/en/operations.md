# Operations

[한국어](../ko/operations.md) · **English** · [简体中文](../zh-CN/operations.md) · [日本語](../ja/operations.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)

## Local operations

Stop local MCP processes before backing up the metadata-only SQLite ledger and its settings. Preserve request history and unknown reservations; do not delete or live-sync an open ledger to clear a limit. API keys are not in SQLite and stay in the selected credential backend. SIGTERM attempts to abort and record uncertain in-flight work before closing; a crash, SIGKILL or network interruption may still leave reserved state. Look up the original ID without replaying it. `rebut remove` removes registration only, not the ledger or credentials. The D1 operations below apply only to Worker mode.

## Worker

Back up the metadata-only D1 ledger using Cloudflare's supported export/Time Travel mechanisms. Do not delete the ledger to clear an inconvenient pending request: doing so loses spend and duplicate protection. Retain request rows for the lifetime of IDs clients may reuse; pruning permits old IDs to execute again.

Use `rebut status REQUEST_ID` for a free metadata lookup under the original principal. `rebut doctor` checks sanitized local configuration and credential availability; `rebut doctor --connect` performs a free remote `tools/list` check. None of these commands starts a paid review. Preserve the request ID and reservation after any uncertain result.

Owner profile changes use revisions: after a `409` conflict, reread `rebut profile list` before deciding whether to set/remove again. Removal leaves a disabling tombstone. Existing requests keep their original model/revision, principal-scoped ID, and reservation even after profile changes; no automatic rerun, refund, or reservation release follows. After the one-time Worker upgrade, D1 migration `0002`, and `ADMIN_TOKEN_SHA256` setup, profile updates require only D1 writes. Keep the separate admin bearer out of Codex/MCP configuration.

## Timeout, disconnect, or unknown

`reserved` means an execution was reserved and may still be running or may have been interrupted; it is not proof of an unbilled failure. `unknown` means the outcome or usage could not be verified. Neither status is automatically retried, expired, or refunded. Both occupy concurrency indefinitely until reviewed. This intentionally stops further spending when execution cannot be reconciled.

1. Keep the original request ID, principal, input hash, profile, and provider IDs (if present).
2. Query `review_status` using that principal. A response with `not_found` after a transport failure is not alone sufficient evidence to submit a new ID: reconcile server processing and the original request first.
3. Compare provider project usage and request diagnostics. With `store:false`, response retrieval may be unavailable; no review replay is promised.
4. Only an operator with independent evidence should update the exact `(principal, request_id)` row, preserve its charged/reserved amount unless authoritative usage establishes a different charge, and set a reconciled terminal state. The application exposes no reset/refund/delete tool. Record evidence privately. Never silently turn an unknown execution into a new paid invocation.

Reservations are charged to the original UTC submission day/month, including after reconciliation. Day and month boundaries do not reset unknown concurrency. The request amount cannot exceed the remaining daily/monthly aggregate limits. Rate limiting applies to new reserved review IDs (100/day in the example), not free metadata calls; put network-level abuse controls in front if needed.

## Upgrade

Run `npm ci`, typecheck, build, and tests. Review migration SQL first, then apply new migrations to the same D1 database and deploy with your private config. Existing `(principal, request_id)` rows must survive upgrades. Changing an allowlisted profile does not reexecute completed IDs; use new IDs only for intentionally new reviews after reconciliation. Changing a principal ID loses access to its existing status rows, so keep IDs stable when rotating bearer tokens.

## Rotate or remove

Rotate a token by generating a new random value and replacing that principal's digest in `AUTH_TOKENS`, then updating the authorized client's password-manager-backed configuration. Do not change the principal ID merely to rotate a token. Rotate the OpenAI key by updating only `OPENAI_API_KEY`; other consumers of a shared key need their own coordination. Delete the Worker to stop new requests. Export and review the ledger before separately removing D1; deletion is irreversible and makes deduplication history unavailable.

## Local recovery and bounded capacity

1. Stop MCP hosts and inspect the original request with `rebut status REQUEST_ID`; do not resubmit it.
2. Back up the closed local ledger and settings. Review provider evidence when available. `budget_reserved_microusd` and `budget_accounted_microusd` are application accounting, not confirmed invoices for unknown executions.
3. If the execution remains uncertain, retain its row, full accounted reservation and ID. Do not mark it unbilled, delete it or manufacture a completed result.
4. After explicitly accepting that retained accounting, an operator may add bounded capacity for intentionally new reviews. For one uncertain request occupying the default one slot, `rebut set max-concurrent 2` adds one slot; the range is 1–10. It does not release the old slot, refund money or authorize retry of the old input.
5. Restart MCP hosts. Daily/monthly/request limits still apply to the total accounted spend. Actual ledger settlement needs independent evidence and a targeted operator review; it is not automated.

If the ID is missing, start with `rebut status --pending`: it lists up to 100 local reserved/unknown metadata records without keys or provider calls, with has_more if more exist. It is a diagnostic snapshot, not authorization for a new paid invocation. If no rows are pending, a money or daily-request ceiling may still be responsible for limit_exceeded.

Capacity is capped at 10. If all slots remain uncertain, stop for evidence-based operator reconciliation rather than deleting history or mislabelling unknown as unbilled. Once independently reconciled, reduce temporary capacity back to the intended normal limit (default 1) and restart.

Choose capacity from the pending count plus the deliberately allowed new parallel requests (maximum 10), rather than copying the example 2 over an existing custom limit. Capacity/budget commands retain a complete local-limit snapshot. If the original ID is missing, run status --pending before step 1.

## Maintainer npm publication

The manual `publish.yml` workflow uses npm Trusted Publishing (OIDC) without a stored npm token. It runs only from main for a stable tag naming the exact workflow source commit, then requires the `abruption` owner's approval in the `npm` GitHub Environment. Building and testing have no OIDC write permission; only publishing the verified tarball has it. PR merges and GitHub release events do not publish packages. Registry visibility failures after publication require inspecting the original run and artifact before retrying. This does not deploy Workers or update installed clients. The [maintainer release checklist (Korean)](../../releases/release-checklist.ko.md#github-actions-trusted-publisher) records setup and operation; the workflow must be merged and the npm trust configured before first use.

## Upgrading to 0.3.0

New settings or Anthropic profiles may cause 0.2.x to reject settings/profile lists. Back up settings and the closed ledger before upgrading. Review a rollback procedure that disables Anthropic profiles using 0.3.0 and restores compatible settings; never delete request history or unknown reservations. The updater does not reserialize unrelated Claude configuration, but a running host can overwrite changes, so stop it before registration.
