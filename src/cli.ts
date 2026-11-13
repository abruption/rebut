import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  readSettings,
  writeSettings,
  settingsPath,
  executionMode,
  providerEnvName,
} from "./client/settings.js";
import { loadToken, storeToken } from "./client/secrets.js";
import {
  connectRemote,
  validateEndpoint,
  REMOTE_FAILURE_MESSAGE,
} from "./client/connection.js";
import { serveStdio } from "./client/stdio.js";
import { setupCodex, removeCodex, CodexSetupError } from "./client/codex.js";
import { collect } from "./client/collector.js";
import { ReviewInputSchema } from "./contracts.js";
import {
  profileCommand,
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

rebut set mode local|worker
rebut set api-key-env REBUT_OPENAI_API_KEY|OPENAI_API_KEY
rebut set max-concurrent N      Local capacity, 1–10; uncertain reservations remain held
rebut set api-key [--stdin]      Hidden OpenAI API key input
rebut set endpoint URL          Select optional Worker mode
rebut set secret-store keychain|vaultwarden|env
rebut set vaultwarden-item NAME
rebut set vaultwarden-api-key-item NAME
rebut set daily-budget USD
rebut set monthly-budget USD
rebut set request-budget USD
rebut set vaultwarden-admin-item NAME
rebut set model MODEL
rebut set reasoning EFFORT
rebut set profile PROFILE_ID
rebut set admin-token [--stdin]
rebut profile list
rebut profile set ID --model MODEL --reasoning EFFORT --max-output-tokens N --input-usd-per-million USD --output-usd-per-million USD --price-version VERSION [--if-revision N]
rebut profile remove ID [--if-revision N]
rebut set token [--stdin]        Hidden input; never pass a token as an argument
rebut setup --client codex [--codex-home PATH] [--replace]
rebut remove --client codex [--codex-home PATH]
rebut mcp                       Start the local server or Worker bridge
rebut doctor [--connect]         Check selected backend; --connect lists tools, never calls a model
rebut status --pending           Local reserved/unknown metadata only
rebut status REQUEST_ID          Free metadata query
rebut review                    Explicit paid review; JSON bundle on stdin
rebut collect --root PATH --request-id ID --requirements TEXT [--profile ID] -- FILE...
rebut --version

New installs run locally with your OpenAI API key. No Cloudflare account is required.
Worker mode is optional; no private endpoint is bundled. Local budgets are per device.
Production profile: astra-medium. Real API tests: luna-test only.
`;
class CliError extends Error {}
function output(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
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
export async function runCli(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(
      JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
      ).version + "\n",
    );
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
          : await hidden(key === "api-key" ? "OpenAI API key" : "Bearer token")
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
    if (values.length !== 1)
      throw new CliError(
        "Expected one configuration value. Tokens must use hidden input.",
      );
    const value = values[0]!;
    if (key === "mode") {
      if (value !== "local" && value !== "worker")
        throw new CliError("Expected mode local or worker.");
      settings.mode = value;
    } else if (key === "api-key-env") {
      if (value !== "REBUT_OPENAI_API_KEY" && value !== "OPENAI_API_KEY")
        throw new CliError("Expected REBUT_OPENAI_API_KEY or OPENAI_API_KEY.");
      settings.apiKeyEnv = value;
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
      settings.vaultwardenApiKeyItem = value;
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
    } else if (key === "profile") {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value))
        throw new CliError("Invalid profile ID.");
      settings.defaultProfile = value;
      delete settings.defaultModel;
      delete settings.defaultReasoning;
    } else throw new CliError("Unknown configuration key.");
    await writeSettings(settings);
    process.stdout.write(
      "Configuration saved. Re-run rebut setup --client codex --replace when changing mode or credential settings, then restart MCP hosts.\n",
    );
    return;
  }
  if (command === "setup" || command === "remove") {
    const parsed = options(rest, {
      client: { type: "string" },
      "codex-home": { type: "string" },
      replace: { type: "boolean" },
    });
    if (parsed.values.client !== "codex")
      throw new CliError("Specify --client codex.");
    if (command === "setup" && mode === "worker" && !settings.endpoint)
      throw new CliError("Set the Worker endpoint first.");
    const entrypoint = realpathSync(
      process.argv[1] ||
        fileURLToPath(new URL("../bin/rebut.mjs", import.meta.url)),
    );
    const value = {
      codexHome: parsed.values["codex-home"] as string | undefined,
      entrypoint,
      replace: parsed.values.replace as boolean | undefined,
      forwardTokenEnv: mode === "worker" && settings.secretStore === "env",
      forwardApiKeyEnv: mode === "local" && settings.secretStore === "env",
      apiKeyEnv: providerEnvName(settings),
      configDir: process.env.REBUT_CONFIG_DIR,
    };
    output(
      await (command === "setup" ? setupCodex(value) : removeCodex(value)),
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
    let chosen = p.values.profile as string | undefined;
    if (
      !chosen &&
      (settings.defaultModel ||
        settings.defaultReasoning ||
        settings.defaultProfile)
    )
      chosen = (await preferred()).id;
    output(
      await collect(
        p.values.root as string,
        p.positionals,
        p.values.requirements as string,
        p.values["request-id"] as string,
        chosen,
      ),
    );
    return;
  }
  async function preferred() {
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
      records.find((r) => r.id === "astra-medium" && r.enabled)?.profile?.model;
    const id = resolveProfile(records, {
      profile: settings.defaultProfile,
      model:
        settings.defaultModel || settings.defaultReasoning ? model : undefined,
      reasoning: settings.defaultReasoning,
    });
    const selected = records.find((r) => r.id === id)!;
    return {
      id,
      model: selected.profile!.model,
      reasoning: selected.profile!.reasoning,
      revision: selected.revision,
    };
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
    const p = options(rest, { connect: { type: "boolean" } });
    let credentialAvailable = false;
    try {
      await loadToken(settings, mode === "local" ? "provider" : "review");
      credentialAvailable = true;
    } catch {}
    const report: any = {
      configPath: settingsPath(),
      mode,
      ...(mode === "local" && settings.secretStore === "env"
        ? { apiKeyEnv: providerEnvName(settings) }
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
      defaultModel: settings.defaultModel,
      defaultReasoning: settings.defaultReasoning,
      defaultProfile: settings.defaultProfile,
    };
    if (p.values.connect) {
      if ((mode === "worker" && !settings.endpoint) || !credentialAvailable)
        throw new CliError(
          "Endpoint or credentials unavailable. Check your selected secret store.",
        );
      if (mode === "local") {
        report.localTools = await withLocal(async (runtime) => {
          const server = await localMcpServer(runtime, settings);
          const { Client } = await import("@modelcontextprotocol/client");
          const { InMemoryTransport } =
            await import("@modelcontextprotocol/server");
          const [host, local] = InMemoryTransport.createLinkedPair();
          const client = new Client({
            name: "rebut-local-doctor",
            version: "0.2.0",
          });
          try {
            await Promise.all([client.connect(host), server.connect(local)]);
            return (await client.listTools()).tools.map((t) => t.name);
          } finally {
            await client.close();
            await server.close();
          }
        });
        output(report);
        return;
      }
      const client = await connectRemote({
        endpoint: settings.endpoint!,
        loadToken: () => loadToken(settings),
      });
      try {
        report.remoteTools = (await client.listTools()).tools.map(
          (t) => t.name,
        );
      } finally {
        await client.close();
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
    if (rest.length) throw new CliError("Unexpected mcp arguments.");
    if (mode === "local") {
      await serveLocalStdio(settings);
      return;
    }
    let preferredProfile;
    let reviewUnavailable = false;
    if (
      settings.defaultModel ||
      settings.defaultReasoning ||
      settings.defaultProfile
    ) {
      try {
        preferredProfile = await preferred();
      } catch {
        reviewUnavailable = true;
      }
    }
    await serveStdio({ ...remote, preferredProfile, reviewUnavailable });
    return;
  }
  if (command === "status" && rest.length === 1 && rest[0] === "--pending") {
    if (mode !== "local")
      throw new CliError("Pending request listing is local mode only.");
    output({
      backend: "local",
      ...(await withLocal((runtime) => runtime.pending())),
    });
    return;
  }
  if (command === "status" || command === "review") {
    let tool: string, input: Record<string, unknown>;
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
      if (rest.length)
        throw new CliError("Review accepts the JSON bundle on stdin only.");
      tool = "review";
      try {
        input = ReviewInputSchema.parse(JSON.parse(await stdin()));
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
      output({
        content: [
          {
            type: "text",
            text: JSON.stringify({ backend: "local", ...value }),
          },
        ],
      });
      return;
    }
    const client = await connectRemote(remote);
    try {
      output(await client.callTool({ name: tool, arguments: input }));
    } finally {
      await client.close();
    }
    return;
  }
  throw new CliError("Unknown command. Run rebut --help.");
}
export function safeError(error: unknown): string {
  if (error instanceof CliError) return error.message;
  if (error instanceof CodexSetupError) return error.message;
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
    PROVIDER_KEY_UNAVAILABLE: "Configure an OpenAI API key for local mode.",
    SETTINGS_INVALID: "Invalid local settings file.",
    SETTINGS_UNSAFE: "Local settings path is unsafe.",
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
