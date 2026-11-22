# Installation and use

[한국어](../ko/installation.md) · **English** · [简体中文](../zh-CN/installation.md) · [日本語](../ja/installation.md)

[README](../../../README.en.md) · [Configuration](configuration.md) · [Operations](operations.md)

Requires Node.js 24+. macOS and Linux are tested. See the Windows section below for local MCP setup.

## CLI help and registration checks

Use `rebut help setup` or `rebut profile list --help` to see how to use a command.

Run `rebut setup --check --client codex` or `rebut setup --check --client claude` to inspect the Rebut launcher in the host configuration. Codex uses `CODEX_HOME` when set. Use `--codex-home PATH` to override it. Use `--claude-config PATH` for a custom Claude user file or when `CLAUDE_CONFIG_DIR` is set.

`current_launcher` means the registered launcher points to the same Node.js and Rebut CLI files and uses the selected client. The check distinguishes missing registrations (`not_registered`), missing files (`missing_launcher`), and different launchers (`different_launcher`). It also reports custom registrations (`custom_registration`), disabled Codex entries (`disabled`), and paths it could not verify (`unverified_launcher`). The command reads the selected user configuration and checks the launcher files. Check the running host for its connection status.

## Local MCP on Windows

On Windows, the local MCP reads the OpenAI API key from the `REBUT_OPENAI_API_KEY` environment variable. Choose a dedicated data directory in your Windows user profile, outside shared folders. Rebut starts with local defaults when that directory has no `config.json`. If the file exists, Rebut refuses to start. Commands that write settings, such as `rebut.cmd set mode local`, also return an error.

We installed `rebut-mcp@0.4.1` on Windows 10 x64 with Node.js 24. We ran a review with a simulated provider response in the Codex CLI App Server and the Claude Code CLI, then queried each original request from a fresh MCP process. A live OpenAI review attempt on 0.4.1 returned `unknown` with a transport error. Desktop app connections and Worker mode still need verification on Windows.

The example below is for a new installation. If you already use Rebut on Windows, keep your existing `REBUT_CONFIG_DIR` to retain access to request and usage records. To register with Claude Code, use `--client claude` on the last line.

```powershell
npm.cmd install -g rebut-mcp
$env:REBUT_CONFIG_DIR = Join-Path $env:LOCALAPPDATA 'Rebut\local-mvp'
$rebutKey = Read-Host 'OpenAI API key' -AsSecureString
try {
    $env:REBUT_OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $rebutKey).Password
} finally {
    $rebutKey.Dispose()
    Remove-Variable rebutKey
}
rebut.cmd doctor --connect
rebut.cmd setup --client codex
```

Start Codex or Claude Code from the same PowerShell session. If Rebut is already registered, see [how to refresh a registration](#codex-registration-and-updates). Programs started from this shell can inherit the key. After closing the host, you can remove the key from the shell with `Remove-Item Env:REBUT_OPENAI_API_KEY`.

Use the same `REBUT_CONFIG_DIR` next time. The request and usage records are in `local\ledger.sqlite` under that directory. If a result is uncertain, run `rebut.cmd status REQUEST_ID` with the original ID and the same `REBUT_CONFIG_DIR`. See [recovery](operations.md#unknown-recovery).

## Local MCP

New installation using macOS Keychain:

```sh
npm install -g rebut-mcp
rebut set api-key
rebut setup --client codex
rebut doctor --connect
```

Restart the host to start the local stdio server. No Cloudflare account or HTTP server is required. Review material goes to OpenAI using your key. `doctor --connect` checks credential availability and MCP tools without a paid review; it does not validate API account access.

An existing endpoint keeps Worker mode. To switch, run `rebut set mode local`, configure the key, and refresh registration. Switching does not migrate the ledger.

Other credential backends:

| Backend                     | Selection                            | Local OpenAI key                                                 |
| --------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| Keychain (macOS default)    | `rebut set secret-store keychain`    | Hidden input with `rebut set api-key`                            |
| Environment (Linux default) | `rebut set secret-store env`         | `REBUT_OPENAI_API_KEY` in the actual MCP host environment        |
| Vaultwarden                 | `rebut set secret-store vaultwarden` | Prepare `bw-get`, then `rebut set vaultwarden-api-key-item NAME` |

Vaultwarden needs an authenticated `bw-get` executable that accepts the item name as an argument and returns the secret on stdout. Override its path with `REBUT_BW_GET` in the MCP host environment if needed.

Keep credentials out of CLI arguments and tracked files. Env registration stores variable names only. Sharing `OPENAI_API_KEY` requires explicit `rebut set api-key-env OPENAI_API_KEY`; there is no fallback. See [credential roles](configuration.md).

## Codex registration and updates

```sh
npm install -g rebut-mcp
rebut setup --client codex --replace
rebut doctor --connect
```

Registration uses `CODEX_HOME` or `~/.codex`; use `--codex-home PATH` for another location. Back up `config.toml` before `setup --replace`. Supply the same custom `REBUT_CONFIG_DIR` in the setup shell. Restart the host after registration; running processes do not reload settings.

For 0.2.x → 0.3.0, use **Worker code with existing OpenAI configuration → CLI/registration/host restart → Claude key/profile enablement**. From 0.1.x, upgrade the CLI to 0.2.x first for the long deadlines. Provider/HTTP client/Codex tool limits are 1,800/1,830/1,860 seconds. They do not guarantee connection survival; other hosts also need suitable tool limits.

`rebut remove --client codex` removes registration, not settings, credentials, or the ledger. Follow [operations](operations.md) for backups and downgrades.

## Run a review

```sh
umask 077
rebut collect --root /path/to/project --request-id review-001 --requirements 'AC-1: Preserve sort order. AC-2: Retain empty results.' --profile astra-medium -- src/example.ts > /protected/path/review-001.bundle.json
```

Use the acceptance criteria a human approved in the issue or spec. Pin that version separately from the patch, ideally before implementation. Select the files needed to evaluate the patch and leave their summary out of `requirements` by default.

Before submitting, confirm the pinned version still applies and compare the actual masked `requirements` in the bundle with the approved criteria. Rebut checks that the submitted content matches its supplied hash. It cannot establish who approved the criteria or whether anything was omitted. If a correction changes the scope or masking changes a criterion’s meaning, check with the person who approved the criteria before submitting.

In this example, the reviewer needs evidence for both AC-1 and AC-2. If AC-2 or the code or tests needed to assess it are missing, treat AC-2 as unassessed, even when findings are empty. If approved criteria are missing or conflict, either resolve them first or scope the review to general defects. An empty findings list does not establish acceptance or authorize merging.

```sh
rebut review < /protected/path/review-001.bundle.json
rebut status review-001
```

If the bundle contains identifiable criteria, the reviewer is asked to summarize which it assessed and cite the evidence, even with no findings. For example, `summary` might report “AC-1: assessed from the sorting code in src/example.ts:12–16, no supported finding. AC-2: unassessed.” The `additional_evidence` would then ask for the empty-result code path or a relevant test.

Compare the report with the approved criteria and the evidence you sent. Keep a criterion unassessed if it is missing from the bundle or report, or if the cited evidence is insufficient. Use the model’s summary as a reference when checking the evidence. Follow your usual approval process for acceptance and merging.

Name the files you want the reviewer to see. The collector rejects unsafe files, symlinks, FIFOs, and binaries, and masks common secret patterns. Inspect the bundle before sending it. `review` starts a paid call. `status` fetches metadata. Save the first response. Status lookups cannot return the review body.

Run a paid review only when the user explicitly requests one. Once the response is `completed`, compare the returned model and input hash with the frozen bundle and profile. Check each finding against the source. Give independent reviewers the same material and keep their results separate. After a timeout or `unknown` response, check the original ID on the same backend. Do not retry with a new ID. See [recovery](operations.md#unknown-recovery).

### Review independently with two profiles

Use `review_pair` in Codex or Claude Code when the user explicitly selects two paid reviews. Pass the complete collected schema 2 bundle as `first`, and pass a distinct `request_id` and the second `profile` and its `provider` as `second`. For example, collect `first` with `astra-medium` / `openai` and pass `{"request_id":"review-002","profile":"claude-medium","provider":"anthropic"}` as `second`. Confirm the profiles with `rebut profile list`.

Both requests use the same evidence, with each input hash pinned to its provider. Budget and concurrency limits apply to each request, so only one may be admitted. Local concurrency defaults to one. Run `rebut set max-concurrent 2` and restart the MCP host to enable parallel local review. Rebut rejects the pair before dispatch if the local limit is below two. Each result includes its request ID and `has_review`. The pair is `partial` when it includes one review body and `incomplete` when it includes none. When both requests completed earlier and neither body can be replayed, the status is `completed_without_review`. If the response is lost, use `review_status` with both original IDs on the same backend before considering any further paid call. Status lookups do not replay review bodies.

The tool is available in the Rebut client in local and Worker modes. For an existing Codex registration, run `rebut setup --client codex --replace` and restart the host. Restart Claude Code to refresh the tool list. When local reviewers use different providers, the Rebut process needs both keys. Environment-based host registration forwards only the preferred provider variable by default.

## Optional Worker deployment

Use a Worker to share budgets and request history across devices. Deployment requires a source checkout, your Cloudflare account, and D1.

1. Check out the source and run `npm ci --ignore-scripts`. Copy `wrangler.jsonc` to ignored `wrangler.private.json`; set your account, Worker name, and host configuration.
2. Create D1 with `npx wrangler d1 create rebut-ledger --config wrangler.private.json` and put its ID in the private `DB` binding.
3. Apply existing migrations `0001` and `0002` with `npx wrangler d1 migrations apply rebut-ledger --remote --config wrangler.private.json`. Keep the same D1 and request rows on upgrades.
4. Deploy with `npx wrangler deploy --config wrangler.private.json`. Before configuration, the Worker returns 503.
5. Store these secrets through the interactive `npx wrangler secret put NAME --config wrangler.private.json` prompt, never as argument values.

| Worker secret        | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`     | Your provider key                                                                              |
| `REBUT_CONFIG`       | JSON matching [the example](../../../config.example.json), with the actual endpoint `hostname` |
| `AUTH_TOKENS`        | Stable principal ID → SHA-256 digest of a separate random 256-bit bearer token                 |
| `ADMIN_TOKEN_SHA256` | Digest of a separate administrator bearer, if profile management is needed                     |

Keep original bearers in your credential store. Separate review and administrator tokens, and retain principal IDs when rotating tokens. Authentication is Bearer, not OAuth.

Client setup on macOS:

```sh
rebut set endpoint https://YOUR_HOST/mcp
rebut set token
rebut setup --client codex --replace
rebut doctor --connect
```

Setting an endpoint selects Worker mode, using an access token instead of a local OpenAI key. See [configuration](configuration.md) for env/Vaultwarden roles and administrator credentials. Worker deployment is separate from npm updates.

## Claude API and Claude Code — 0.3.0

Version 0.3.0+ selects the review provider and MCP host separately. Local macOS Keychain example:

```sh
rebut set mode local
rebut set provider anthropic
rebut set api-key
rebut setup --client claude
rebut doctor --connect
```

Switching providers selects its default profile and clears model/reasoning overrides; selecting the same provider preserves them. Existing OpenAI keys, profiles, and ledger history are not deleted.

Stop Claude Code and back up its config before registration. Only the Rebut user entry in `~/.claude.json` is updated. Use `--claude-config PATH` for another file; this is required when `CLAUDE_CONFIG_DIR` is set. A conflicting Rebut entry requires `--replace`. Project/managed same-name overrides must be checked separately. Registration atomically replaces the file with mode 0600; ACLs/xattrs are not retained. Restart Claude Code and inspect `/mcp`.

For env storage, select `rebut set secret-store env` and supply `REBUT_ANTHROPIC_API_KEY` to the actual host. Shared `ANTHROPIC_API_KEY` selection is not supported, avoiding changes to Claude Code authentication. Keychain/Vaultwarden registration adds no provider env placeholder. Env setup may also initialize local SQLite while resolving profiles. Env registration forwards the current default profile provider variable. A frozen other-provider bundle without its env key fails before reservation. When `doctor` resolves a profile, `provider` shows the selected provider. If the profile has not been checked or cannot be resolved, `doctor` shows the shared provider. If `--client` selects a host with its own default, `doctor` omits `provider` when the profile cannot be resolved or was not checked. `keyConfigurationProvider` identifies the provider used by `set api-key`. Re-register each host with `setup --replace` and restart after provider/backend/env changes.

Optional local-only `rebut doctor --provider` retrieves model metadata without generation, review reservations, or usage records. Resolving profiles may initialize local SQLite. `doctor --connect` remains an MCP check. Metadata reachability does not prove generation access, balance, geo, structured-output support, or quality.
