import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "smol-toml";
import { ReviewInputSchema, inputHash } from "../src/contracts.js";
const base = process.cwd().startsWith("/Volumes/Kingston NV/")
  ? "/Volumes/Kingston NV/tmp"
  : process.cwd().startsWith("/Volumes/Samsung T5/")
    ? "/Volumes/Samsung T5/tmp"
    : tmpdir();
const fixtureToken = "synthetic-test-bearer-value-not-real-123456789";
async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(base, "codex-rebut-cli-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function cli(dir: string, args: string[], input?: string) {
  return spawnSync(process.execPath, [resolve("bin/rebut.mjs"), ...args], {
    input,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      REBUT_CONFIG_DIR: join(dir, "settings"),
      REBUT_TOKEN: fixtureToken,
    },
  });
}
it("packaged CLI help/version run without credentials or creating settings", async () =>
  fixture(async (dir) => {
    for (const args of [["--version"], ["--help"]]) {
      const r = cli(dir, args);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain(fixtureToken);
    }
    await expect(stat(join(dir, "settings"))).rejects.toThrow();
  }));
it("writes private nonsecret config, rejects credential URLs and reports only availability", async () =>
  fixture(async (dir) => {
    expect(
      cli(dir, ["set", "endpoint", "https://user:password@example.invalid/mcp"])
        .status,
    ).toBe(1);
    expect(
      cli(dir, ["set", "endpoint", "https://example.invalid/mcp?token=private"])
        .status,
    ).toBe(1);
    expect(
      cli(dir, ["set", "endpoint", "https://example.invalid/mcp"]).status,
    ).toBe(0);
    expect(cli(dir, ["set", "secret-store", "env"]).status).toBe(0);
    const file = join(dir, "settings/config.json"),
      text = await readFile(file, "utf8");
    expect(text).not.toContain(fixtureToken);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const result = cli(dir, ["doctor"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      secretStore: "env",
      credentialAvailable: true,
      endpointConfigured: true,
    });
    expect(result.stdout + result.stderr).not.toContain(fixtureToken);
    const home = join(dir, "env-codex");
    expect(
      cli(dir, ["setup", "--client", "codex", "--codex-home", home]).status,
    ).toBe(0);
    const configText = await readFile(join(home, "config.toml"), "utf8");
    const server = (parse(configText) as any).mcp_servers.rebut;
    expect(server.env_vars).toEqual(["REBUT_TOKEN"]);
    expect(server.env.REBUT_CONFIG_DIR).toBe(join(dir, "settings"));
    expect(configText).not.toContain(fixtureToken);
  }));
it("does not echo a token accidentally supplied on argv", async () =>
  fixture(async (dir) => {
    const r = cli(dir, ["set", "token", fixtureToken]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain(fixtureToken);
  }));
it("registers and removes a real packaged entry without touching unrelated Codex configuration", async () =>
  fixture(async (dir) => {
    const home = join(dir, "codex home");
    await mkdir(home);
    await writeFile(
      join(home, "config.toml"),
      'model = "example"\n[mcp_servers.other]\ncommand = "other"\n',
    );
    cli(dir, ["set", "endpoint", "https://example.invalid/mcp"]);
    const setup = cli(dir, [
      "setup",
      "--client",
      "codex",
      "--codex-home",
      home,
    ]);
    expect(setup.status).toBe(0);
    const configured = parse(
      await readFile(join(home, "config.toml"), "utf8"),
    ) as any;
    expect(configured.model).toBe("example");
    expect(configured.mcp_servers.other.command).toBe("other");
    expect(configured.mcp_servers.rebut.args).toEqual([
      resolve("bin/rebut.mjs"),
      "mcp",
    ]);
    expect(
      cli(dir, ["remove", "--client", "codex", "--codex-home", home]).status,
    ).toBe(0);
    const remaining = parse(
      await readFile(join(home, "config.toml"), "utf8"),
    ) as any;
    expect(remaining.model).toBe("example");
    expect(remaining.mcp_servers.rebut).toBeUndefined();
    expect(remaining.mcp_servers.other.command).toBe("other");
  }));
it("collect command emits a valid frozen profile without reading credentials", async () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "sample.ts"), "export const value = 1;\n");
    const r = cli(dir, [
      "collect",
      "--root",
      dir,
      "--request-id",
      "synthetic",
      "--requirements",
      "Preserve value",
      "--profile",
      "luna-test",
      "--",
      "sample.ts",
    ]);
    expect(r.status).toBe(0);
    const result = ReviewInputSchema.parse(JSON.parse(r.stdout));
    expect(result.profile).toBe("luna-test");
    expect(result.input_sha256).toBe(await inputHash(result));
  }));
it("stores model and reasoning preferences without embedding an admin secret or exposing credentials to Codex", async () =>
  fixture(async (dir) => {
    expect(cli(dir, ["set", "model", "new-responses-model"]).status).toBe(0);
    expect(cli(dir, ["set", "reasoning", "future_effort"]).status).toBe(0);
    let settings = JSON.parse(
      await readFile(join(dir, "settings/config.json"), "utf8"),
    );
    expect(settings).toMatchObject({
      defaultModel: "new-responses-model",
      defaultReasoning: "future_effort",
    });
    expect(cli(dir, ["set", "profile", "explicit-profile"]).status).toBe(0);
    settings = JSON.parse(
      await readFile(join(dir, "settings/config.json"), "utf8"),
    );
    expect(settings.defaultProfile).toBe("explicit-profile");
    expect(settings.defaultModel).toBeUndefined();
    expect(settings.defaultReasoning).toBeUndefined();
    const result = cli(dir, ["set", "admin-token", fixtureToken]);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(fixtureToken);
    expect(cli(dir, ["set", "reasoning", "bad effort"]).status).toBe(1);
  }));
