import { it, expect } from "vitest";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

it("source doctor handshakes with the fixture package version and preserves tools/exit codes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-doctor-version-"));
  try {
    await cp(resolve("src"), join(root, "src"), { recursive: true });
    await cp(resolve("migrations"), join(root, "migrations"), {
      recursive: true,
    });
    await cp(resolve("config.example.json"), join(root, "config.example.json"));
    await cp(
      resolve("test/fixtures/doctor-handshake.mjs"),
      join(root, "observer.mjs"),
    );
    await symlink(
      resolve("node_modules"),
      join(root, "node_modules"),
      "junction",
    );
    const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    pkg.version = "9.8.7-doctor-fixture";
    await writeFile(join(root, "package.json"), JSON.stringify(pkg));
    await writeFile(
      join(root, "source.mjs"),
      'import {runCli} from "./src/cli.ts"; await runCli(process.argv.slice(2)).catch((error) => { console.error(error); process.exitCode = 1; });',
    );
    const settings = join(root, "settings");
    await mkdir(settings, { mode: 0o700 });
    await writeFile(
      join(settings, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        mode: "local",
        secretStore: "env",
        vaultwardenItem: "Synthetic token item",
      }),
      { mode: 0o600 },
    );
    const marker = join(root, "handshake.json");
    const env = {
      HOME: root,
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      REBUT_CONFIG_DIR: settings,
      REBUT_TEST_HANDSHAKE: marker,
      REBUT_OPENAI_API_KEY: "synthetic-doctor-key-not-real-123456789",
    };
    const run = (args: string[], credentials = true) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          join(root, "observer.mjs"),
          join(root, "source.mjs"),
          ...args,
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 15000,
          env: {
            ...env,
            REBUT_OPENAI_API_KEY: credentials ? env.REBUT_OPENAI_API_KEY : "",
          },
        },
      );
    const version = run(["--version"]);
    expect(version.status, version.stderr).toBe(0);
    expect(version.stdout.trim()).toBe(pkg.version);
    const doctor = run(["doctor", "--connect"]);
    expect(doctor.status, doctor.stderr).toBe(0);
    expect(JSON.parse(await readFile(marker, "utf8"))).toEqual({
      name: "rebut-local-doctor",
      version: pkg.version,
    });
    expect(await readFile(marker + ".network", "utf8")).toBe("0");
    expect(JSON.parse(doctor.stdout).localTools).toEqual([
      "review",
      "review_status",
    ]);
    await rm(marker);
    const missingKey = run(["doctor", "--connect"], false);
    expect(missingKey.status).toBe(1);
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
