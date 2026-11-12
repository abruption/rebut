# Operations

[한국어](../ko/operations.md) · **English** · [简体中文](../zh-CN/operations.md) · [日本語](../ja/operations.md)

[Rebut](../../../README.en.md) · [User guide](../en.md)

Back up the metadata-only D1 ledger using Cloudflare's supported export/Time Travel mechanisms. Do not delete the ledger to clear an inconvenient pending request: doing so loses spend and duplicate protection. Retain request rows for the lifetime of IDs clients may reuse; pruning permits old IDs to execute again.

Use `rebut status REQUEST_ID` for a free metadata lookup under the original principal. `rebut doctor` checks sanitized local configuration and credential availability; `rebut doctor --connect` performs a free remote `tools/list` check. None of these commands starts a paid review. Preserve the request ID and reservation after any uncertain result.

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
