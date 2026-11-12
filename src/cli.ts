import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  readSettings,
  writeSettings,
  settingsPath,
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
const HELP = `Rebut: opt-in independent review MCP client

rebut set endpoint URL
rebut set secret-store keychain|vaultwarden|env
rebut set vaultwarden-item NAME
rebut set token [--stdin]        Hidden input; never pass a token as an argument
rebut setup --client codex [--codex-home PATH] [--replace]
rebut remove --client codex [--codex-home PATH]
rebut mcp                       Start the stdio bridge
rebut doctor [--connect]         Local check; --connect lists remote tools only
rebut status REQUEST_ID          Free metadata query
rebut review                    Explicit paid review; JSON bundle on stdin
rebut collect --root PATH --request-id ID --requirements TEXT [--profile ID] -- FILE...
rebut --version

Deploy your own Worker from the GitHub source first. No private endpoint is bundled.
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
async function hidden(): Promise<string> {
  if (!process.stdin.isTTY)
    throw new CliError("Token input requires a terminal, or explicit --stdin.");
  process.stderr.write("Bearer token (hidden): ");
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
  if (command === "set") {
    const [key, ...values] = rest;
    if (key === "token") {
      const parsed = options(values, { stdin: { type: "boolean" } });
      const token = (
        parsed.values.stdin ? await stdin(1024) : await hidden()
      ).trim();
      await storeToken(token, settings);
      process.stdout.write(
        "Token saved and verified in macOS login Keychain.\n",
      );
      return;
    }
    if (values.length !== 1)
      throw new CliError(
        "Expected one configuration value. Tokens must use hidden input.",
      );
    const value = values[0]!;
    if (key === "endpoint") {
      try {
        validateEndpoint(value);
      } catch {
        throw new CliError(
          "Use an HTTPS endpoint without credentials, query or fragment (HTTP loopback is allowed).",
        );
      }
      settings.endpoint = value;
    } else if (key === "secret-store") {
      if (!["keychain", "vaultwarden", "env"].includes(value))
        throw new CliError("Unknown secret store.");
      settings.secretStore = value as typeof settings.secretStore;
    } else if (key === "vaultwarden-item") settings.vaultwardenItem = value;
    else throw new CliError("Unknown configuration key.");
    await writeSettings(settings);
    process.stdout.write("Configuration saved.\n");
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
    if (command === "setup" && !settings.endpoint)
      throw new CliError("Set the Worker endpoint first.");
    const entrypoint = realpathSync(
      process.argv[1] ||
        fileURLToPath(new URL("../bin/rebut.mjs", import.meta.url)),
    );
    const value = {
      codexHome: parsed.values["codex-home"] as string | undefined,
      entrypoint,
      replace: parsed.values.replace as boolean | undefined,
      forwardTokenEnv: settings.secretStore === "env",
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
    output(
      await collect(
        p.values.root as string,
        p.positionals,
        p.values.requirements as string,
        p.values["request-id"] as string,
        p.values.profile as string | undefined,
      ),
    );
    return;
  }
  if (command === "doctor") {
    const p = options(rest, { connect: { type: "boolean" } });
    let credentialAvailable = false;
    try {
      await loadToken(settings);
      credentialAvailable = true;
    } catch {}
    const report: any = {
      configPath: settingsPath(),
      endpointConfigured: !!settings.endpoint,
      secretStore: settings.secretStore,
      credentialAvailable,
    };
    if (p.values.connect) {
      if (!settings.endpoint || !credentialAvailable)
        throw new CliError(
          "Endpoint or credentials unavailable. Check your selected secret store.",
        );
      const client = await connectRemote({
        endpoint: settings.endpoint,
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
  if (!settings.endpoint) throw new CliError("Set the Worker endpoint first.");
  const remote = {
    endpoint: settings.endpoint,
    loadToken: () => loadToken(settings),
  };
  if (command === "mcp") {
    if (rest.length) throw new CliError("Unexpected mcp arguments.");
    await serveStdio(remote);
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
  const code = error instanceof Error ? error.message : "";
  const known: Record<string, string> = {
    SETTINGS_INVALID: "Invalid local settings file.",
    SETTINGS_UNSAFE: "Local settings path is unsafe.",
    TOKEN_INVALID:
      "Bearer token must contain 32–512 non-space ASCII characters.",
    KEYCHAIN_UNSUPPORTED:
      "Keychain backend requires macOS. Select an explicit supported secret store.",
    KEYCHAIN_UNAVAILABLE:
      "Login Keychain unavailable. Authorize it locally or explicitly select the existing Vaultwarden backend.",
    KEYCHAIN_READBACK_FAILED: "Keychain readback verification failed.",
    TOKEN_STORAGE_REQUIRES_KEYCHAIN:
      "This backend reads external credentials; set token stores only in macOS Keychain.",
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
