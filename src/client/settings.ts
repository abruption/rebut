import { constants, type Stats } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import {
  mkdir,
  rename,
  unlink,
  lstat,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Provider } from "../contracts.js";
import { LimitsSchema } from "../config.js";
import { validateEndpoint } from "./connection.js";
export type McpClient = "codex" | "claude";
const ProfileId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
export const SettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["local", "worker"]).optional(),
    provider: z.enum(["openai", "anthropic"]).optional(),
    vaultwardenAnthropicApiKeyItem: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => !/[\x00-\x1f\x7f]/.test(s))
      .optional(),
    apiKeyEnv: z.enum(["REBUT_OPENAI_API_KEY", "OPENAI_API_KEY"]).optional(),
    localLimits: LimitsSchema.optional(),
    vaultwardenApiKeyItem: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => !/[\x00-\x1f\x7f]/.test(s))
      .optional(),
    defaultModel: z
      .string()
      .regex(/^[a-zA-Z0-9._:-]{1,100}$/)
      .optional(),
    defaultReasoning: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,31}$/)
      .optional(),
    defaultProfile: ProfileId.optional(),
    clientProfiles: z
      .strictObject({
        codex: ProfileId.optional(),
        claude: ProfileId.optional(),
      })
      .optional(),
    vaultwardenAdminItem: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => !/[\x00-\x1f\x7f]/.test(s))
      .default("Rebut — MCP Admin Token"),
    endpoint: z.string().max(2048).optional(),
    secretStore: z.enum(["keychain", "vaultwarden", "env"]),
    vaultwardenItem: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => !/[\x00-\x1f\x7f]/.test(s)),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;
export function settingsPath(): string {
  return join(
    process.env.REBUT_CONFIG_DIR
      ? resolve(process.env.REBUT_CONFIG_DIR)
      : process.platform === "win32"
        ? join(process.env.APPDATA || homedir(), "Rebut")
        : join(homedir(), ".config", "rebut"),
    "config.json",
  );
}

interface PathIdentity {
  path: string;
  stat: Stats;
  allowTrustedLink: boolean;
  requireCurrentOwner: boolean;
}

interface DirectoryState {
  handle: FileHandle;
  entries: PathIdentity[];
}

function unsafeSettings(): never {
  throw new Error("SETTINGS_UNSAFE");
}

function currentUid(): number {
  // Node does not expose Windows DACL ownership/effective-write checks. Fail
  // closed rather than trust credential-routing settings without that proof.
  const getuid = process.getuid;
  if (process.platform === "win32" || !getuid) unsafeSettings();
  return getuid();
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function pathChain(path: string): string[] {
  const chain: string[] = [];
  for (let current = resolve(path); ; current = dirname(current)) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
  }
  return chain.reverse();
}

function checkDirectoryEntry(
  stat: Stats,
  options: { allowTrustedLink: boolean; requireCurrentOwner: boolean },
): void {
  const uid = currentUid();
  if (stat.isSymbolicLink()) {
    if (!options.allowTrustedLink || stat.uid !== 0) unsafeSettings();
    return;
  }
  if (!stat.isDirectory()) unsafeSettings();
  if (
    (options.requireCurrentOwner && stat.uid !== uid) ||
    (!options.requireCurrentOwner && stat.uid !== uid && stat.uid !== 0)
  )
    unsafeSettings();
  if (
    (stat.mode & 0o022) !== 0 &&
    !(
      !options.requireCurrentOwner &&
      stat.uid === 0 &&
      (stat.mode & 0o1000) !== 0
    )
  )
    unsafeSettings();
}

async function snapshotDirectoryChain(
  path: string,
  allowTrustedLinks: boolean,
  requireDirectoryOwner = true,
): Promise<PathIdentity[]> {
  const paths = pathChain(path);
  return Promise.all(
    paths.map(async (entry, index) => {
      const requireCurrentOwner =
        requireDirectoryOwner && index === paths.length - 1;
      const options = {
        allowTrustedLink: allowTrustedLinks && !requireCurrentOwner,
        requireCurrentOwner,
      };
      const stat = await lstat(entry);
      checkDirectoryEntry(stat, options);
      return { path: entry, stat, ...options };
    }),
  );
}

async function verifyDirectory(state: DirectoryState): Promise<void> {
  for (const entry of state.entries) {
    const current = await lstat(entry.path);
    checkDirectoryEntry(current, entry);
    if (!sameIdentity(current, entry.stat)) unsafeSettings();
  }
  const current = await state.handle.stat();
  const directory = state.entries[state.entries.length - 1]!;
  checkDirectoryEntry(current, {
    allowTrustedLink: false,
    requireCurrentOwner: true,
  });
  if (!sameIdentity(current, directory.stat)) unsafeSettings();
}

async function createSettingsDirectory(path: string): Promise<void> {
  let ancestor = path;
  for (;;) {
    try {
      await lstat(ancestor);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") unsafeSettings();
      ancestor = dirname(ancestor);
    }
  }
  if (ancestor === path) return;

  await snapshotDirectoryChain(ancestor, true, false);
  await snapshotDirectoryChain(await realpath(ancestor), false, false);
  await mkdir(path, { recursive: true, mode: 0o700 });
}

async function inspectDirectory(path: string): Promise<DirectoryState> {
  let handle: FileHandle | undefined;
  try {
    const lexical = await snapshotDirectoryChain(path, true);
    const canonicalPath = await realpath(path);
    const canonical = await snapshotDirectoryChain(canonicalPath, false);
    const lexicalDirectory = lexical[lexical.length - 1]!.stat;
    const canonicalDirectory = canonical[canonical.length - 1]!.stat;
    if (!sameIdentity(lexicalDirectory, canonicalDirectory)) unsafeSettings();
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const state = { handle, entries: [...lexical, ...canonical] };
    await verifyDirectory(state);
    return state;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof Error && error.message === "SETTINGS_UNSAFE")
      throw error;
    return unsafeSettings();
  }
}

function checkSettingsFile(stat: Stats): void {
  const uid = currentUid();
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== uid ||
    (stat.mode & 0o077) !== 0
  )
    unsafeSettings();
}

async function openSettingsFile(
  path: string,
  directory: DirectoryState,
  allowMissing = false,
): Promise<{ handle: FileHandle; stat: Stats } | undefined> {
  let handle: FileHandle | undefined;
  try {
    let observed: Stats;
    try {
      observed = await lstat(path);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT")
        return undefined;
      throw error;
    }
    checkSettingsFile(observed);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const current = await handle.stat();
    checkSettingsFile(current);
    if (!sameIdentity(observed, current)) unsafeSettings();
    await verifyDirectory(directory);
    return { handle, stat: current };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof Error && error.message === "SETTINGS_UNSAFE")
      throw error;
    return unsafeSettings();
  }
}

async function readSettingsSource(path: string): Promise<string | undefined> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    unsafeSettings();
  }
  let directory: DirectoryState | undefined;
  let file: FileHandle | undefined;
  try {
    directory = await inspectDirectory(dirname(path));
    const opened = await openSettingsFile(path, directory);
    if (!opened) unsafeSettings();
    file = opened.handle;
    const source = await file.readFile("utf8");
    const current = await file.stat();
    checkSettingsFile(current);
    if (!sameIdentity(opened.stat, current)) unsafeSettings();
    await verifyDirectory(directory);
    return source;
  } finally {
    await file?.close().catch(() => {});
    await directory?.handle.close().catch(() => {});
  }
}

export async function readSettings(): Promise<Settings> {
  try {
    const path = settingsPath();
    const source = await readSettingsSource(path);
    if (source === undefined)
      return {
        schemaVersion: 1,
        mode: "local",
        secretStore: process.platform === "darwin" ? "keychain" : "env",
        vaultwardenItem: "Rebut — MCP Access Token",
        vaultwardenAdminItem: "Rebut — MCP Admin Token",
      };
    const data = SettingsSchema.parse(JSON.parse(source));
    if (data.endpoint) validateEndpoint(data.endpoint);
    return data;
  } catch (error) {
    if (error instanceof Error && error.message === "SETTINGS_UNSAFE")
      throw error;
    throw new Error("SETTINGS_INVALID");
  }
}
export async function writeSettings(value: Settings): Promise<void> {
  const checked = SettingsSchema.parse(value);
  if (checked.endpoint) validateEndpoint(checked.endpoint);
  const path = settingsPath(),
    dir = dirname(path);
  currentUid();
  await createSettingsDirectory(dir);
  const temporary = join(dir, ".config-" + randomUUID() + ".tmp");
  let directory: DirectoryState | undefined;
  let staged: FileHandle | undefined;
  let temporaryCreated = false;
  let destination: Stats | undefined;
  try {
    directory = await inspectDirectory(dir);
    const existing = await openSettingsFile(path, directory, true);
    if (existing) {
      destination = existing.stat;
      await existing.handle.close();
    }
    staged = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    temporaryCreated = true;
    await staged.chmod(0o600);
    const stagedStat = await staged.stat();
    checkSettingsFile(stagedStat);
    await staged.writeFile(JSON.stringify(checked, null, 2) + "\n", "utf8");
    await staged.sync();
    await staged.close();
    staged = undefined;
    await verifyDirectory(directory);
    try {
      const current = await lstat(path);
      checkSettingsFile(current);
      if (!destination || !sameIdentity(destination, current)) unsafeSettings();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || destination)
        unsafeSettings();
    }
    await rename(temporary, path);
  } finally {
    await staged?.close().catch(() => {});
    await directory?.handle.close().catch(() => {});
    if (temporaryCreated) await unlink(temporary).catch(() => {});
  }
}

export function executionMode(settings: Settings): "local" | "worker" {
  return settings.mode ?? (settings.endpoint ? "worker" : "local");
}

export function providerEnvName(
  settings: Settings,
  provider: Provider = settings.provider ?? "openai",
): "REBUT_OPENAI_API_KEY" | "OPENAI_API_KEY" | "REBUT_ANTHROPIC_API_KEY" {
  return provider === "anthropic"
    ? "REBUT_ANTHROPIC_API_KEY"
    : (settings.apiKeyEnv ?? "REBUT_OPENAI_API_KEY");
}
