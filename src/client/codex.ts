import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { parse, stringify } from "smol-toml";
import { LOCAL_BUDGET_ENV } from "../config.js";
import { CODEX_TOOL_TIMEOUT_SECONDS } from "../timeouts.js";
import { inspectLauncher } from "./setup-check.js";
import {
  checkNpxPath,
  fullyQualifiedPath,
  isNpmLauncher,
  matchesNpxLauncher,
  NpxLauncherError,
  npxLauncherArgs,
  npxProjectStatus,
  prepareNpxWorkingDirectory,
} from "./npx-launcher.js";

export interface CodexSetupOptions {
  codexHome?: string;
  entrypoint: string;
  nodePath?: string;
  replace?: boolean;
  forwardTokenEnv?: boolean;
  forwardApiKeyEnv?: boolean;
  forwardLocalBudgetEnv?: boolean;
  apiKeyEnv?:
    "REBUT_OPENAI_API_KEY" | "OPENAI_API_KEY" | "REBUT_ANTHROPIC_API_KEY";
  configDir?: string;
}

export class CodexSetupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodexSetupError";
  }
}

type Table = Record<string, unknown>;
const STARTUP_TIMEOUT_SECONDS = 60;
function table(value: unknown): value is Table {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}
function equivalent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, i) => equivalent(value, b[i]))
    );
  if (table(a) && table(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && equivalent(a[key], b[key]))
    );
  }
  return false;
}
function desired(options: CodexSetupOptions): Table {
  const envVars: string[] = [];
  if (options.forwardApiKeyEnv)
    envVars.push(options.apiKeyEnv ?? "REBUT_OPENAI_API_KEY");
  else if (options.forwardTokenEnv) envVars.push("REBUT_TOKEN");
  if (options.forwardLocalBudgetEnv) envVars.push(LOCAL_BUDGET_ENV);
  return {
    command: options.nodePath ?? process.execPath,
    args: [resolve(options.entrypoint), "mcp", "--client", "codex"],
    startup_timeout_sec: STARTUP_TIMEOUT_SECONDS,
    tool_timeout_sec: CODEX_TOOL_TIMEOUT_SECONDS,
    enabled_tools: ["review", "review_status", "review_pair"],
    ...(envVars.length > 0 ? { env_vars: envVars } : {}),
    ...(options.configDir !== undefined
      ? { env: { REBUT_CONFIG_DIR: resolve(options.configDir) } }
      : {}),
  };
}

function npxWorkingDirectory(configPath: string) {
  return join(dirname(configPath), "rebut-npx");
}

function isManagedNpx(entry: unknown, cwd: string) {
  return table(entry) && entry.cwd === cwd &&
    matchesNpxLauncher(entry, npxLauncherArgs("codex", cwd));
}

function usesWorkingDirectory(entry: Table) {
  const env = table(entry.env) ? entry.env : {};
  const configDir = env.REBUT_CONFIG_DIR;
  const bwGet = env.REBUT_BW_GET;
  return (
    (typeof configDir === "string" &&
      configDir !== "" &&
      !fullyQualifiedPath(configDir)) ||
    (typeof bwGet === "string" &&
      /[\\/]|^[A-Za-z]:/.test(bwGet) &&
      !fullyQualifiedPath(bwGet)) ||
    (Array.isArray(entry.env_vars) &&
      (entry.env_vars.includes("REBUT_CONFIG_DIR") ||
        entry.env_vars.includes("REBUT_BW_GET")))
  );
}

function localEnvVars(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const budgetIndex = value.indexOf(LOCAL_BUDGET_ENV);
  const names = budgetIndex === -1
    ? value
    : value.filter((_, index) => index !== budgetIndex);
  return (
    names.length === 0 ||
    (names.length === 1 &&
      (names[0] === "REBUT_OPENAI_API_KEY" ||
        names[0] === "OPENAI_API_KEY" ||
        names[0] === "REBUT_ANTHROPIC_API_KEY"))
  );
}

function matchesRemoval(existing: unknown, desired: Table, entrypoint: string) {
  if (!table(existing)) return false;
  const { env_vars: existingVars, ...registered } = existing;
  const { env_vars: desiredVars, ...expected } = desired;
  // Accept earlier local forwarding settings. Worker tokens, unknown names,
  // and the literal env table still need to match.
  if (
    !equivalent(existingVars, desiredVars) &&
    !(localEnvVars(existingVars) && localEnvVars(desiredVars))
  )
    return false;
  return (
    equivalent(registered, expected) ||
    equivalent(registered, { ...expected, args: [resolve(entrypoint), "mcp"] })
  );
}

// Recognize table headers only outside TOML strings, including multiline strings.
// Parsing each candidate lets the TOML parser handle quoted and dotted table keys.
function headers(source: string): { start: number; path: string[] }[] {
  const result: { start: number; path: string[] }[] = [];
  let quote = "",
    triple = false,
    lineStart = true;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (quote === '"' && c === "\\") {
        i++;
        continue;
      }
      if (triple ? source.slice(i, i + 3) === quote.repeat(3) : c === quote) {
        if (triple) i += 2;
        quote = "";
        triple = false;
      }
      if (c === "\n") lineStart = true;
      continue;
    }
    if (c === "\n") {
      lineStart = true;
      continue;
    }
    if (lineStart && (c === " " || c === "\t" || c === "\r")) continue;
    if (lineStart && c === "[") {
      const end = source.indexOf("\n", i);
      const line = source.slice(i, end < 0 ? source.length : end);
      try {
        let value: unknown = parse(line + "\n");
        const path: string[] = [];
        while (table(value) && Object.keys(value).length === 1) {
          const key = Object.keys(value)[0];
          path.push(key);
          value = value[key];
        }
        if (path.length && (table(value) || Array.isArray(value)))
          result.push({ start: i, path });
      } catch {
        /* An array value can also begin with an opening bracket. */
      }
    }
    lineStart = false;
    if (c === "#") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end - 1;
    } else if (c === '"' || c === "'") {
      quote = c;
      triple = source.slice(i, i + 3) === c.repeat(3);
      if (triple) i += 2;
    }
  }
  return result;
}

function render(
  source: string,
  document: Table,
  replacement: Table | undefined,
): string {
  const sections = headers(source);
  const targets = sections.filter(
    (section) =>
      section.path[0] === "mcp_servers" && section.path[1] === "rebut",
  );
  let edited = source;
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];
    const index = sections.indexOf(target);
    edited =
      edited.slice(0, target.start) +
      edited.slice(sections[index + 1]?.start ?? source.length);
  }
  if (replacement) {
    edited += `${edited.length && !edited.endsWith("\n") ? "\n" : ""}\n${stringify({ mcp_servers: { rebut: replacement } })}`;
  }
  try {
    if (equivalent(parse(edited), document)) return edited;
  } catch {
    /* Inline or dotted assignments require rewriting their containing table. */
  }
  return stringify(document);
}

const CHECK_FILE_LIMIT = 8 * 1024 * 1024;

async function readConfig(
  path: string,
  check = false,
): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new CodexSetupError(
        "UNSAFE_CONFIG",
        "Codex config must be a regular file.",
      );
    if (!check) return await readFile(path, "utf8");
    const file = await open(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    try {
      const current = await file.stat();
      if (
        !current.isFile() ||
        current.ino !== stat.ino ||
        current.dev !== stat.dev
      )
        throw new CodexSetupError(
          "UNSAFE_CONFIG",
          "Codex config changed during inspection.",
        );
      if (current.size <= CHECK_FILE_LIMIT) {
        const buffers: Buffer[] = [];
        let total = 0;
        while (total <= CHECK_FILE_LIMIT) {
          const buffer = Buffer.alloc(
            Math.min(65536, CHECK_FILE_LIMIT + 1 - total),
          );
          const { bytesRead } = await file.read(buffer);
          if (!bytesRead) return Buffer.concat(buffers, total).toString("utf8");
          buffers.push(buffer.subarray(0, bytesRead));
          total += bytesRead;
        }
      }
      throw new CodexSetupError(
        "CONFIG_TOO_LARGE",
        "Codex config exceeds 8 MiB.",
      );
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function configurationPath(options: Pick<CodexSetupOptions, "codexHome">) {
  return join(
    resolve(
      options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    ),
    "config.toml",
  );
}

function parseConfig(source: string | undefined): Table {
  let document: Table;
  try {
    document = parse(source ?? "") as Table;
  } catch {
    throw new CodexSetupError(
      "INVALID_CONFIG",
      "Codex config contains invalid TOML; no changes were made.",
    );
  }
  if (document.mcp_servers !== undefined && !table(document.mcp_servers))
    throw new CodexSetupError(
      "INVALID_CONFIG",
      "Codex mcp_servers must be a table; no changes were made.",
    );
  return document;
}

export async function checkCodexSetup(
  options: Pick<CodexSetupOptions, "codexHome" | "entrypoint">,
) {
  const configPath = configurationPath(options);
  try {
    const document = parseConfig(await readConfig(configPath, true));
    const entry = (document.mcp_servers as Table | undefined)?.rebut;
    const cwd = npxWorkingDirectory(configPath);
    if (
      table(entry) &&
      entry.enabled !== false &&
      isManagedNpx(entry, cwd)
    )
      return {
        configPath,
        status: "npx_launcher",
        launcher: { cwd: await npxProjectStatus(cwd) },
      };
    return {
      configPath,
      ...(await inspectLauncher(entry, {
        client: "codex",
        entrypoint: options.entrypoint,
      })),
    };
  } catch (error) {
    if (error instanceof CodexSetupError) throw error;
    throw new CodexSetupError(
      "CONFIG_IO",
      "Unable to read Codex config. Check the file and permissions.",
    );
  }
}

async function update(
  options: CodexSetupOptions,
  operation: "setup" | "remove" | "migrate-npx",
): Promise<{ configPath: string; changed: boolean }> {
  const configPath = configurationPath(options);
  let temporary: string | undefined;
  try {
    const original = await readConfig(configPath);
    const document = parseConfig(original);
    const servers = (document.mcp_servers ?? {}) as Table;
    const existing = servers.rebut;
    const remove = operation === "remove";
    const migrate = operation === "migrate-npx";
    let replacement = desired(options);
    if (migrate) {
      const cwd = npxWorkingDirectory(configPath);
      if (isManagedNpx(existing, cwd)) {
        await prepareNpxWorkingDirectory(cwd);
        return { configPath, changed: false };
      }
      if (!isNpmLauncher(existing, "codex"))
        throw new CodexSetupError(
          "UNSUPPORTED_NPX_MIGRATION",
          "Migration requires an existing Codex Rebut npm registration.",
        );
      if (existing.cwd !== undefined && existing.cwd !== cwd)
        throw new CodexSetupError(
          "UNSAFE_NPX_MIGRATION",
          "Keep the direct launcher or remove its custom cwd before migrating.",
        );
      if (existing.cwd === undefined && usesWorkingDirectory(existing))
        throw new CodexSetupError(
          "UNSAFE_NPX_MIGRATION",
          "Before migrating, put absolute REBUT_CONFIG_DIR and REBUT_BW_GET paths in the Rebut env table and remove those path names from env_vars.",
        );
      await checkNpxPath(existing);
      replacement = {
        startup_timeout_sec: STARTUP_TIMEOUT_SECONDS,
        ...existing,
        command: "npx",
        args: npxLauncherArgs("codex", cwd),
        cwd,
      };
    }
    if (
      (!remove && equivalent(existing, replacement)) ||
      (remove && existing === undefined)
    ) {
      return { configPath, changed: false };
    }
    if (
      !migrate &&
      existing !== undefined &&
      !equivalent(existing, replacement) &&
      !(
        remove &&
        (isManagedNpx(existing, npxWorkingDirectory(configPath)) ||
          matchesRemoval(existing, replacement, options.entrypoint))
      ) &&
      !options.replace
    ) {
      throw new CodexSetupError(
        "SERVER_CONFLICT",
        "Codex already has a different rebut server. Use --replace to replace it.",
      );
    }
    if (remove) delete servers.rebut;
    else servers.rebut = replacement;
    document.mcp_servers = servers;
    const output = render(
      original ?? "",
      document,
      remove ? undefined : replacement,
    );
    if (migrate) await prepareNpxWorkingDirectory(npxWorkingDirectory(configPath));
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(configPath), 0o700);
    temporary = join(dirname(configPath), `.rebut-config-${randomUUID()}.tmp`);
    await writeFile(temporary, output, { mode: 0o600, flag: "wx" });
    if ((await readConfig(configPath)) !== original) {
      throw new CodexSetupError(
        "CONFIG_CHANGED",
        "Codex config changed during setup; retry the command.",
      );
    }
    await rename(temporary, configPath);
    temporary = undefined;
    return { configPath, changed: true };
  } catch (error) {
    if (error instanceof CodexSetupError || error instanceof NpxLauncherError)
      throw error;
    throw new CodexSetupError(
      "CONFIG_IO",
      "Unable to update Codex config. Check the config directory and file permissions.",
    );
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
  }
}

export function setupCodex(
  options: CodexSetupOptions,
): Promise<{ configPath: string; changed: boolean }> {
  return update(options, "setup");
}

export function removeCodex(
  options: CodexSetupOptions,
): Promise<{ configPath: string; changed: boolean }> {
  return update(options, "remove");
}

export function migrateCodexToNpx(
  options: Pick<CodexSetupOptions, "codexHome" | "entrypoint">,
) {
  return update(options, "migrate-npx");
}
