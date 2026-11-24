import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import {
  parseTree,
  findNodeAtLocation,
  getNodeValue,
  modify,
  applyEdits,
  type Node,
  type ParseError,
} from "jsonc-parser";
import { CODEX_TOOL_TIMEOUT_SECONDS } from "../timeouts.js";
import { inspectLauncher } from "./setup-check.js";
import {
  checkNpxPath,
  isNpmLauncher,
  matchesNpxLauncher,
  NpxLauncherError,
  npxLauncherArgs,
  npxProjectStatus,
  prepareNpxWorkingDirectory,
} from "./npx-launcher.js";
export interface ClaudeSetupOptions {
  claudeConfig?: string;
  entrypoint: string;
  nodePath?: string;
  replace?: boolean;
  forwardTokenEnv?: boolean;
  forwardApiKeyEnv?: boolean;
  apiKeyEnv?: string;
  configDir?: string;
}
export class ClaudeSetupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClaudeSetupError";
  }
}
const fail = (code: string, message: string): never => {
  throw new ClaudeSetupError(code, message);
};
const MAX_BYTES = 8 * 1024 * 1024;
const parse = (source: string): Node => {
  const errors: ParseError[] = [];
  const root = parseTree(source, errors, {
    disallowComments: true,
    allowTrailingComma: false,
  });
  if (!root || errors.length || root.type !== "object")
    fail(
      "INVALID_CONFIG",
      "Claude config must contain a valid JSON object; no changes were made.",
    );
  const walk = (node: Node, depth: number) => {
    if (depth > 100)
      fail(
        "INVALID_CONFIG",
        "Claude config nesting is unsupported; no changes were made.",
      );
    if (node.type === "object") {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children?.[0]?.value;
        if (typeof key !== "string" || keys.has(key))
          fail(
            "INVALID_CONFIG",
            "Claude config has duplicate keys; no changes were made.",
          );
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(root!, 0);
  const servers = findNodeAtLocation(root!, ["mcpServers"]);
  if (servers && servers.type !== "object")
    fail(
      "INVALID_CONFIG",
      "Claude mcpServers must be an object; no changes were made.",
    );
  return root!;
};
async function readConfig(path: string): Promise<string | undefined> {
  let file;
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (process.platform !== "win32" &&
        (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0))
    )
      fail(
        "UNSAFE_CONFIG",
        "Claude config must be a private regular file owned by the current user.",
      );
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const current = await file.stat();
    if (current.size > MAX_BYTES)
      fail(
        "CONFIG_TOO_LARGE",
        "Claude config exceeds 8 MiB; no changes were made.",
      );
    if (
      current.ino !== stat.ino ||
      current.dev !== stat.dev ||
      current.nlink !== 1 ||
      (process.platform !== "win32" &&
        (current.uid !== process.getuid?.() || (current.mode & 0o077) !== 0))
    )
      fail(
        "UNSAFE_CONFIG",
        "Claude config changed or has unsafe permissions; no changes were made.",
      );
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_BYTES)
        fail(
          "CONFIG_TOO_LARGE",
          "Claude config exceeds 8 MiB; no changes were made.",
        );
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(chunks),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally {
    await file?.close();
  }
}
function safePath(path: string): string {
  if (/[\x00-\x1f\x7f]|\$\{/.test(path))
    fail(
      "INVALID_PATH",
      "Use literal paths without control characters or variable templates.",
    );
  return resolve(path);
}
function desired(options: ClaudeSetupOptions) {
  const env: Record<string, string> = {};
  if (options.configDir !== undefined)
    env.REBUT_CONFIG_DIR = safePath(options.configDir);
  if (options.forwardApiKeyEnv) {
    const name = options.apiKeyEnv ?? "REBUT_OPENAI_API_KEY";
    if (
      ![
        "REBUT_OPENAI_API_KEY",
        "OPENAI_API_KEY",
        "REBUT_ANTHROPIC_API_KEY",
      ].includes(name)
    )
      fail("INVALID_ENV", "Unsupported provider environment variable.");
    env[name] = `\${${name}:-}`;
  } else if (options.forwardTokenEnv) env.REBUT_TOKEN = "${REBUT_TOKEN:-}";
  return {
    type: "stdio",
    command: safePath(options.nodePath ?? process.execPath),
    args: [safePath(options.entrypoint), "mcp", "--client", "claude"],
    timeout: CODEX_TOOL_TIMEOUT_SECONDS * 1000,
    ...(Object.keys(env).length ? { env } : {}),
  };
}
function equivalent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equivalent(v, b[i]));
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(
        (k) =>
          Object.hasOwn(b, k) &&
          equivalent(
            (a as Record<string, unknown>)[k],
            (b as Record<string, unknown>)[k],
          ),
      )
    );
  }
  return false;
}
function recognized(value: unknown): boolean {
  if (typeof value !== "object" || !value || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.type === undefined || v.type === "stdio") &&
    typeof v.command === "string" &&
    isAbsolute(v.command) &&
    Array.isArray(v.args) &&
    (v.args.length === 2 ||
      (v.args.length === 4 &&
        v.args[2] === "--client" &&
        v.args[3] === "claude")) &&
    typeof v.args[0] === "string" &&
    /(?:^|[\\/])bin[\\/]rebut\.mjs$/.test(v.args[0]) &&
    v.args[1] === "mcp"
  );
}
function configurationPath(options: Pick<ClaudeSetupOptions, "claudeConfig">) {
  if (!options.claudeConfig && process.env.CLAUDE_CONFIG_DIR)
    fail(
      "CONFIG_PATH_REQUIRED",
      "Set --claude-config PATH explicitly when CLAUDE_CONFIG_DIR is in use.",
    );
  return safePath(options.claudeConfig ?? join(homedir(), ".claude.json"));
}

function npxPrefix(configPath: string) {
  return join(dirname(configPath), ".rebut-claude-npx");
}

async function prepareConfigParent(configPath: string) {
  const path = dirname(configPath);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const parent = await lstat(path);
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (process.platform !== "win32" &&
      (parent.uid !== process.getuid?.() || (parent.mode & 0o022) !== 0))
  )
    fail(
      "UNSAFE_CONFIG",
      "Claude config parent must be owned and writable only by the current user.",
    );
}

export async function checkClaudeSetup(
  options: Pick<ClaudeSetupOptions, "claudeConfig" | "entrypoint">,
) {
  const configPath = configurationPath(options);
  try {
    const tree = parse((await readConfig(configPath)) ?? "{}");
    const node = findNodeAtLocation(tree, ["mcpServers", "rebut"]);
    const entry = node ? getNodeValue(node) : undefined;
    const prefix = npxPrefix(configPath);
    if (matchesNpxLauncher(entry, npxLauncherArgs("claude", prefix)))
      return {
        configPath,
        status: "npx_launcher",
        launcher: { prefix: await npxProjectStatus(prefix) },
      };
    return {
      configPath,
      ...(await inspectLauncher(entry, {
        client: "claude",
        entrypoint: options.entrypoint,
      })),
    };
  } catch (error) {
    if (error instanceof ClaudeSetupError) throw error;
    throw new ClaudeSetupError(
      "CONFIG_IO",
      "Unable to read Claude config. Check the file and permissions.",
    );
  }
}

async function update(
  options: ClaudeSetupOptions,
  operation: "setup" | "remove" | "migrate-npx",
): Promise<{ configPath: string; changed: boolean }> {
  const configPath = configurationPath(options);
  const remove = operation === "remove";
  const migrate = operation === "migrate-npx";
  let temporary: string | undefined;
  try {
    const original = await readConfig(configPath);
    if (remove && original === undefined) return { configPath, changed: false };
    const source = original ?? "{}";
    const tree = parse(source);
    const node = findNodeAtLocation(tree, ["mcpServers", "rebut"]);
    const existing = node ? getNodeValue(node) : undefined;
    const prefix = npxPrefix(configPath);
    const args = npxLauncherArgs("claude", prefix);
    const managedNpx = matchesNpxLauncher(existing, args);
    let output: string;
    if (migrate) {
      if (managedNpx) {
        await prepareConfigParent(configPath);
        await prepareNpxWorkingDirectory(prefix);
        return { configPath, changed: false };
      }
      if (!isNpmLauncher(existing, "claude"))
        fail(
          "UNSUPPORTED_NPX_MIGRATION",
          "Migration requires an existing Claude Code Rebut npm registration.",
        );
      await checkNpxPath(existing);
      // Claude Code's stdio launcher does not use a cwd field. npm's
      // explicit prefix controls package resolution without changing the
      // child working directory. Edit only the two launcher fields.
      const withCommand = applyEdits(
        source,
        modify(source, ["mcpServers", "rebut", "command"], "npx", {}),
      );
      output = applyEdits(
        withCommand,
        modify(withCommand, ["mcpServers", "rebut", "args"], args, {}),
      );
    } else {
      const replacement = remove ? undefined : desired(options);
      if ((remove && !node) || (!remove && equivalent(existing, replacement)))
        return { configPath, changed: false };
      if (
        node &&
        !options.replace &&
        (!remove || (!recognized(existing) && !managedNpx))
      )
        fail(
          "SERVER_CONFLICT",
          "Claude has a different rebut entry. Use --replace to explicitly replace or remove it.",
        );
      output = applyEdits(
        source,
        modify(source, ["mcpServers", "rebut"], replacement, {}),
      );
    }
    if (Buffer.byteLength(output, "utf8") > MAX_BYTES)
      fail(
        "CONFIG_TOO_LARGE",
        "Claude config update would exceed 8 MiB; no changes were made.",
      );
    parse(output);
    await prepareConfigParent(configPath);
    if (migrate) await prepareNpxWorkingDirectory(prefix);
    temporary = join(dirname(configPath), `.rebut-claude-${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(output, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    if ((await readConfig(configPath)) !== original)
      fail(
        "CONFIG_CHANGED",
        "Claude config changed during setup; retry after stopping Claude Code.",
      );
    await rename(temporary, configPath);
    temporary = undefined;
    return { configPath, changed: true };
  } catch (error) {
    if (error instanceof ClaudeSetupError || error instanceof NpxLauncherError)
      throw error;
    throw new ClaudeSetupError(
      "CONFIG_IO",
      "Unable to update Claude config safely. Check its path and permissions.",
    );
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
  }
}
export const setupClaude = (options: ClaudeSetupOptions) =>
  update(options, "setup");
export const removeClaude = (options: ClaudeSetupOptions) =>
  update(options, "remove");
export const migrateClaudeToNpx = (
  options: Pick<ClaudeSetupOptions, "claudeConfig" | "entrypoint">,
) => update(options, "migrate-npx");
