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
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
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

// npm exec prepends workspace bins to PATH and exports the absolute Node
// executable that started npm. Bypass the package's PATH-based node shim.
// This program is stored in the MCP registration. Keep recognizing previously
// generated arguments when changing the program.
const npxBootstrap = `
  const { dirname, delimiter, isAbsolute, join, relative, sep } = require('node:path');
  const { realpathSync } = require('node:fs');
  const { homedir } = require('node:os');
  const { pathToFileURL } = require('node:url');
  const env = (name) => Object.entries(process.env)
    .find(([key]) => key.toLowerCase() === name)?.[1];
  const fail = (message) => {
    process.stderr.write(message + '\\n');
    process.exitCode = 1;
  };
  const locateRebut = () => {
    const cache = env('npm_config_cache') || (process.platform === 'win32'
      ? join(env('localappdata') || homedir(), 'npm-cache')
      : join(homedir(), '.npm'));
    const bin = env('path')?.split(delimiter)[0];
    if (!bin || !isAbsolute(bin))
      throw Error('Could not locate the npx-installed Rebut.');
    const resolvedBin = realpathSync(bin);
    const npxRoot = realpathSync(join(cache, '_npx'));
    const location = relative(npxRoot, resolvedBin);
    const parts = location.split(sep);
    if (isAbsolute(location) || parts.length !== 3 || parts[0] === '..' ||
        parts[1] !== 'node_modules' || parts[2] !== '.bin')
      throw Error('Could not locate the npx-installed Rebut.');
    return join(dirname(resolvedBin), 'rebut-mcp', 'bin', 'rebut.mjs');
  };
  const run = async () => {
    if (Number(process.versions.node.split('.')[0]) < 24)
      return fail('Rebut requires Node.js 24 or later.');
    let entry;
    try {
      entry = locateRebut();
    } catch {
      return fail('Could not locate Rebut in the npm exec cache.');
    }
    process.argv.splice(1, 0, entry);
    await import(pathToFileURL(entry).href);
  };
  run().catch(() => fail('Could not load the npx-installed Rebut entry point.'));
`;

export function npxLauncherArgs(client: McpClient, prefix: string) {
  const windows = process.platform === "win32";
  const shell = windows
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe")
    : "/bin/sh";
  // Encode the fixed program so its syntax survives both shell parsers.
  const code = Buffer.from(npxBootstrap).toString("base64");
  const cli = `--input-type=commonjs --eval "eval(Buffer.from('${code}','base64').toString())" -- mcp --client ${client}`;
  const call = windows
    ? `""%npm_node_execpath%" ${cli}"`
    : `exec "$npm_node_execpath" ${cli}`;
  return [
    "--prefix",
    prefix,
    "-y",
    "--ignore-scripts",
    "--package=rebut-mcp@latest",
    "--script-shell",
    shell,
    "--call",
    call,
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

function unverifiedNpxRuntime() {
  return new NpxLauncherError(
    "Could not verify the Node.js executable on the host's PATH. Use the same Node.js 24+ executable for the host and the update to migrate.",
    "NPX_RUNTIME_UNVERIFIED",
  );
}

export async function checkNpxPath(entry: Record<string, unknown>) {
  const env = record(entry.env) ? entry.env : {};
  const windows = process.platform === "win32";
  const hostPath = windows
    ? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1]
    : env.PATH;
  const path = typeof hostPath === "string" ? hostPath : (process.env.PATH ?? "");
  const directories = path.split(delimiter).map((directory) =>
    windows && directory.startsWith('"') && directory.endsWith('"')
      ? directory.slice(1, -1)
      : directory,
  );
  // A relative or empty component can resolve against the MCP host's cwd.
  if (directories.some((directory) => !fullyQualifiedPath(directory)))
    throw new NpxLauncherError(
      "Use only absolute directories in the host's PATH. Remove relative and empty entries, including trailing separators, before running rebut update.",
      "NPX_RUNTIME_UNVERIFIED",
    );
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
  const npx = await executableOnPath(windows ? ["npx.cmd"] : ["npx"]);
  // The host resolves npx, and the batch fallback resolves node. Both
  // names can select another file through Windows executable extensions.
  if (
    windows &&
    (await executableOnPath([
      "npx.exe", "npx.bat", "npx.com",
      "node.bat", "node.cmd", "node.com",
    ]))
  )
    throw unverifiedNpxRuntime();
  if (!node || !npx)
    throw new NpxLauncherError(
      "Node and npx must be on this launcher's PATH before it can be migrated.",
      "NPX_UNAVAILABLE",
    );
  const selected = [await realpath(node)];
  if (windows) {
    // npm's batch launcher uses %~dp0\node.exe before falling back to PATH.
    const sibling = join(dirname(npx), "node.exe");
    const siblingInfo = await lstat(sibling).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw unverifiedNpxRuntime();
    });
    if (siblingInfo) {
      if (!siblingInfo.isFile() && !siblingInfo.isSymbolicLink())
        throw unverifiedNpxRuntime();
      selected.push(
        await realpath(sibling).catch(() => {
          throw unverifiedNpxRuntime();
        }),
      );
    }
  }
  const current = await realpath(process.execPath);
  // The updater knows its own Node version. Leave the existing registration
  // in place when the host would resolve a different, unverified executable.
  if (
    Number(process.versions.node.split(".")[0]) < 24 ||
    selected.some((path) =>
      windows ? path.toLowerCase() !== current.toLowerCase() : path !== current,
    )
  )
    throw unverifiedNpxRuntime();
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
