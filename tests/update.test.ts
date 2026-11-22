import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi, type TestContext } from "vitest";
import { updateGlobalInstallation } from "../src/client/update.js";

function fixture(context: TestContext) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "codex-rebut-update-")),
  );
  context.onTestFinished(() =>
    rmSync(directory, { recursive: true, force: true }),
  );
  const windows = process.platform === "win32";
  const prefix = join(directory, "one-time prefix");
  const modules = windows
    ? join(prefix, "node_modules")
    : join(prefix, "lib", "node_modules");
  const installed = join(modules, "rebut-mcp");
  const modulePath = join(installed, "lib", "cli.mjs");
  const entrypoint = join(installed, "bin", "rebut.mjs");
  const node = windows
    ? join(directory, "runtime", "node.exe")
    : join(directory, "runtime", "bin", "node");
  const npmRoot = join(
    directory,
    "runtime",
    ...(windows ? [] : ["lib"]),
    "node_modules",
    "npm",
  );
  const npm = join(npmRoot, "bin", "npm-cli.js");
  for (const file of [entrypoint, modulePath, npm]) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
  }
  const writeVersion = (version: string) =>
    writeFileSync(
      join(installed, "package.json"),
      JSON.stringify({
        name: "rebut-mcp",
        version,
        bin: { rebut: "bin/rebut.mjs" },
      }),
    );
  writeVersion("0.4.0");
  writeFileSync(join(npmRoot, "package.json"), JSON.stringify({ name: "npm" }));
  const launcher = windows
    ? join(prefix, "rebut.cmd")
    : join(prefix, "bin", "rebut");
  mkdirSync(dirname(launcher), { recursive: true });
  if (windows)
    writeFileSync(
      launcher,
      '"%_prog%" "%dp0%\\node_modules\\rebut-mcp\\bin\\rebut.mjs" %*\r\n',
    );
  else symlinkSync(entrypoint, launcher);
  const options = {
    root: modules,
    dryRun: "false",
    offline: "false",
    latest: "0.4.1",
    installedVersion: "0.4.1",
    installError: false,
  };
  const run = vi.fn(
    (
      executable: string,
      args: string[],
      cwd: string,
      timeout: number | undefined,
    ) => {
      expect(executable).toBe(node);
      expect(cwd).toBe(prefix);
      expect(args[0]).toBe(npm);
      switch (args[1]) {
        case "--version":
          return "11.19.1\n";
        case "root":
          return options.root + "\n";
        case "config":
          return `dry-run=${options.dryRun}\noffline=${options.offline}\n`;
        case "view":
          return JSON.stringify(options.latest);
        case "install":
          expect(timeout).toBeUndefined();
          expect(existsSync(join(prefix, ".rebut-update.lock"))).toBe(true);
          if (options.installError)
            throw new Error("Sensitive npm failure output");
          writeVersion(options.installedVersion);
          return "installed";
        default:
          throw new Error("Unexpected npm command");
      }
    },
  );
  const update = (source = modulePath) =>
    updateGlobalInstallation(source, { node, run });
  return {
    directory,
    prefix,
    installed,
    launcher,
    modulePath,
    options,
    run,
    update,
    writeVersion,
  };
}

it("updates the verified package in its one-time prefix and checks the installed version", (context) => {
  const { prefix, update, run } = fixture(context);
  const global = ["--global", "--prefix", prefix];
  expect(update()).toEqual({ previousVersion: "0.4.0", version: "0.4.1" });
  expect(run.mock.calls.map(([, args]) => args.slice(1))).toEqual([
    ["--version", "--no-json"],
    ["root", ...global, "--no-json"],
    ["config", "get", "dry-run", "offline", ...global, "--no-json"],
    [
      "view",
      "rebut-mcp@latest",
      "version",
      "--json",
      ...global,
      "--prefer-online",
      "--no-prefer-offline",
    ],
    [
      "install",
      "rebut-mcp@0.4.1",
      ...global,
      "--ignore-scripts",
      "--engine-strict",
      "--no-force",
      "--bin-links",
      "--no-audit",
      "--no-fund",
    ],
  ]);
  expect(existsSync(join(prefix, ".rebut-update.lock"))).toBe(false);
});

it("avoids rewriting or downgrading the installation when latest is current or older", (context) => {
  const { options, run, update } = fixture(context);
  for (const latest of ["0.4.0", "0.3.9"]) {
    options.latest = latest;
    expect(update()).toEqual({ previousVersion: "0.4.0", version: "0.4.0" });
  }
  expect(run.mock.calls.some(([, args]) => args[1] === "install")).toBe(false);
});

it("does not run npm from a source checkout, local install or missing global launcher", (context) => {
  const { directory, installed, launcher, run, update } = fixture(context);
  expect(() => update(join(directory, "src", "cli.ts"))).toThrow(
    "global npm installation",
  );
  const local = join(
    directory,
    "checkout",
    "node_modules",
    "rebut-mcp",
    "lib",
    "cli.mjs",
  );
  expect(() => update(local)).toThrow("global npm installation");
  rmSync(launcher);
  expect(() => update(join(installed, "lib", "cli.mjs"))).toThrow(
    "global npm installation",
  );
  expect(run).not.toHaveBeenCalled();
});

it("refuses npm root mismatches, dry-run and offline mode without installing", (context) => {
  const { directory, options, run, update } = fixture(context);
  const modules = options.root;
  options.root = directory;
  expect(() => update()).toThrow("global npm installation");
  options.root = modules;
  options.dryRun = "true";
  expect(() => update()).toThrow("npm dry-run is enabled");
  options.dryRun = "false";
  options.offline = "true";
  expect(() => update()).toThrow("npm offline mode is enabled");
  expect(run.mock.calls.some(([, args]) => args[1] === "install")).toBe(false);
});

it("refuses a prerelease latest tag and a competing update lock", (context) => {
  const { prefix, options, run, update } = fixture(context);
  options.latest = "0.5.0-rc.1";
  expect(() => update()).toThrow("Unable to verify a stable Rebut version");
  options.latest = "0.4.1";
  const lock = join(prefix, ".rebut-update.lock");
  mkdirSync(lock);
  expect(() => update()).toThrow("This npm prefix has a Rebut update lock");
  expect(existsSync(lock)).toBe(true);
  expect(run.mock.calls.some(([, args]) => args[1] === "install")).toBe(false);
});

it("does not replace a linked installation", (context) => {
  const { directory, installed, run, update } = fixture(context);
  const linkedSource = join(directory, "linked-source");
  renameSync(installed, linkedSource);
  symlinkSync(
    linkedSource,
    installed,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => update()).toThrow("global npm installation");
  expect(run).not.toHaveBeenCalled();
});

it("clears its lock on failure, sanitizes npm output ambiguity and verifies installation", (context) => {
  const { prefix, options, update } = fixture(context);
  options.installError = true;
  expect(() => update()).toThrow(/^npm could not complete the update\./);
  expect(existsSync(join(prefix, ".rebut-update.lock"))).toBe(false);
  options.installError = false;
  options.installedVersion = "0.4.0";
  expect(() => update()).toThrow(/^Cannot verify the updated installation\./);
});
