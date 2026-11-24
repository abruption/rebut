import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";

const packageName = "rebut-mcp";
const entrypoint = "bin/rebut.mjs";
const lockName = ".rebut-update.lock";
const recovery =
  "The installation may have changed. Stop Rebut hosts and reinstall rebut-mcp in the original npm prefix if needed.";
const messages = {
  installation:
    "Cannot verify this as a global npm installation of Rebut. Update it using the method that installed it.",
  npm: "Cannot verify the npm CLI paired with this Node installation.",
  configuration:
    "Cannot verify the npm update configuration. Check npm's dry-run and offline settings.",
  dryRun: "npm dry-run is enabled for this prefix. Disable it before updating.",
  offline:
    "npm offline mode is enabled for this prefix. Connect to the registry before updating.",
  latest: "Unable to verify a stable Rebut version at npm's latest tag.",
  lock: "Cannot create the update lock in this npm prefix. Check write access.",
  busy: `This npm prefix has a Rebut update lock. Remove ${lockName} from the prefix only after confirming that no npm update is running.`,
  unlock: `Cannot remove ${lockName} from the npm prefix. Verify the installed version and remove the lock when npm is idle.`,
  changed:
    "The installed Rebut version changed during update preparation. Check the active install and retry.",
  install: "npm could not complete the update. " + recovery,
  result: "Cannot verify the updated installation. " + recovery,
};

export class UpdateError extends Error {
  constructor(reason: keyof typeof messages) {
    super(messages[reason]);
    this.name = "UpdateError";
  }
}

type RunNpm = (
  node: string,
  args: string[],
  cwd: string,
  timeout: number | undefined,
) => string;

const runNpm: RunNpm = (node, args, cwd, timeout) =>
  execFileSync(node, args, {
    cwd,
    encoding: "utf8",
    stdio: timeout === undefined ? "ignore" : ["ignore", "pipe", "pipe"],
    timeout,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });

function metadata(directory: string) {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function versionParts(value: unknown): number[] {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  )
    throw new Error("Invalid version");
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error("Invalid version");
  return parts;
}

function verifyInstall(
  prefix: string,
  directory: string,
  windows: boolean,
): string {
  const expected = windows
    ? join(prefix, "node_modules", packageName)
    : join(prefix, "lib", "node_modules", packageName);
  if (
    !lstatSync(expected).isDirectory() ||
    realpathSync(expected) !== expected ||
    realpathSync(directory) !== expected
  )
    throw new Error("Unexpected package path");
  const cli = join(expected, entrypoint);
  const bundle = join(expected, "lib", "cli.mjs");
  for (const file of [join(expected, "package.json"), cli, bundle]) {
    if (!lstatSync(file).isFile() || realpathSync(file) !== file)
      throw new Error("Unexpected entrypoint");
  }
  if (windows) {
    const shim = join(prefix, "rebut.cmd");
    const stat = lstatSync(shim);
    if (
      !stat.isFile() ||
      stat.size > 16_384 ||
      !/"%dp0%[\\/]node_modules[\\/]rebut-mcp[\\/]bin[\\/]rebut\.mjs"[ \t]+%\*$/i.test(
        readFileSync(shim, "utf8").trimEnd(),
      )
    )
      throw new Error("Missing global Windows npm shim");
  } else {
    const shim = join(prefix, "bin", "rebut");
    if (
      realpathSync(dirname(shim)) !== dirname(shim) ||
      !lstatSync(shim).isSymbolicLink() ||
      realpathSync(shim) !== cli
    )
      throw new Error("Missing global npm launcher");
  }
  const pkg = metadata(expected);
  if (pkg.name !== packageName || pkg.bin?.rebut !== entrypoint)
    throw new Error("Unexpected package identity");
  versionParts(pkg.version);
  return pkg.version;
}

function acquireLock(prefix: string): () => void {
  const lock = join(prefix, lockName);
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new UpdateError("busy");
    throw new UpdateError("lock");
  }
  return () => {
    try {
      rmdirSync(lock);
    } catch {
      throw new UpdateError("unlock");
    }
  };
}

export function updateGlobalInstallation(
  modulePath: string,
  {
    node = process.execPath,
    run = runNpm,
  }: { node?: string; run?: RunNpm } = {},
): { previousVersion: string; version: string; latestVersion: string } {
  const windows = process.platform === "win32";
  let stage: keyof typeof messages = "installation";
  try {
    if (!isAbsolute(modulePath)) throw new UpdateError(stage);
    const moduleFile = resolve(modulePath);
    const directory = dirname(dirname(moduleFile));
    const modules = dirname(directory);
    const parent = dirname(modules);
    if (
      basename(directory) !== packageName ||
      basename(modules) !== "node_modules" ||
      (!windows && basename(parent) !== "lib") ||
      moduleFile !== join(directory, "lib", "cli.mjs")
    )
      throw new UpdateError(stage);
    const prefix = realpathSync(windows ? parent : dirname(parent));
    if (prefix === parse(prefix).root) throw new UpdateError(stage);
    const previousVersion = verifyInstall(prefix, directory, windows);

    stage = "npm";
    if (!isAbsolute(node)) throw new UpdateError(stage);
    const nodeDirectory = dirname(node);
    const npmDirectory = windows
      ? join(nodeDirectory, "node_modules", "npm")
      : join(nodeDirectory, "..", "lib", "node_modules", "npm");
    const npm = join(npmDirectory, "bin", "npm-cli.js");
    if (!lstatSync(npm).isFile() || metadata(npmDirectory).name !== "npm")
      throw new UpdateError(stage);
    const invoke = (args: string[], timeout = 15_000) =>
      run(node, [npm, ...args], prefix, timeout).trim();
    versionParts(invoke(["--version", "--no-json"]));

    const global = ["--global", "--prefix", prefix];
    stage = "installation";
    const root = invoke(["root", ...global, "--no-json"]);
    if (
      !isAbsolute(root) ||
      /[\r\n\0]/.test(root) ||
      realpathSync(root) !== realpathSync(modules)
    )
      throw new UpdateError(stage);
    stage = "configuration";
    const config = new Set(
      invoke([
        "config",
        "get",
        "dry-run",
        "offline",
        ...global,
        "--no-json",
      ]).split(/\r?\n/),
    );
    if (config.has("dry-run=true")) throw new UpdateError("dryRun");
    if (config.has("offline=true")) throw new UpdateError("offline");
    if (!config.has("dry-run=false") || !config.has("offline=false"))
      throw new UpdateError(stage);

    stage = "latest";
    const result: unknown = JSON.parse(
      invoke(
        [
          "view",
          packageName + "@latest",
          "version",
          "--json",
          ...global,
          "--prefer-online",
          "--no-prefer-offline",
        ],
        30_000,
      ),
    );
    const latest: unknown =
      Array.isArray(result) && result.length === 1 ? result[0] : result;
    if (typeof latest !== "string") throw new UpdateError(stage);
    const previous = versionParts(previousVersion);
    const next = versionParts(latest);
    const firstDifference = next.findIndex(
      (part, index) => part !== previous[index],
    );
    if (
      firstDifference === -1 ||
      next[firstDifference] < previous[firstDifference]
    )
      return { previousVersion, version: previousVersion, latestVersion: latest };

    const unlock = acquireLock(prefix);
    try {
      stage = "changed";
      const active = verifyInstall(prefix, directory, windows);
      if (active === latest)
        return { previousVersion: active, version: active, latestVersion: latest };
      if (active !== previousVersion) throw new UpdateError(stage);

      stage = "install";
      // Let npm finish its install or handle its own errors. Killing npm on a
      // Rebut deadline or output limit could interrupt package replacement.
      run(
        node,
        [
          npm,
          "install",
          packageName + "@" + latest,
          ...global,
          "--ignore-scripts",
          "--engine-strict",
          "--no-force",
          "--bin-links",
          "--no-audit",
          "--no-fund",
        ],
        prefix,
        undefined,
      );
      stage = "result";
      const version = verifyInstall(prefix, directory, windows);
      if (version !== latest) throw new UpdateError(stage);
      return { previousVersion, version, latestVersion: latest };
    } finally {
      unlock();
    }
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    throw new UpdateError(stage);
  }
}
