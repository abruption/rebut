import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { validMonthlyStartDay } from "./budget-cycle.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  readSettings,
  writeSettings,
  settingsPath,
  executionMode,
  providerEnvName,
  type McpClient,
} from "./client/settings.js";
import { loadToken, storeToken } from "./client/secrets.js";
import {
  connectRemote,
  validateEndpoint,
  REMOTE_FAILURE_MESSAGE,
} from "./client/connection.js";
import { serveStdio } from "./client/stdio.js";
import {
  checkClaudeSetup,
  migrateClaudeToNpx,
  setupClaude,
  removeClaude,
  ClaudeSetupError,
} from "./client/claude.js";
import { providerDiagnostic } from "./client/provider.js";
import { UpdateError, updateGlobalInstallation } from "./client/update.js";
import { fullyQualifiedPath, NpxLauncherError } from "./client/npx-launcher.js";
import { profileProvider } from "./contracts.js";
import {
  checkCodexSetup,
  migrateCodexToNpx,
  setupCodex,
  removeCodex,
  CodexSetupError,
} from "./client/codex.js";
import { collect } from "./client/collector.js";
import { ReviewInputSchema, ReviewResultFormatSchema, type ReviewInput } from "./contracts.js";
import { hasCompletedReview, toolPayload } from "./client/tool-result.js";
import {
  profileCommand,
  workerBudget,
  listProfiles,
  resolveProfile,
  safeProfileError,
  price,
} from "./client/profiles.js";
import {
  openLocalRuntime,
  serveLocalStdio,
  localMcpServer,
  localConfig,
  localDirectory,
  type LocalRuntime,
} from "./local.js";
const HELP = `Rebut: local-first independent review MCP server

rebut set provider openai|anthropic
rebut set mode local|worker
rebut set api-key-env REBUT_OPENAI_API_KEY|OPENAI_API_KEY|REBUT_ANTHROPIC_API_KEY
rebut set max-concurrent N      Local capacity, 1–10; uncertain reservations remain held
rebut set api-key [--stdin]      Hidden selected-provider API key input
rebut set endpoint URL          Select optional Worker mode
rebut set secret-store keychain|vaultwarden|env
rebut set vaultwarden-item NAME
rebut set vaultwarden-api-key-item NAME
rebut set daily-budget USD
rebut set monthly-budget USD
rebut budget                    Show budget and unresolved concurrency (Worker admin)
rebut budget set-start-day DAY  Set a monthly UTC start day once per ledger (1–28)
rebut set request-budget USD
rebut set vaultwarden-admin-item NAME
rebut set model MODEL
rebut set reasoning EFFORT
rebut set profile PROFILE_ID [--client codex|claude]
rebut set profile --client codex|claude --clear
rebut set admin-token [--stdin]
rebut profile list
rebut profile set ID [--provider openai|anthropic] --model MODEL --reasoning EFFORT --max-output-tokens N --input-usd-per-million USD --output-usd-per-million USD --price-version VERSION [--if-revision N]
rebut profile remove ID [--if-revision N]
rebut set token [--stdin]        Hidden input; never pass a token as an argument
rebut setup --client codex|claude [--codex-home PATH | --claude-config PATH] [--replace]
rebut setup --check --client codex|claude [--codex-home PATH | --claude-config PATH]  Inspect the registered launcher
rebut remove --client codex|claude [--codex-home PATH | --claude-config PATH] [--replace]
rebut update                   Update the active global npm installation
rebut mcp [--client codex|claude] Start the local server or Worker bridge
rebut doctor [--connect] [--provider] [--client codex|claude]         Check selected backend; --connect lists tools, never calls a model
rebut status --pending           Reserved/unknown metadata for the selected backend
rebut status REQUEST_ID          Free metadata query
rebut review [--strict-exit]     Explicit paid review from JSON on stdin; strict mode requires a completed review body for exit 0
rebut collect --root PATH --request-id ID --requirements TEXT [--profile ID] [--client codex|claude] [--output-schema 1|2] [--criterion-id ID ...] -- FILE...
rebut help [COMMAND [SUBCOMMAND]]
rebut --version

New installs run locally with your selected provider API key. Host registration does not select the provider. No Cloudflare account is required.
Worker mode is optional; no private endpoint is bundled. Local budgets are per device.
Default OpenAI profile: astra-medium. Real API tests: luna-test only.
Use rebut help COMMAND or rebut COMMAND --help for command usage.
`;
class CliError extends Error {}
function output(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
function outputToolResult(
  value: Parameters<typeof toolPayload>[0],
  strictBundle?: ReviewInput,
) {
  output(value);
  if (strictBundle && !hasCompletedReview(value, strictBundle)) {
    if (!process.exitCode) process.exitCode = 1;
    process.stderr.write(
      "No completed review body. Check the JSON outcome and query the original request ID before any further paid invocation.\n",
    );
  }
}
function options(
  args: string[],
  opts: Record<string, any>,
  positionals = false,
) {
  try {
    return parseArgs({
      args,
      options: opts,
      allowPositionals: positionals,
      strict: true,
    });
  } catch {
    throw new CliError("Invalid arguments. Run rebut --help.");
  }
}
function selectedClient(value: unknown): McpClient | undefined {
  if (value === undefined || value === "codex" || value === "claude")
    return value;
  throw new CliError("Specify --client codex or claude.");
}

async function migrateUpdatedRegistrations() {
  const entrypoint = process.argv[1]!;
  const claudeDir = process.env.CLAUDE_CONFIG_DIR;
  const targets = [
    {
      name: "Codex",
      override: "CODEX_HOME",
      migrate: () => migrateCodexToNpx({ entrypoint }),
    },
    {
      name: "Claude Code",
      override: "CLAUDE_CONFIG_DIR",
      migrate: () =>
        migrateClaudeToNpx({
          entrypoint,
          claudeConfig: claudeDir ? resolve(claudeDir, ".claude.json") : undefined,
        }),
    },
  ];
  for (const target of targets) {
    const override = process.env[target.override];
    if (override && !fullyQualifiedPath(override)) {
      process.stderr.write(
        `Skipped ${target.name} MCP migration because ${target.override} is relative. Use an absolute path to migrate.\n`,
      );
      continue;
    }
    try {
      const result = await target.migrate();
      if (result.changed)
        process.stdout.write(`Migrated ${target.name} Rebut MCP to npx. Restart ${target.name}.\n`);
    } catch (error) {
      if (
        (error instanceof CodexSetupError || error instanceof ClaudeSetupError) &&
        error.code === "UNSUPPORTED_NPX_MIGRATION"
      )
        continue;
      const skipped =
        (error instanceof CodexSetupError && error.code === "UNSAFE_NPX_MIGRATION") ||
        (error instanceof NpxLauncherError && error.code === "NPX_RUNTIME_UNVERIFIED");
      if (!skipped) process.exitCode = 1;
      process.stderr.write(
        `${skipped ? "Skipped migration of" : "Could not migrate"} the ${target.name} Rebut MCP registration: ${safeError(error)}\n`,
      );
    }
  }
}

function commandHelp(command: string | undefined, rest: string[]) {
  if (!command || command === "--help" || command === "-h") return HELP;
  if (command === "--version" || command === "-v") return;
  const helpFlag = rest.at(-1);
  const namedHelp = command === "help";
  const trailingHelp =
    (helpFlag === "--help" || helpFlag === "-h") && !rest.includes("--");
  if (!namedHelp && !trailingHelp) return;
  if (namedHelp && !rest.length) return HELP;
  const usageFor = (topic: string[]) => {
    if (
      topic.length > 2 ||
      topic.some((part) => !/^[a-z][a-z-]*$/.test(part))
    )
      return [];
    const prefix = "rebut " + topic.join(" ");
    return HELP.split("\n").filter(
      (line) => line === prefix || line.startsWith(prefix + " "),
    );
  };
  const namedTopic = trailingHelp ? rest.slice(0, -1) : rest;
  const topic = namedHelp && namedTopic.length ? namedTopic : [command];
  const subcommand =
    !namedHelp && rest.length > 1 ? usageFor([command, rest[0]!]) : [];
  const usage = subcommand.length ? subcommand : usageFor(topic);
  if (!usage.length)
    throw new CliError("Unknown help topic. Run rebut --help.");
  if (topic[0] === "update") {
    if (!namedHelp) options(rest.slice(0, -1), {});
    return (
      usage.join("\n") +
      "\nStop Rebut MCP hosts before updating. After a successful update, supported Codex and Claude Code registrations are migrated to npx when Node and npx are available on PATH. Restart the hosts afterward. For direct re-registration, run rebut setup --client codex --replace or rebut setup --client claude --replace.\n"
    );
  }
  return usage.join("\n") + "\n";
}

function hostOptions(args: string[], command: "setup" | "remove") {
  const parsed = options(args, {
    client: { type: "string" },
    "codex-home": { type: "string" },
    "claude-config": { type: "string" },
    replace: { type: "boolean" },
    ...(command === "setup" ? { check: { type: "boolean" } } : {}),
  });
  const client = selectedClient(parsed.values.client);
  if (!client) throw new CliError("Specify --client codex or claude.");
  if (
    (client === "claude" && parsed.values["codex-home"]) ||
    (client === "codex" && parsed.values["claude-config"])
  )
    throw new CliError("Use only the selected host configuration option.");
  if (parsed.values.check && parsed.values.replace)
    throw new CliError("Choose --check or --replace.");
  return {
    client,
    check: parsed.values.check === true,
    registrationOptions: {
      codexHome: parsed.values["codex-home"] as string | undefined,
      claudeConfig: parsed.values["claude-config"] as string | undefined,
      replace: parsed.values.replace as boolean | undefined,
      entrypoint: realpathSync(
        process.argv[1] ||
          fileURLToPath(new URL("../bin/rebut.mjs", import.meta.url)),
      ),
    },
  };
}
async function stdin(max = 160000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > max) throw new CliError("Input exceeds size limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function hidden(label = "Bearer token"): Promise<string> {
  if (!process.stdin.isTTY)
    throw new CliError(
      "Credential input requires a terminal, or explicit --stdin.",
    );
  process.stderr.write(label + " (hidden): ");
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (ok: boolean) => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stderr.write("\n");
      ok ? resolve(value) : reject(new CliError("Token entry canceled."));
    };
    const onData = (data: Buffer) => {
      for (const char of data.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          finish(true);
          return;
        }
        if (char === "\u0003") {
          finish(false);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
        if (value.length > 512) {
          finish(false);
          return;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}
async function packageVersion(): Promise<string> {
  return JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
}
export async function runCli(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  const help = commandHelp(command, rest);
  if (help !== undefined) {
    process.stdout.write(help);
    return;
  }
  const host =
    command === "setup" || command === "remove"
      ? hostOptions(rest, command)
      : undefined;
  if (host?.check) {
    const registration =
      host.client === "codex"
        ? await checkCodexSetup(host.registrationOptions)
        : await checkClaudeSetup(host.registrationOptions);
    output({
      client: host.client,
      scope: "host_config_snapshot",
      ...registration,
    });
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write((await packageVersion()) + "\n");
    return;
  }
  if (command === "update") {
    options(rest, {});
    const { previousVersion, version, latestVersion } = updateGlobalInstallation(
      fileURLToPath(import.meta.url),
    );
    process.stdout.write(
      version === previousVersion
        ? `Rebut ${version} is already up to date.\n`
        : `Updated Rebut from ${previousVersion} to ${version}. Restart your MCP hosts.\n`,
    );
    if (version === latestVersion) await migrateUpdatedRegistrations();
    return;
  }
  const settings = await readSettings();
  const mode = executionMode(settings);
  async function withLocal<T>(
    action: (runtime: LocalRuntime) => Promise<T>,
    handleSignals = false,
  ): Promise<T> {
    const runtime = await openLocalRuntime(settings);
    const onInterrupt = () => {
      process.exitCode = 130;
      void runtime.close();
    };
    const onTerminate = () => {
      process.exitCode = 143;
      void runtime.close();
    };
    if (handleSignals) {
      process.once("SIGINT", onInterrupt);
      process.once("SIGTERM", onTerminate);
    }
    try {
      return await action(runtime);
    } finally {
      if (handleSignals) {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
      }
      await runtime.close();
    }
  }
  if (command === "set") {
    const [key, ...values] = rest;
    if (key === "token" || key === "admin-token" || key === "api-key") {
      const parsed = options(values, { stdin: { type: "boolean" } });
      const token = (
        parsed.values.stdin
          ? await stdin(1024)
          : await hidden(
              key === "api-key"
                ? `${settings.provider === "anthropic" ? "Anthropic" : "OpenAI"} API key`
                : "Bearer token",
            )
      ).trim();
      await storeToken(
        token,
        settings,
        key === "api-key"
          ? "provider"
          : key === "admin-token"
            ? "admin"
            : "review",
      );
      process.stdout.write(
        (key === "api-key" ? "API key" : "Token") +
          " saved and verified in macOS login Keychain.\n",
      );
      return;
    }
    if (key === "profile") {
      const parsed = options(
        values,
        {
          client: { type: "string" },
          clear: { type: "boolean" },
        },
        true,
      );
      const client = selectedClient(parsed.values.client);
      const [value] = parsed.positionals;
      if (parsed.values.clear) {
        if (!client || parsed.positionals.length)
          throw new CliError(
            "Use rebut set profile --client codex|claude --clear.",
          );
        if (settings.clientProfiles) {
          delete settings.clientProfiles[client];
          if (!settings.clientProfiles.codex && !settings.clientProfiles.claude)
            delete settings.clientProfiles;
        }
      } else {
        if (
          parsed.positionals.length !== 1 ||
          !value ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value)
        )
          throw new CliError("Expected one valid profile ID.");
        if (client)
          settings.clientProfiles = {
            ...settings.clientProfiles,
            [client]: value,
          };
        else {
          settings.defaultProfile = value;
          delete settings.defaultModel;
          delete settings.defaultReasoning;
        }
      }
      await writeSettings(settings);
      process.stdout.write(
        "Profile preference saved. Restart the MCP host. Re-register existing hosts to enable client selection or refresh forwarded API key environment variables.\n",
      );
      return;
    }
    if (values.length !== 1)
      throw new CliError(
        "Expected one configuration value. Tokens must use hidden input.",
      );
    const value = values[0]!;
    if (key === "provider") {
      if (value !== "openai" && value !== "anthropic")
        throw new CliError("Expected provider openai or anthropic.");
      if ((settings.provider ?? "openai") !== value) {
        settings.provider = value;
        settings.defaultProfile =
          value === "anthropic" ? "claude-medium" : "astra-medium";
        delete settings.defaultModel;
        delete settings.defaultReasoning;
      }
    } else if (key === "mode") {
      if (value !== "local" && value !== "worker")
        throw new CliError("Expected mode local or worker.");
      settings.mode = value;
    } else if (key === "api-key-env") {
      if (settings.provider === "anthropic") {
        if (value !== "REBUT_ANTHROPIC_API_KEY")
          throw new CliError(
            "Anthropic uses REBUT_ANTHROPIC_API_KEY only; do not change Claude Code authentication with shared ANTHROPIC_API_KEY.",
          );
      } else {
        if (value !== "REBUT_OPENAI_API_KEY" && value !== "OPENAI_API_KEY")
          throw new CliError(
            "Expected REBUT_OPENAI_API_KEY or OPENAI_API_KEY.",
          );
        settings.apiKeyEnv = value;
      }
    } else if (key === "max-concurrent") {
      if (mode !== "local")
        throw new CliError("Concurrency commands configure local mode only.");
      if (
        !/^[0-9]+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1 ||
        Number(value) > 10
      )
        throw new CliError(
          "Local concurrency must be an integer from 1 to 10.",
        );
      settings.localLimits = {
        ...(await localConfig(settings)).limits,
        maxConcurrent: Number(value),
      };
    } else if (
      ["daily-budget", "monthly-budget", "request-budget"].includes(key!)
    ) {
      if (mode !== "local")
        throw new CliError(
          "Budget commands configure local mode only; Worker limits are managed separately.",
        );
      const config = await localConfig(settings);
      const field =
        key === "daily-budget"
          ? "dailyMicrousd"
          : key === "monthly-budget"
            ? "monthlyMicrousd"
            : "requestMicrousd";
      settings.localLimits = { ...config.limits, [field]: price(value) };
    } else if (key === "endpoint") {
      try {
        validateEndpoint(value);
      } catch {
        throw new CliError(
          "Use an HTTPS endpoint without credentials, query or fragment (HTTP loopback is allowed).",
        );
      }
      settings.endpoint = value;
      delete settings.mode;
    } else if (key === "secret-store") {
      if (!["keychain", "vaultwarden", "env"].includes(value))
        throw new CliError("Unknown secret store.");
      settings.secretStore = value as typeof settings.secretStore;
    } else if (key === "vaultwarden-api-key-item")
      if (settings.provider === "anthropic")
        settings.vaultwardenAnthropicApiKeyItem = value;
      else settings.vaultwardenApiKeyItem = value;
    else if (key === "vaultwarden-item") settings.vaultwardenItem = value;
    else if (key === "vaultwarden-admin-item")
      settings.vaultwardenAdminItem = value;
    else if (key === "model") {
      if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(value))
        throw new CliError("Invalid model ID.");
      settings.defaultModel = value;
      delete settings.defaultProfile;
    } else if (key === "reasoning") {
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(value))
        throw new CliError("Invalid reasoning effort.");
      settings.defaultReasoning = value;
      delete settings.defaultProfile;
    } else throw new CliError("Unknown configuration key.");
    await writeSettings(settings);
    process.stdout.write(
      "Configuration saved. Re-register MCP hosts after provider, mode, or credential changes: rebut setup --client codex --replace or rebut setup --client claude --replace. Restart each host afterward. Switching providers selects its default profile and clears model/reasoning overrides.\n",
    );
    return;
  }
  if (host) {
    const { client, registrationOptions } = host;
    if (command === "setup" && mode === "worker" && !settings.endpoint)
      throw new CliError("Set the Worker endpoint first.");
    let keyProvider = settings.provider ?? "openai";
    let forwardApiKeyEnv = mode === "local" && settings.secretStore === "env";
    if (command === "setup" && forwardApiKeyEnv) {
      try {
        keyProvider = (await preferred(undefined, client)).provider;
      } catch {
        if (settings.clientProfiles?.[client]) {
          forwardApiKeyEnv = false;
          process.stderr.write(
            "Client default could not be resolved. No provider key variable was added to the registration.\n",
          );
        }
      }
    }
    const value = {
      ...registrationOptions,
      forwardTokenEnv: mode === "worker" && settings.secretStore === "env",
      forwardApiKeyEnv,
      apiKeyEnv: providerEnvName(settings, keyProvider),
      configDir: process.env.REBUT_CONFIG_DIR,
    };
    output(
      await (client === "claude"
        ? command === "setup"
          ? setupClaude(value)
          : removeClaude(value)
        : command === "setup"
          ? setupCodex(value)
          : removeCodex(value)),
    );
    return;
  }
  if (command === "collect") {
    const p = options(
      rest,
      {
        root: { type: "string" },
        "request-id": { type: "string" },
        requirements: { type: "string" },
        profile: { type: "string" },
        client: { type: "string" },
        "output-schema": { type: "string" },
        "criterion-id": { type: "string", multiple: true },
      },
      true,
    );
    if (
      !p.values.root ||
      !p.values["request-id"] ||
      !p.values.requirements ||
      !p.positionals.length
    )
      throw new CliError(
        "Collect requires root, request-id, requirements and explicit source files.",
      );
    const outputVersion = p.values["output-schema"];
    const criterionIds = p.values["criterion-id"];
    if (
      outputVersion !== undefined &&
      outputVersion !== "1" &&
      outputVersion !== "2"
    )
      throw new CliError("Use --output-schema 1 or 2.");
    if (outputVersion === "1" && criterionIds !== undefined)
      throw new CliError("Remove --criterion-id when selecting --output-schema 1.");
    const resultFormat =
      outputVersion === "2" || criterionIds !== undefined
        ? ReviewResultFormatSchema.safeParse({
            version: 2,
            criterion_ids: criterionIds,
          })
        : undefined;
    if (resultFormat && !resultFormat.success)
      throw new CliError("Use 1 to 12 --criterion-id ID options for output schema 2 (IDs of up to 40 characters).");
    // Resolve the current profile metadata while collecting, then freeze its supplier.
    const client = selectedClient(p.values.client);
    if (
      !client &&
      p.values.profile === undefined &&
      (settings.clientProfiles?.codex || settings.clientProfiles?.claude)
    ) {
      process.stderr.write(
        "No client selected. This bundle uses the shared review preference. Pass --client codex or --client claude to use a client default.\n",
      );
    }
    const chosen = await preferred(
      p.values.profile as string | undefined,
      client,
    );
    output(
      await collect(
        p.values.root as string,
        p.positionals,
        p.values.requirements as string,
        p.values["request-id"] as string,
        chosen.id,
        chosen.provider,
        resultFormat?.data,
      ),
    );
    return;
  }
  async function preferred(explicitProfile?: string, client?: McpClient) {
    const selectedProfile =
      explicitProfile ?? (client && settings.clientProfiles?.[client]);
    if (mode === "worker" && !settings.endpoint)
      throw new CliError(
        "Set the Worker endpoint before selecting server models.",
      );
    const records =
      mode === "local"
        ? await withLocal((runtime) => runtime.profiles.list())
        : await listProfiles({
            endpoint: settings.endpoint!,
            loadToken: () => loadToken(settings),
          });
    const model =
      settings.defaultModel ??
      records.find(
        (r) =>
          r.id ===
            (settings.provider === "anthropic"
              ? "claude-medium"
              : "astra-medium") && r.enabled,
      )?.profile?.model;
    const id = resolveProfile(
      records,
      selectedProfile !== undefined
        ? { profile: selectedProfile }
        : {
            provider: settings.provider,
            profile: settings.defaultProfile,
            model:
              settings.defaultModel || settings.defaultReasoning
                ? model
                : undefined,
            reasoning: settings.defaultReasoning,
          },
    );
    const selected = records.find((r) => r.id === id)!;
    return {
      id,
      provider: profileProvider(selected.profile!),
      model: selected.profile!.model,
      reasoning: selected.profile!.reasoning,
      revision: selected.revision,
    };
  }
  if (command === "budget") {
    let day: number | undefined;
    if (rest.length > 0) {
      if (
        rest.length !== 2 ||
        rest[0] !== "set-start-day" ||
        !/^[0-9]{1,2}$/.test(rest[1]!)
      )
        throw new CliError(
          "Use rebut budget or rebut budget set-start-day DAY.",
        );
      day = Number(rest[1]);
      if (!validMonthlyStartDay(day))
        throw new CliError("Expected a monthly start day from 1 to 28.");
    }
    if (mode === "local") {
      if (day === undefined)
        output(await withLocal((runtime) => runtime.budget()));
      else {
        const result = await withLocal((runtime) =>
          runtime.scheduleMonthlyCycle(day!),
        );
        if (result.status === "conflict")
          throw new CliError(
            "Budget schedule already set or the calendar boundary changed; run rebut budget.",
          );
        output(result);
      }
    } else {
      if (!settings.endpoint)
        throw new CliError("Set the Worker endpoint first.");
      output(
        await workerBudget(
          {
            endpoint: settings.endpoint,
            loadToken: () => loadToken(settings, "admin"),
          },
          day,
        ),
      );
    }
    return;
  }
  if (command === "profile") {
    if (mode === "local") {
      output(
        await withLocal((runtime) =>
          profileCommand(rest, { registry: runtime.profiles }),
        ),
      );
      return;
    }
    if (!settings.endpoint)
      throw new CliError("Set the Worker endpoint first.");
    output(
      await profileCommand(rest, {
        endpoint: settings.endpoint,
        loadReviewToken: () => loadToken(settings),
        loadAdminToken: () => loadToken(settings, "admin"),
      }),
    );
    return;
  }
  if (command === "doctor") {
    const p = options(rest, {
      connect: { type: "boolean" },
      provider: { type: "boolean" },
      client: { type: "string" },
    });
    const client = selectedClient(p.values.client);
    const clientProfile = client && settings.clientProfiles?.[client];
    if (p.values.provider && mode !== "local")
      throw new CliError(
        "Provider metadata diagnostics are local mode only; Worker credentials stay on the Worker.",
      );
    let chosen: Awaited<ReturnType<typeof preferred>> | undefined;
    if (
      (mode === "local" || client !== undefined) &&
      (p.values.connect || p.values.provider)
    ) {
      try {
        chosen = await preferred(undefined, client);
      } catch {
        /* report unavailable preferences without losing metadata diagnostics */
      }
    }
    const activeProvider =
      chosen?.provider ??
      (clientProfile ? undefined : (settings.provider ?? "openai"));
    let credentialAvailable: boolean | undefined;
    let providerKey: string | undefined;
    if (mode === "worker" || activeProvider) {
      credentialAvailable = false;
      try {
        providerKey = await loadToken(
          settings,
          mode === "local" ? "provider" : "review",
          activeProvider,
        );
        credentialAvailable = true;
      } catch {}
    }
    const report: any = {
      configPath: settingsPath(),
      mode,
      provider: activeProvider,
      ...(mode === "local" || client !== undefined
        ? {
            profileResolution: !(p.values.connect || p.values.provider)
              ? "not_checked"
              : chosen
                ? "resolved"
                : "unavailable",
          }
        : {}),
      keyConfigurationProvider: settings.provider ?? "openai",
      ...(mode === "local" && settings.secretStore === "env" && activeProvider
        ? { apiKeyEnv: providerEnvName(settings, activeProvider) }
        : {}),
      ...(mode === "local"
        ? {
            ledgerPath: join(resolve(localDirectory()), "ledger.sqlite"),
            budgetScope: "this local data directory only",
          }
        : {}),
      endpointConfigured: !!settings.endpoint,
      secretStore: settings.secretStore,
      credentialAvailable,
      ...(client ? { client } : {}),
      defaultModel: clientProfile ? undefined : settings.defaultModel,
      defaultReasoning: clientProfile ? undefined : settings.defaultReasoning,
      defaultProfile: clientProfile ?? settings.defaultProfile,
      clientProfiles: settings.clientProfiles,
    };
    if (p.values.provider) {
      chosen ??= await preferred(undefined, client);
      report.providerDiagnostic = providerKey
        ? await providerDiagnostic(chosen, providerKey)
        : {
            provider: chosen.provider,
            model: chosen.model,
            status: "credential_unavailable",
          };
      report.providerDiagnosticScope =
        "Metadata reachability only; not generation permission, credits, rate limits, geo, structured-output support, or quality.";
    }
    if (p.values.connect) {
      if (mode === "local" && clientProfile && !chosen)
        throw new CliError("The configured client profile is unavailable.");
      if ((mode === "worker" && !settings.endpoint) || !credentialAvailable)
        throw new CliError(
          "Endpoint or credentials unavailable. Check your selected secret store.",
        );
      if (mode === "local") {
        const version = await packageVersion();
        report.localTools = await withLocal(async (runtime) => {
          const server = await localMcpServer(runtime, settings, client);
          const { Client } = await import("@modelcontextprotocol/client");
          const { InMemoryTransport } =
            await import("@modelcontextprotocol/server");
          const [host, local] = InMemoryTransport.createLinkedPair();
          const mcpClient = new Client({
            name: "rebut-local-doctor",
            version,
          });
          try {
            await Promise.all([mcpClient.connect(host), server.connect(local)]);
            return (await mcpClient.listTools()).tools.map((t) => t.name);
          } finally {
            await mcpClient.close();
            await server.close();
          }
        });
        output(report);
        return;
      }
      const mcpClient = await connectRemote({
        endpoint: settings.endpoint!,
        loadToken: () => loadToken(settings),
      });
      try {
        report.remoteTools = (await mcpClient.listTools()).tools.map(
          (t) => t.name,
        );
      } finally {
        await mcpClient.close();
      }
    }
    output(report);
    return;
  }
  if (mode === "worker" && !settings.endpoint)
    throw new CliError("Set the Worker endpoint first.");
  const remote = {
    endpoint: settings.endpoint!,
    loadToken: () => loadToken(settings),
  };
  if (command === "mcp") {
    const parsed = options(rest, { client: { type: "string" } });
    const client = selectedClient(parsed.values.client);
    const clientProfile = client && settings.clientProfiles?.[client];
    if (mode === "local") {
      await serveLocalStdio(settings, client);
      return;
    }
    let preferredProfile;
    let reviewUnavailable = false;
    let clientProfileUnavailable = false;
    if (
      settings.defaultModel ||
      settings.defaultReasoning ||
      settings.defaultProfile ||
      clientProfile
    ) {
      try {
        preferredProfile = await preferred(undefined, client);
      } catch {
        clientProfileUnavailable = clientProfile !== undefined;
        reviewUnavailable = !clientProfileUnavailable;
      }
    }
    await serveStdio({
      ...remote,
      client,
      preferredProfile,
      reviewUnavailable,
      clientProfileUnavailable,
    });
    return;
  }
  if (command === "status" && rest.length === 1 && rest[0] === "--pending") {
    if (mode === "local") {
      output({
        backend: "local",
        ...(await withLocal((runtime) => runtime.pending())),
      });
      return;
    }
    const client = await connectRemote(remote);
    try {
      const result = await client.callTool({ name: "review_pending", arguments: {} });
      const payload = toolPayload(result);
      if (!Array.isArray(payload?.requests) || typeof payload.has_more !== "boolean")
        throw new Error("Invalid pending request response");
      output({ backend: "worker", requests: payload.requests, has_more: payload.has_more });
    } catch {
      throw new CliError("Worker pending status unavailable. Check Worker support or query rebut status REQUEST_ID.");
    } finally {
      await client.close();
    }
    return;
  }
  if (command === "status" || command === "review") {
    let tool: string, input: Record<string, unknown>;
    let strictBundle: ReviewInput | undefined;
    if (command === "status") {
      if (
        rest.length !== 1 ||
        !rest[0] ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(rest[0])
      )
        throw new CliError("Status requires one valid request ID.");
      tool = "review_status";
      input = { request_id: rest[0] };
    } else {
      const flags = options(rest, { "strict-exit": { type: "boolean" } });
      tool = "review";
      try {
        const bundle = ReviewInputSchema.parse(JSON.parse(await stdin()));
        input = bundle;
        if (flags.values["strict-exit"]) strictBundle = bundle;
      } catch {
        throw new CliError(
          "Invalid review bundle. Check schema, limits and supplied evidence.",
        );
      }
    }
    if (mode === "local") {
      const value = await withLocal(
        (runtime) =>
          command === "status"
            ? runtime.status(input.request_id as string)
            : runtime.review(input),
        command === "review",
      );
      outputToolResult({
        content: [
          {
            type: "text",
            text: JSON.stringify({ backend: "local", ...value }),
          },
        ],
      }, strictBundle);
      return;
    }
    const client = await connectRemote(remote);
    try {
      outputToolResult(await client.callTool({ name: tool, arguments: input }), strictBundle);
    } finally {
      await client.close();
    }
    return;
  }
  throw new CliError("Unknown command. Run rebut --help.");
}
export function safeError(error: unknown): string {
  if (error instanceof CliError || error instanceof UpdateError)
    return error.message;
  if (
    error instanceof CodexSetupError ||
    error instanceof ClaudeSetupError ||
    error instanceof NpxLauncherError
  )
    return error.message;
  const profileError = safeProfileError(error);
  if (profileError) return profileError;
  const code = error instanceof Error ? error.message : "";
  const known: Record<string, string> = {
    LOCAL_STORAGE_UNSAFE:
      "Local ledger path must be private, owned by you, and free of links.",
    LOCAL_SCHEMA_UNSUPPORTED:
      "Local ledger schema is newer than this CLI; preserve it and update the CLI.",
    LOCAL_RUNTIME_CLOSED:
      "Local review runtime has closed; query the original request ID.",
    LOCAL_REVIEW_ABORTED:
      "Local review cancelled before execution; query the original request ID.",
    PROVIDER_KEY_UNAVAILABLE:
      "Configure the selected profile provider key for local mode.",
    INVALID_REVIEW_RESULT_FORMAT:
      "Each --criterion-id must appear once at the start of a nonempty ID: text line in the requirements.",
    SETTINGS_INVALID: "Invalid local settings file.",
    SETTINGS_UNSAFE:
      process.platform === "win32"
        ? "Windows local mode requires a private REBUT_CONFIG_DIR without config.json. Set the provider API key in the environment (REBUT_OPENAI_API_KEY for OpenAI). Commands that write Rebut settings are unavailable on Windows."
        : "Local settings path is unsafe. Use a user-owned config.json with mode 0600 in a directory you own, and check the parent directory permissions.",
    TOKEN_INVALID: "Credential must contain 32–512 non-space ASCII characters.",
    KEYCHAIN_UNSUPPORTED:
      "Keychain backend requires macOS. Select an explicit supported secret store.",
    KEYCHAIN_UNAVAILABLE:
      "Login Keychain unavailable. Authorize it locally or explicitly select the existing Vaultwarden backend.",
    KEYCHAIN_READBACK_FAILED: "Keychain readback verification failed.",
    TOKEN_STORAGE_REQUIRES_KEYCHAIN:
      "Hidden credential storage requires macOS Keychain; configure env or Vaultwarden credentials externally.",
    VAULTWARDEN_UNAVAILABLE:
      "Vaultwarden CLI session unavailable. Restore your existing bw-get session locally.",
  };
  return (
    known[code] ||
    (code === REMOTE_FAILURE_MESSAGE
      ? REMOTE_FAILURE_MESSAGE
      : "Command failed. Check configuration and input. If a review was submitted, query its original request_id before retrying.")
  );
}
