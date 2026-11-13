import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { parse, stringify } from "smol-toml";
import { CODEX_TOOL_TIMEOUT_SECONDS } from "../timeouts.js";

export interface CodexSetupOptions {
  codexHome?: string;
  entrypoint: string;
  nodePath?: string;
  replace?: boolean;
  forwardTokenEnv?: boolean;
  forwardApiKeyEnv?: boolean;
  apiKeyEnv?: "REBUT_OPENAI_API_KEY" | "OPENAI_API_KEY";
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
  return {
    command: options.nodePath ?? process.execPath,
    args: [resolve(options.entrypoint), "mcp"],
    startup_timeout_sec: 60,
    tool_timeout_sec: CODEX_TOOL_TIMEOUT_SECONDS,
    enabled_tools: ["review", "review_status"],
    ...(options.forwardApiKeyEnv
      ? { env_vars: [options.apiKeyEnv ?? "REBUT_OPENAI_API_KEY"] }
      : options.forwardTokenEnv
        ? { env_vars: ["REBUT_TOKEN"] }
        : {}),
    ...(options.configDir !== undefined
      ? { env: { REBUT_CONFIG_DIR: resolve(options.configDir) } }
      : {}),
  };
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

async function readConfig(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new CodexSetupError(
        "UNSAFE_CONFIG",
        "Codex config must be a regular file.",
      );
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function update(
  options: CodexSetupOptions,
  remove: boolean,
): Promise<{ configPath: string; changed: boolean }> {
  const configPath = join(
    resolve(
      options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    ),
    "config.toml",
  );
  let temporary: string | undefined;
  try {
    const original = await readConfig(configPath);
    let document: Table;
    try {
      document = parse(original ?? "") as Table;
    } catch {
      throw new CodexSetupError(
        "INVALID_CONFIG",
        "Codex config contains invalid TOML; no changes were made.",
      );
    }
    if (document.mcp_servers !== undefined && !table(document.mcp_servers)) {
      throw new CodexSetupError(
        "INVALID_CONFIG",
        "Codex mcp_servers must be a table; no changes were made.",
      );
    }
    const servers = (document.mcp_servers ?? {}) as Table;
    const existing = servers.rebut;
    const replacement = desired(options);
    if (
      (!remove && equivalent(existing, replacement)) ||
      (remove && existing === undefined)
    ) {
      return { configPath, changed: false };
    }
    if (
      existing !== undefined &&
      !equivalent(existing, replacement) &&
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
    if (error instanceof CodexSetupError) throw error;
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
  return update(options, false);
}

export function removeCodex(
  options: CodexSetupOptions,
): Promise<{ configPath: string; changed: boolean }> {
  return update(options, true);
}
