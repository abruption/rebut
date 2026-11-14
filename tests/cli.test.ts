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
function cli(
  dir: string,
  args: string[],
  input?: string,
  extraEnv: Record<string, string> = {},
) {
  return spawnSync(process.execPath, [resolve("bin/rebut.mjs"), ...args], {
    input,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      REBUT_CONFIG_DIR: join(dir, "settings"),
      REBUT_TOKEN: fixtureToken,
      ...extraEnv,
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

it("sets up local mode without an endpoint and forwards only the API-key variable name", async () =>
  fixture(async (dir) => {
    expect(cli(dir, ["set", "secret-store", "env"]).status).toBe(0);
    const home = join(dir, "local-codex");
    expect(
      cli(dir, ["setup", "--client", "codex", "--codex-home", home]).status,
    ).toBe(0);
    const config = parse(
      await readFile(join(home, "config.toml"), "utf8"),
    ) as any;
    expect(config.mcp_servers.rebut.env_vars).toEqual(["REBUT_OPENAI_API_KEY"]);
    const doctor = cli(dir, ["doctor"], undefined, {
      OPENAI_API_KEY: "",
      REBUT_OPENAI_API_KEY: "",
    });
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      mode: "local",
      endpointConfigured: false,
      credentialAvailable: false,
    });
    const status = cli(dir, ["status", "missing"], undefined, {
      OPENAI_API_KEY: "",
    });
    expect(status.status).toBe(0);
    const pending = cli(dir, ["status", "--pending"], undefined, {
      OPENAI_API_KEY: "",
      REBUT_OPENAI_API_KEY: "",
    });
    expect(pending.status).toBe(0);
    expect(JSON.parse(pending.stdout)).toMatchObject({
      backend: "local",
      requests: [],
      has_more: false,
    });
    expect(JSON.parse(JSON.parse(status.stdout).content[0].text)).toEqual({
      backend: "local",
      status: "not_found",
    });
    const rejected = cli(dir, ["set", "api-key", fixtureToken]);
    expect(rejected.status).toBe(1);
    expect(rejected.stdout + rejected.stderr).not.toContain(fixtureToken);
  }));
it("keeps mode selection explicit and local budgets separate from Worker settings", async () =>
  fixture(async (dir) => {
    expect(
      cli(dir, ["set", "endpoint", "https://worker.invalid/mcp"]).status,
    ).toBe(0);
    let settings = JSON.parse(
      await readFile(join(dir, "settings/config.json"), "utf8"),
    );
    expect(settings.mode).toBeUndefined();
    expect(cli(dir, ["set", "daily-budget", "1.23"]).status).toBe(1);
    expect(cli(dir, ["set", "mode", "local"]).status).toBe(0);
    expect(cli(dir, ["set", "daily-budget", "1.23"]).status).toBe(0);
    settings = JSON.parse(
      await readFile(join(dir, "settings/config.json"), "utf8"),
    );
    expect(settings.endpoint).toBe("https://worker.invalid/mcp");
    expect(settings.localLimits.dailyMicrousd).toBe(1230000);
    const profiles = cli(dir, ["profile", "list"], undefined, {
      OPENAI_API_KEY: "",
    });
    expect(profiles.status).toBe(0);
    expect(
      JSON.parse(profiles.stdout).profiles.some(
        (p: any) => p.id === "luna-test",
      ),
    ).toBe(true);
  }));

it("lets an operator add bounded local capacity without changing recorded requests", async () =>
  fixture(async (dir) => {
    expect(cli(dir, ["set", "secret-store", "env"]).status).toBe(0);
    expect(cli(dir, ["set", "max-concurrent", "2"]).status).toBe(0);
    const current = JSON.parse(
      await readFile(join(dir, "settings/config.json"), "utf8"),
    );
    expect(current.localLimits.maxConcurrent).toBe(2);
    expect(current.localLimits.dailyMicrousd).toBe(6660000);
    for (const value of ["0", "11", "1.5", "-1"])
      expect(cli(dir, ["set", "max-concurrent", value]).status).toBe(1);
    const result = cli(dir, ["set", "api-key-env", "OPENAI_API_KEY"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("setup --client codex --replace");
  }));
it("does not add new-only settings when updating a legacy Worker configuration", async () =>
  fixture(async (dir) => {
    await mkdir(join(dir, "settings"), { recursive: true });
    await writeFile(
      join(dir, "settings/config.json"),
      JSON.stringify({
        schemaVersion: 1,
        endpoint: "https://worker.invalid/mcp",
        secretStore: "env",
        vaultwardenItem: "legacy",
      }),
    );
    expect(cli(dir, ["set", "model", "gpt-6-astra"]).status).toBe(0);
    expect(
      cli(dir, ["set", "endpoint", "https://new.invalid/mcp"]).status,
    ).toBe(0);
    const current = JSON.parse(
      await readFile(join(dir, "settings/config.json"), "utf8"),
    );
    for (const field of [
      "mode",
      "apiKeyEnv",
      "localLimits",
      "vaultwardenApiKeyItem",
    ])
      expect(current).not.toHaveProperty(field);
  }));

it("configures the Claude provider and host independently without embedding keys", async () =>
  fixture(async (dir) => {
    expect(cli(dir, ["set", "provider", "anthropic"]).status).toBe(0);
    expect(cli(dir, ["set", "secret-store", "env"]).status).toBe(0);
    let settings = JSON.parse(
      await readFile(join(dir, "settings/config.json"), "utf8"),
    );
    expect(settings).toMatchObject({
      provider: "anthropic",
      defaultProfile: "claude-medium",
    });
    expect(cli(dir, ["set", "api-key-env", "ANTHROPIC_API_KEY"]).status).toBe(
      1,
    );
    expect(
      cli(dir, ["set", "vaultwarden-api-key-item", "Synthetic Claude item"])
        .status,
    ).toBe(0);
    settings = JSON.parse(
      await readFile(join(dir, "settings/config.json"), "utf8"),
    );
    expect(settings.vaultwardenAnthropicApiKeyItem).toBe(
      "Synthetic Claude item",
    );
    expect(settings.vaultwardenApiKeyItem).toBeUndefined();
    const config = join(dir, "claude-user.json");
    const setup = cli(dir, [
      "setup",
      "--client",
      "claude",
      "--claude-config",
      config,
    ]);
    expect(setup.status, setup.stderr).toBe(0);
    const entry = JSON.parse(await readFile(config, "utf8")).mcpServers.rebut;
    expect(entry.timeout).toBe(1_860_000);
    expect(entry.env).toMatchObject({
      REBUT_ANTHROPIC_API_KEY: "${REBUT_ANTHROPIC_API_KEY:-}",
      REBUT_CONFIG_DIR: join(dir, "settings"),
    });
    expect(JSON.stringify(entry)).not.toContain(fixtureToken);
    expect(entry.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(entry.env.REBUT_ADMIN_TOKEN).toBeUndefined();
    expect(
      cli(dir, ["remove", "--client", "claude", "--claude-config", config])
        .status,
    ).toBe(0);
    expect(
      JSON.parse(await readFile(config, "utf8")).mcpServers.rebut,
    ).toBeUndefined();
    expect(cli(dir, ["set", "model", "claude-opus-5-5"]).status).toBe(0);
    expect(cli(dir, ["set", "provider", "anthropic"]).status).toBe(0);
    settings = JSON.parse(
      await readFile(join(dir, "settings/config.json"), "utf8"),
    );
    expect(settings.defaultModel).toBe("claude-opus-5-5");
  }));
it("collects a frozen Claude profile without loading a provider key", async () =>
  fixture(async (dir) => {
    expect(cli(dir, ["set", "provider", "anthropic"]).status).toBe(0);
    await writeFile(join(dir, "fixture.ts"), "export const n = 1;");
    const result = cli(dir, [
      "collect",
      "--root",
      dir,
      "--request-id",
      "claude-collection",
      "--requirements",
      "Check code",
      "--",
      "fixture.ts",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).profile).toBe("claude-medium");
    expect(cli(dir, ["set", "mode", "worker"]).status).toBe(0);
    const diagnostic = cli(dir, ["doctor", "--provider"]);
    expect(diagnostic.status).toBe(1);
    expect(diagnostic.stderr).toContain("local mode only");
  }));

it("preserves existing profile providers regardless of the selected key provider", async () =>
  fixture(async (dir) => {
    expect(cli(dir, ["set", "provider", "anthropic"]).status).toBe(0);
    const flags = [
      "--reasoning",
      "medium",
      "--max-output-tokens",
      "8192",
      "--input-usd-per-million",
      "4",
      "--output-usd-per-million",
      "20",
      "--price-version",
      "fixture",
    ];
    let r = cli(dir, [
      "profile",
      "set",
      "astra-medium",
      "--model",
      "gpt-6-astra",
      ...flags,
      "--if-revision",
      "0",
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).record.profile.provider).toBeUndefined();
    r = cli(dir, [
      "profile",
      "set",
      "claude-medium",
      "--model",
      "claude-opus-5-5",
      ...flags,
      "--if-revision",
      "0",
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).record.profile.provider).toBe("anthropic");
    r = cli(dir, [
      "profile",
      "set",
      "fresh-legacy-default",
      "--model",
      "gpt-6-astra",
      ...flags,
    ]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).record.profile.provider).toBeUndefined();
  }));
it("applies reasoning overrides after selecting a provider and forwards the effective profile key", async () =>
  fixture(async (dir) => {
    expect(cli(dir, ["set", "provider", "anthropic"]).status).toBe(0);
    expect(cli(dir, ["set", "secret-store", "env"]).status).toBe(0);
    const profile = cli(dir, [
      "profile",
      "set",
      "claude-high",
      "--provider",
      "anthropic",
      "--model",
      "claude-opus-5-5",
      "--reasoning",
      "high",
      "--max-output-tokens",
      "8192",
      "--input-usd-per-million",
      "4",
      "--output-usd-per-million",
      "20",
      "--price-version",
      "fixture",
    ]);
    expect(profile.status, profile.stderr).toBe(0);
    expect(cli(dir, ["set", "reasoning", "high"]).status).toBe(0);
    await writeFile(join(dir, "sample.ts"), "return 1;");
    const result = cli(dir, [
      "collect",
      "--root",
      dir,
      "--request-id",
      "override",
      "--requirements",
      "Check",
      "--",
      "sample.ts",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).profile).toBe("claude-high");
    const codexHome = join(dir, "codex");
    expect(
      cli(dir, ["setup", "--client", "codex", "--codex-home", codexHome])
        .status,
    ).toBe(0);
    expect(
      (parse(await readFile(join(codexHome, "config.toml"), "utf8")) as any)
        .mcp_servers.rebut.env_vars,
    ).toEqual(["REBUT_ANTHROPIC_API_KEY"]);
    expect(cli(dir, ["set", "profile", "astra-medium"]).status).toBe(0);
    const health = cli(dir, ["doctor", "--connect"], undefined, {
      REBUT_OPENAI_API_KEY: "synthetic-openai-actual-key-not-real-123456789",
      REBUT_ANTHROPIC_API_KEY: "",
    });
    expect(health.status, health.stderr).toBe(0);
    expect(JSON.parse(health.stdout)).toMatchObject({
      provider: "openai",
      keyConfigurationProvider: "anthropic",
      credentialAvailable: true,
      apiKeyEnv: "REBUT_OPENAI_API_KEY",
    });
    const config = join(dir, "effective-claude.json");
    expect(
      cli(dir, ["setup", "--client", "claude", "--claude-config", config])
        .status,
    ).toBe(0);
    expect(
      JSON.parse(await readFile(config, "utf8")).mcpServers.rebut.env
        .REBUT_OPENAI_API_KEY,
    ).toBe("${REBUT_OPENAI_API_KEY:-}");
  }));
