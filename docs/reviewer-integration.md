# Opt-in independent review

Keep your existing reviewer's default policy. Select Rebut only when the user explicitly requests the OpenAI API reviewer. Selecting Rebut alone does not authorize Claude/Gemini calls, and the presence of this adapter never implies a three-reviewer fanout.

1. Collect only needed evidence, remove secrets, inspect it, freeze it, and record the canonical SHA-256. Use the same evidence for independent reviewers and keep their outputs separate. Do not include another reviewer's output or the primary agent's intermediate conclusion in an independent first pass.
2. Choose the server's allowlisted profile. The supplied example uses Astra/medium. Set a fresh request ID for an intentionally new review; keep the same ID after any timeout or uncertain response.
3. Use `npm run client -- review` with the JSON bundle on stdin and private `REBUT_ENDPOINT` / `REBUT_TOKEN` environment variables. Save the response locally under restrictive permissions. Avoid putting bearer values in commands or tracked configuration.
4. For an existing Vaultwarden workflow, `REBUT_ENDPOINT=https://YOUR_HOST/mcp python3 scripts/bw-client.py review < /protected/request.bundle.json` loads the named token with `bw-get` and passes it to the client only in memory. The default password-manager item is `Rebut — MCP Access Token`; override its name with `REBUT_BW_ITEM` if needed. No OpenAI key goes to the client. `list` and `status REQUEST_ID` perform no paid review.
5. Confirm status `completed`, expected model/profile/hash and valid findings/usage. Empty findings are not proof of correctness. Check each claimed defect against the original source. Report actual model, input hash, usage, estimated cost, and limitations; schema conformance does not validate a finding's truth.
6. For a failed/timeout request use `status REQUEST_ID`; never retry under a new ID automatically. `unknown`/`reserved` can mean billed execution and retain reservations. A completed duplicate returns metadata only. Preserve the first response locally.

This API adapter is distinct from Codex CLI and grants no tools, repository access, shell execution, code changes or publication rights to the reviewer. Only the deployment's tested client/device can be claimed compatible; verify every additional host separately without copying browser profiles or credentials.
