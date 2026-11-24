import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, delimiter, isAbsolute, join } from "node:path";
import type { McpClient } from "./settings.js";

export class NpxLauncherError extends Error {
  constructor(
    message = "The Rebut npx project directory must be private and contain only Rebut's package.json.",
    public readonly code = "UNSAFE_NPX_CWD",
  ) {
    super(message);
    this.name = "NpxLauncherError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function npxLauncherArgs(client: McpClient, prefix?: string) {
  return [
    ...(prefix === undefined ? [] : ["--prefix", prefix]),
    "-y",
    "--ignore-scripts",
    "rebut-mcp@latest",
    "mcp",
    "--client",
    client,
  ];
}

export function matchesNpxLauncher(entry: unknown, expectedArgs: string[]) {
  if (
    !record(entry) ||
    (entry.type !== undefined && entry.type !== "stdio") ||
    entry.url !== undefined ||
    entry.command !== "npx" ||
    !Array.isArray(entry.args)
  )
    return false;
  return (
    entry.args.length === expectedArgs.length &&
    entry.args.every((value, index) => value === expectedArgs[index])
  );
}

export function isNpmLauncher(
  entry: unknown,
  client: McpClient,
): entry is Record<string, unknown> {
  if (
    !record(entry) ||
    (entry.type !== undefined && entry.type !== "stdio") ||
    entry.url !== undefined ||
    typeof entry.command !== "string" ||
    !fullyQualifiedPath(entry.command) ||
    !/^node(?:\.exe)?$/i.test(basename(entry.command)) ||
    !Array.isArray(entry.args)
  )
    return false;
  const [script, subcommand, clientFlag, registeredClient] = entry.args;
  return (
    typeof script === "string" &&
    fullyQualifiedPath(script) &&
    /[\\/]node_modules[\\/]rebut-mcp[\\/]bin[\\/]rebut\.mjs$/i.test(script) &&
    subcommand === "mcp" &&
    (entry.args.length === 2 ||
      (entry.args.length === 4 &&
        clientFlag === "--client" &&
        registeredClient === client))
  );
}

export function fullyQualifiedPath(value: string) {
  return (
    isAbsolute(value) &&
    (process.platform !== "win32" || /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(value))
  );
}

export async function checkNpxPath(entry: Record<string, unknown>) {
  const env = record(entry.env) ? entry.env : {};
  const windows = process.platform === "win32";
  const hostPath = windows
    ? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1]
    : env.PATH;
  const path = typeof hostPath === "string" ? hostPath : (process.env.PATH ?? "");
  const directories = path
    .split(delimiter)
    .map((directory) =>
      windows && directory.startsWith('"') && directory.endsWith('"')
        ? directory.slice(1, -1)
        : directory,
    )
    .filter(fullyQualifiedPath);
  async function executableOnPath(names: string[]) {
    for (const directory of directories) {
      for (const name of names) {
        const executable = join(directory, name);
        try {
          await access(executable, constants.X_OK);
          if ((await stat(executable)).isFile()) return executable;
        } catch {
          // Try the next PATH entry.
        }
      }
    }
  }
  const node = await executableOnPath(windows ? ["node.exe"] : ["node"]);
  if (
    !node ||
    !(await executableOnPath(windows ? ["npx.cmd", "npx.exe"] : ["npx"]))
  )
    throw new NpxLauncherError(
      "Node and npx must be on this launcher's PATH before it can be migrated.",
      "NPX_UNAVAILABLE",
    );
  const [selected, current] = await Promise.all([
    realpath(node),
    realpath(process.execPath),
  ]);
  // The updater knows its own Node version. Leave the existing registration
  // in place when the host would resolve a different, unverified executable.
  if (
    Number(process.versions.node.split(".")[0]) < 24 ||
    (windows ? selected.toLowerCase() !== current.toLowerCase() : selected !== current)
  )
    throw new NpxLauncherError(
      "Could not verify the Node.js executable on the host's PATH. Use the same Node.js 24+ executable for the host and the update to migrate.",
      "NPX_RUNTIME_UNVERIFIED",
    );
}

const npxProjectFile = "package.json";
const npxProject = '{"private":true}\n';

async function npxDirectoryEntries(cwd: string) {
  const stat = await lstat(cwd);
  const uid = process.getuid?.();
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (uid !== undefined && (stat.uid !== uid || (stat.mode & 0o077) !== 0))
  )
    throw new NpxLauncherError();
  return readdir(cwd);
}

async function verifyNpxProject(cwd: string, entries: string[]) {
  if (!entries.length) return false;
  if (entries.length !== 1 || entries[0] !== npxProjectFile)
    throw new NpxLauncherError();
  const path = join(cwd, npxProjectFile);
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size !== npxProject.length ||
    (await readFile(path, "utf8")) !== npxProject
  )
    throw new NpxLauncherError();
  return true;
}

export async function prepareNpxWorkingDirectory(cwd: string) {
  try {
    await mkdir(cwd, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (await verifyNpxProject(cwd, await npxDirectoryEntries(cwd))) return;
  // Keep npm's project discovery inside the dedicated launch directory.
  await writeFile(join(cwd, npxProjectFile), npxProject, {
    flag: "wx",
    mode: 0o600,
  });
}

export async function npxProjectStatus(cwd: string) {
  try {
    return (await verifyNpxProject(cwd, await npxDirectoryEntries(cwd)))
      ? "present"
      : "missing";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? "missing"
      : "unsafe";
  }
}
