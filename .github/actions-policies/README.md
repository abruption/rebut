# Trusted metadata workflow event policy

`trusted-pr-policy.json` is a proposed GitHub repository Actions policy payload for `abruption/rebut`. **Committing or merging it does not apply the setting.** There is no privileged apply workflow or automatic reconciliation.

The administrator must explicitly approve the live change separately from this Draft PR. Use a reviewed, immutable commit when applying; normally use the merged revision. If event enforcement blocks the source PR from merging, explicit owner approval may instead cover the reviewed PR-head commit and its payload hash before merge. This does not authorize a merge or a protection bypass. This runbook changes neither required checks nor review/branch rules.

## Why this file needs an exception

`Trusted Issue-first PR` must read its policy from the trusted base revision. It uses `pull_request_target`, reads PR/Issue metadata with read-only permissions, and never checks out or executes PR code or installs project dependencies. The declaration allows that event only for `.github/workflows/trusted-pr-policy.yml`. It adds no actor exceptions, bypass actors, write permissions, other events, or all-workflow targeting. Other workflows do not match this policy; applicable parent policies can still restrict execution.

This is a path-only exception, not a ref, permission, or PR-base-branch restriction. It does not itself make workflow code read-only. Current [GitHub documentation](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target) sources `pull_request_target` workflow code from the repository default branch; audit that actual trusted source rather than treating a PR base/head SHA as runtime proof. Recheck the default branch, workflow permissions and code before applying or changing the default branch. No workflow branch filter is added by this declaration.

As observed on 2026-11-16, the repository policy API returned `total_count: 0`; Insights showed the default event rule in **Evaluate / Would block**. Successful checks during evaluation do not prove future allowance. As of that observation, GitHub schedules a brownout for November 16 16:00–18:00 UTC (November 17 01:00–03:00 KST) and default enforcement from December 2, 2026.

## Before applying

1. Obtain explicit owner approval for the live settings change. Review the approved commit's JSON and the default-branch workflow again; preserve the metadata-only/read-only boundary.
2. Inspect **Settings → Actions → Policies → Policy insights**, including inherited policies. Confirm the authenticated repository and save the current policy details and branch rules outside the public repository.
3. List policies (including parents):

   ```sh
   gh api -H 'X-GitHub-Api-Version: 2026-03-10' \
     'repos/abruption/rebut/actions/policies?has_parents=true&per_page=100' --paginate
   gh api repos/abruption/rebut/rules/branches/main
   gh api 'repos/abruption/rebut/rulesets?includes_parents=true&per_page=100' --paginate
   gh api repos/abruption/rebut/branches/main/protection
   ```

   Inspect each relevant policy by its returned `source_type`, source, ID and API link. If the exact active declaration already exists, verify and reuse it. If another policy exists or conflicts, review it before any create/update; do not overwrite or remove it. A 403/404 is not evidence that no policy exists. Do not weaken parent policies.

Read each applicable ruleset through its returned API link to inspect `bypass_actors`; the effective branch-rules endpoint alone does not expose them. Read classic branch protection too. A classic-protection 404 is distinct from active ruleset protection, not proof that main is unprotected.

4. Confirm main still requires `Trusted Issue-first PR` and `verify`, strict checks remain enabled, and existing PR/review/thread-resolution/force-push/deletion protections and bypass settings are unchanged. This policy has no reason to modify them.

## Apply once, after approval

In the UI, choose **Settings → Actions → Policies → New policy**, enforcement **Active**, target exactly the workflow path above, and restrict events to **pull_request_target** only. Do not omit the path, use an empty include, `~ALL`, or a glob.

Alternatively, from this repository, set `rebut_policy_commit` to the exact owner-approved 40-character commit SHA (merged or explicitly approved PR head). Verify the commit and compare the payload SHA-256 with the review record before submitting through the administrator's existing authenticated `gh` session. Read from that Git object, not a mutable working-tree file:

```sh
set -o pipefail
rebut_policy_commit=REPLACE_WITH_OWNER_APPROVED_COMMIT_SHA
git rev-parse --verify "${rebut_policy_commit}^{commit}"
git show "$rebut_policy_commit":.github/actions-policies/trusted-pr-policy.json | shasum -a 256
# Continue only after matching the owner-approved SHA and payload hash.
git show "$rebut_policy_commit":.github/actions-policies/trusted-pr-policy.json | \
  gh api --method POST -H 'X-GitHub-Api-Version: 2026-03-10' \
    repos/abruption/rebut/actions/policies --input -
```

Record the returned policy ID and read that exact policy back. If the POST times out or its outcome is unknown, list policies and reconcile by name, repository source/source_type, active enforcement, exact workflow include/exclude and event before considering any retry. Do not blindly POST again or create duplicate policies. Never put tokens in command arguments or tracked files.

## Verify the live result

- Read the exact created/reused policy through its returned API link. Compare enforcement, workflow `include`/`exclude`, rule type and sole allowed event with the reviewed JSON. Confirm the repository source is correct and effective parent policies do not block the workflow.
- Re-read effective main rules and compare the protected settings captured above; do not remove the required trusted check to make a blocked run pass.
- On the next legitimate PR event, inspect a **new** run and its Insights entry. Match the workflow path, `pull_request_target` event, PR head, GitHub Actions app/check suite, and actual job success. Inspect read-only permissions and absence of PR checkout/execution. A pre-apply run or historical Would block entry does not verify the new policy; do not open an adversarial PR or fabricate a status. A rerun alone may not re-evaluate the original event policy.
- Confirm the target workflow is allowed, while policy scope still excludes every other workflow. No broad event enablement is needed. If actual enforcement/Insights cannot be observed, report that limitation instead of declaring verification complete.

PR merge, live policy application, and post-apply verification are separate milestones. The source PR closes Issue #38 only. Track live approval, application ID and post-apply evidence in separate [operational Issue #39](https://github.com/abruption/rebut/issues/39); source merge must not close that issue. Leave it open until live application and verification complete.

## Rollback

With explicit owner approval, restore the captured previous version of only this policy, or disable/delete only the new policy by its confirmed ID if none existed before. This restores default blocking for the trusted workflow and can prevent PRs from merging during enforcement. Report that availability impact; keep required checks, reviews, and all other protection active. Fix/reapply the reviewed scoped exception rather than bypassing protection. Use only the UI or methods rechecked in the current official API documentation. Never delete a policy whose ownership or identity is uncertain.

## References

- [GitHub announcement and brownout schedule](https://github.blog/changelog/2026-11-02-pull_request_target-blocked-by-default-december-2/)
- [Workflow execution policies and Insights](https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution)
- [Repository Actions policy API](https://docs.github.com/en/rest/actions/policies)
- [Default policy for pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target#default-policy-for-pull_request_target)
