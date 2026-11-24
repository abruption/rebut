import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  writeFile,
  rm,
  stat,
  symlink,
  truncate,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "smol-toml";
import { ReviewInputSchema, inputHash } from "../src/contracts.js";
const fixtureToken = "synthetic-test-bearer-value-not-real-123456789";
async function fixture(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "codex-rebut-cli-"));
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
it("update rejects invalid arguments and source installs before reading settings", async () =>
  fixture(async (dir) => {
    const settingsDir = join(dir, "settings");
    await mkdir(settingsDir);
    await writeFile(join(settingsDir, "config.json"), "{malformed");
    for (const args of [["update", "--help"], ["help", "update"]]) {
      const help = cli(dir, args);
      expect(help.status).toBe(0);
      expect(help.stdout).toContain("rebut update");
      expect(help.stdout).toContain("Restart the hosts");
      expect(help.stdout).toContain("rebut setup --client codex --replace");
    }
    for (const args of [
      ["update", "--prefix", "other"],
      ["update", "--prefix", "other", "--help"],
    ]) {
      const invalid = cli(dir, args);
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain("Invalid arguments");
    }
    const source = cli(dir, ["update"]);
    expect(source.status).toBe(1);
    expect(source.stderr).toContain("global npm installation");
  }));
it("migrates an existing Codex registration without reading Rebut settings", async () =>
  fixture(async (dir) => {
    const settings = join(dir, "settings");
    const codexHome = join(dir, "codex home");
    await mkdir(settings);
    await writeFile(join(settings, "config.json"), "{malformed");
    await mkdir(codexHome);
    await writeFile(
      join(codexHome, "config.toml"),
      stringify({
        mcp_servers: {
          rebut: {
            command: join(dir, "old", "node"),
            args: [
              join(dir, "old", "node_modules", "rebut-mcp", "bin", "rebut.mjs"),
              "mcp",
            ],
          },
        },
      }),
    );
    const argumentsFor = ["update", "--migrate-npx", "--codex-home", codexHome];
    expect(cli(dir, [...argumentsFor, "--client", "claude"]).status).toBe(1);
    const result = cli(dir, [...argumentsFor, "--client", "codex"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      changed: true,
      launcher: "npx",
    });
    expect(await readFile(join(settings, "config.json"), "utf8")).toBe(
      "{malformed",
    );
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
      "--client",
      "codex",
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
      { mode: 0o600 },
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
it(
  "selects single-review defaults independently for both clients",
  async () =>
    fixture(async (dir) => {
      const write = (host: string, profile: string) =>
        cli(dir, ["set", "profile", profile, "--client", host]);
      expect(write("codex", "claude-medium").status).toBe(0);
      expect(write("claude", "astra-medium").status).toBe(0);
      expect(cli(dir, ["set", "profile", "luna-test"]).status).toBe(0);
      await writeFile(join(dir, "fixture.ts"), "export const n = 1;");
      const collect = (...choice: string[]) =>
        cli(dir, [
          "collect",
          "--root",
          dir,
          "--request-id",
          "client-collection",
          "--requirements",
          "Check code",
          ...choice,
          "--",
          "fixture.ts",
        ]);
      const bundle = (...choice: string[]) => {
        const result = collect(...choice);
        expect(result.status, result.stderr).toBe(0);
        return JSON.parse(result.stdout);
      };
      const doctor = JSON.parse(
        cli(dir, ["doctor", "--client", "codex"]).stdout,
      );
      expect(doctor).toMatchObject({
        defaultProfile: "claude-medium",
        profileResolution: "not_checked",
      });
      expect(doctor.provider).toBeUndefined();
      expect(doctor.credentialAvailable).toBeUndefined();
      expect(cli(dir, ["set", "secret-store", "env"]).status).toBe(0);
      const codexHome = join(dir, "codex-profile");
      const setup = cli(dir, [
        "setup",
        "--client",
        "codex",
        "--codex-home",
        codexHome,
      ]);
      expect(setup.status, setup.stderr).toBe(0);
      const host = parse(
        await readFile(join(codexHome, "config.toml"), "utf8"),
      ) as any;
      expect(host.mcp_servers.rebut.env_vars).toEqual([
        "REBUT_ANTHROPIC_API_KEY",
      ]);
      const code = bundle("--client", "codex");
      expect(code).toMatchObject({
        profile: "claude-medium",
        provider: "anthropic",
      });
      expect(code.input_sha256).toBe(await inputHash(code));
      expect(bundle("--client", "claude")).toMatchObject({
        profile: "astra-medium",
        provider: "openai",
      });
      expect(bundle()).toMatchObject({
        profile: "luna-test",
        provider: "openai",
      });
      expect(collect().stderr).toContain(
        "This bundle uses the shared review preference",
      );

      expect(
        bundle("--client", "codex", "--profile", "astra-medium"),
      ).toMatchObject({ profile: "astra-medium", provider: "openai" });
      expect(write("codex", "missing").status).toBe(0);
      expect(collect("--client", "codex").stderr).toContain(
        "Requested profile is unavailable or disabled",
      );
      expect(bundle("--client", "codex", "--profile", "claude-medium")).toEqual(
        code,
      );
      expect(
        cli(dir, ["set", "profile", "--client", "codex", "--clear"]).status,
      ).toBe(0);
      expect(bundle("--client", "codex").profile).toBe("luna-test");
      expect(bundle("--client", "claude").profile).toBe("astra-medium");
      const removed = cli(
        dir,
        ["remove", "--client", "codex", "--codex-home", codexHome],
        undefined,
        {
          OPENAI_API_KEY: "",
          REBUT_OPENAI_API_KEY: "",
          REBUT_ANTHROPIC_API_KEY: "",
        },
      );
      expect(removed.status, removed.stderr).toBe(0);
      expect(JSON.parse(removed.stdout).changed).toBe(true);
      const remaining = parse(
        await readFile(join(codexHome, "config.toml"), "utf8"),
      ) as any;
      expect(remaining.mcp_servers?.rebut).toBeUndefined();
      expect(collect("--client", "other").status).toBe(1);
    }),
  20_000,
);

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

it("plain doctor does not initialize SQLite and collection binds an explicit profile supplier", async () =>
  fixture(async (dir) => {
    expect(cli(dir, ["set", "secret-store", "env"]).status).toBe(0);
    const env = {
      REBUT_OPENAI_API_KEY: "synthetic-doctor-key-not-real-123456789",
    };
    const beforeNames = await readdir(join(dir, "settings"));
    const beforeSettings = await readFile(
      join(dir, "settings/config.json"),
      "utf8",
    );
    const beforeMtime = (await stat(join(dir, "settings/config.json"))).mtimeMs;
    const report = cli(dir, ["doctor"], undefined, env);
    expect(report.status, report.stderr).toBe(0);
    expect(JSON.parse(report.stdout).profileResolution).toBe("not_checked");
    expect(await readdir(join(dir, "settings"))).toEqual(beforeNames);
    expect(await readFile(join(dir, "settings/config.json"), "utf8")).toBe(
      beforeSettings,
    );
    expect((await stat(join(dir, "settings/config.json"))).mtimeMs).toBe(
      beforeMtime,
    );
    await expect(
      stat(join(dir, "settings/local/ledger.sqlite")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const connected = cli(dir, ["doctor", "--connect"], undefined, env);
    expect(connected.status, connected.stderr).toBe(0);
    expect(
      (await stat(join(dir, "settings/local/ledger.sqlite"))).isFile(),
    ).toBe(true);
    await writeFile(join(dir, "pin.ts"), "return 1;");
    const collected = cli(dir, [
      "collect",
      "--root",
      dir,
      "--request-id",
      "pin-cli",
      "--requirements",
      "Check",
      "--profile",
      "claude-medium",
      "--",
      "pin.ts",
    ]);
    expect(collected.status, collected.stderr).toBe(0);
    expect(JSON.parse(collected.stdout)).toMatchObject({
      schema_version: 2,
      provider: "anthropic",
      profile: "claude-medium",
    });
    expect(cli(dir, ["set", "provider", "anthropic"]).status).toBe(0);
    expect(cli(dir, ["set", "model", "missing-default-model"]).status).toBe(0);
    expect(cli(dir, ["set", "reasoning", "high"]).status).toBe(0);
    const explicit = cli(dir, [
      "collect",
      "--root",
      dir,
      "--request-id",
      "explicit-pin",
      "--requirements",
      "Check",
      "--profile",
      "astra-medium",
      "--",
      "pin.ts",
    ]);
    expect(explicit.status, explicit.stderr).toBe(0);
    expect(JSON.parse(explicit.stdout)).toMatchObject({
      schema_version: 2,
      provider: "openai",
      profile: "astra-medium",
    });
  }));

it("answers command and subcommand help before loading even invalid settings", async () =>
  fixture(async (dir) => {
    const settings = join(dir, "settings");
    await mkdir(settings);
    await writeFile(join(settings, "config.json"), "{invalid");
    for (const [args, usage] of [
      [["setup", "--help"], "rebut setup --check"],
      [["setup", "--check", "--help"], "rebut setup --check"],
      [["help", "doctor"], "rebut doctor"],
      [["help", "--help"], "rebut help"],
      [["help", "setup", "--help"], "rebut setup --check"],
      [["profile", "list", "--help"], "rebut profile list"],
      [["set", "api-key", "-h"], "rebut set api-key"],
    ] as const) {
      const result = cli(dir, [...args]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(usage);
    }
    const invalid = cli(dir, ["help", "unknown"]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Unknown help topic");
    expect(await readdir(settings)).toEqual(["config.json"]);
  }));
it("keeps a literal --help after the collect delimiter", async () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "--help"), "const answer = 42;\n");
    const result = cli(dir, [
      "collect",
      "--root",
      dir,
      "--request-id",
      "help-filename",
      "--requirements",
      "Preserve the example.",
      "--",
      "--help",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).request_id).toBe("help-filename");
  }));
for (const client of ["codex", "claude"] as const) {
  it(`checks ${client} launcher drift and missing paths without reading Rebut settings or writing host files`, async () =>
    fixture(async (dir) => {
      const home = join(dir, "host");
      const config = join(
        home,
        client === "codex" ? "config.toml" : ".claude.json",
      );
      const selector =
        client === "codex"
          ? ["--codex-home", home]
          : ["--claude-config", config];
      const args = ["setup", "--check", "--client", client, ...selector];
      const settings = join(dir, "settings");
      await mkdir(settings);
      await writeFile(join(settings, "config.json"), "{invalid");
      const check = () => {
        const r = cli(dir, args);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).not.toContain(fixtureToken);
        return JSON.parse(r.stdout);
      };
      expect(check()).toMatchObject({
        client,
        configPath: config,
        status: "not_registered",
      });
      await expect(stat(home)).rejects.toThrow();
      await mkdir(home);
      const observe = async (registration: Record<string, unknown>) => {
        const document = {
          [client === "codex" ? "mcp_servers" : "mcpServers"]: {
            rebut: registration,
          },
        };
        const source =
          client === "codex" ? stringify(document) : JSON.stringify(document);
        await writeFile(config, source, { mode: 0o600 });
        const result = check();
        expect(await readFile(config, "utf8")).toBe(source);
        return result;
      };
      const entrypoint = await realpath(resolve("bin/rebut.mjs"));
      const current = {
        command: process.execPath,
        args: [entrypoint, "mcp", "--client", client],
      };
      expect(await observe(current)).toMatchObject({
        status: "current_launcher",
      });
      if (process.platform !== "win32") {
        const linkedNode = join(home, basename(process.execPath));
        await symlink(process.execPath, linkedNode);
        expect(
          await observe({ ...current, command: linkedNode }),
        ).toMatchObject({
          status: "current_launcher",
        });
      }
      expect(
        await observe({ ...current, args: [entrypoint, "mcp"] }),
      ).toMatchObject({ status: "different_launcher" });
      expect(
        await observe({
          ...current,
          command: join(dir, "missing", basename(process.execPath)),
        }),
      ).toMatchObject({
        status: "missing_launcher",
        launcher: { node: "missing", package: "present" },
      });
      expect(
        await observe({ url: "https://example.invalid/", token: fixtureToken }),
      ).toMatchObject({ status: "custom_registration" });
      if (client === "codex")
        expect(await observe({ ...current, enabled: false })).toMatchObject({
          status: "disabled",
        });
      const invalid = cli(dir, [...args, "--replace"]);
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain("Choose --check or --replace");
      expect(cli(dir, ["remove", ...args.slice(1)]).status).toBe(1);
      await writeFile(config, "{invalid", { mode: 0o600 });
      const malformed = cli(dir, args);
      expect(malformed.status).toBe(1);
      expect(malformed.stderr).toContain(
        `${client === "codex" ? "Codex" : "Claude"} config`,
      );
      expect(malformed.stderr).not.toContain("{invalid");
      const oversized = 8 * 1024 * 1024 + 1;
      await truncate(config, oversized);
      const limited = cli(dir, args);
      expect(limited.status).toBe(1);
      expect(limited.stderr).toContain("config exceeds 8 MiB");
      expect((await stat(config)).size).toBe(oversized);
      expect(await readdir(settings)).toEqual(["config.json"]);
      expect((await readdir(home)).sort()).toEqual(
        (process.platform === "win32"
          ? [basename(config)]
          : [basename(config), basename(process.execPath)]
        ).sort(),
      );
    }));
}

it("selects v2 from criterion IDs and preserves the legacy bundle by default", async () =>
  fixture(async (dir) => {
    await writeFile(join(dir, "sample.ts"), "export const count = 1;\n");
    const base = [
      "collect",
      "--root",
      dir,
      "--request-id",
      "opt-in-format",
      "--requirements",
      "AC-2: Preserve order.\nAC-1: Preserve count.",
    ];
    const criteria = [
      "--criterion-id",
      "AC-2",
      "--criterion-id",
      "AC-1",
    ];
    const collect = (flags: string[]) =>
      cli(dir, [...base, ...flags, "--", "sample.ts"]);
    const result = collect(criteria);
    expect(result.status, result.stderr).toBe(0);
    const bundle = JSON.parse(result.stdout);
    expect(bundle.result_format).toEqual({
      version: 2,
      criterion_ids: ["AC-2", "AC-1"],
    });
    expect(bundle.input_sha256).toBe(await inputHash(bundle));
    const explicitV2 = collect(["--output-schema", "2", ...criteria]);
    expect(explicitV2.status, explicitV2.stderr).toBe(0);
    expect(explicitV2.stdout).toBe(result.stdout);
    const legacy = collect([]);
    const explicitV1 = collect(["--output-schema", "1"]);
    expect(legacy.status, legacy.stderr).toBe(0);
    expect(explicitV1.status, explicitV1.stderr).toBe(0);
    expect(explicitV1.stdout).toBe(legacy.stdout);
    expect(JSON.parse(legacy.stdout)).not.toHaveProperty("result_format");
    expect(JSON.parse(legacy.stdout).input_sha256).not.toBe(bundle.input_sha256);
    const missing = cli(dir, [
      ...base,
      "--output-schema",
      "2",
      "--criterion-id",
      "AC-9",
      "--",
      "sample.ts",
    ]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Each --criterion-id must appear once");
    for (const [flags, message] of [
      [["--output-schema", "2"], "Use 1 to 12 --criterion-id"],
      [["--output-schema", "1", ...criteria], "Remove --criterion-id"],
      [["--output-schema", "3"], "Use --output-schema 1 or 2"],
    ] as const) {
      const invalid = collect([...flags]);
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain(message);
    }
  }));

async function mockReviewTransport(dir: string) {
  const preload = join(dir, "review-transport.mjs");
  const callsFile = join(dir, "mock-calls");
  await writeFile(
    preload,
    `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : String(input.url ?? input);
  if (url !== "https://api.openai.com/v1/responses" && url !== "http://127.0.0.1/mcp")
    throw Error("Unexpected fixture endpoint");
  if (init?.method !== "POST") return new Response(null, { status: 405 });
  const req = JSON.parse(init.body);
  const mode = process.env.FIXTURE_MODE;
  const review = { summary: "No supported defects.", additional_evidence: [], findings: [] };
  if (url.startsWith("http://")) {
    const reply = result => Response.json({ jsonrpc: "2.0", id: req.id, result });
    if (req.method === "initialize")
      return reply({ protocolVersion: req.params.protocolVersion, capabilities: {tools:{}}, serverInfo:{name:"mock",version:"1"} });
    if (req.method.startsWith("notifications/")) return new Response(null,{status:202});
    if (req.method !== "tools/call") throw Error("Unexpected fixture method");
    appendFileSync(process.env.FIXTURE_CALLS, req.params.name + "\\n");
    if (req.params.name === "review_pending") {
      if (mode === "unsupported")
        return Response.json({ jsonrpc:"2.0", id:req.id, error:{code:-32602,message:"Unknown tool"} });
      return reply({content:[{type:"text",text:JSON.stringify({requests:[{request_id:"pending-id",status:"unknown",budget_reserved_microusd:100,budget_accounted_microusd:100}],has_more:false})}]});
    }
    if (req.params.name !== "review") throw Error("Unexpected fixture tool");
    const bundle = req.params.arguments;
    if (mode === "unexpected-format") review.requirement_coverage = [];
    if (bundle.result_format) review.requirement_coverage = bundle.result_format.criterion_ids.map(criterion_ref => ({
      criterion_ref: mode === "wrong-criterion" ? "AC-99" : criterion_ref, status:"unassessed", evidence:[],
    }));
    const payload = { status: "completed", review, input_sha256: bundle.input_sha256, result_replay_available: false };
    if (mode === "replay") delete payload.review;
    if (mode === "mismatch") payload.input_sha256 = "0".repeat(64);
    const text = mode === "malformed" ? "plain text" : JSON.stringify(payload);
    return reply({ ...(mode==="error" ? {isError:true} : {}),content:[{type:"text",text}] });
  }
  appendFileSync(process.env.FIXTURE_CALLS, "provider\\n");
  if (mode === "unknown") return new Response("synthetic invalid JSON");
  return Response.json({
    model: "gpt-6-luna",
    status: mode === "incomplete" ? "incomplete" : "completed",
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    output: [{ type: "message", role: "assistant", status: "completed",
      content: mode === "refused" ? [{type:"refusal"}] : [{type:"output_text",text:JSON.stringify(review)}] }],
  });
};
`,
  );
  return {
    callsFile,
    env: {
      NODE_OPTIONS: "--import=" + pathToFileURL(preload).href,
      FIXTURE_CALLS: callsFile,
      REBUT_OPENAI_API_KEY: "synthetic-local-provider-key-not-real",
    },
  };
}

async function reviewFixture(request_id: string) {
  const input = {
    schema_version: 2 as const,
    provider: "openai" as const,
    request_id,
    profile: "luna-test",
    task_kind: "code" as const,
    requirements: "Preserve input.",
    files: [{ path: "sample.ts", start_line: 1, content: "return input;" }],
    diff: "",
  };
  return JSON.stringify({ ...input, input_sha256: await inputHash(input) });
}

it(
  "uses strict exit status for local reviews without replaying or discarding stdout",
  async () =>
    fixture(async (dir) => {
      expect(cli(dir, ["set", "secret-store", "env"]).status).toBe(0);
      const { env, callsFile } = await mockReviewTransport(dir);
      const review = async (id: string, mode: string, strict = true) =>
        cli(
          dir,
          ["review", ...(strict ? ["--strict-exit"] : [])],
          await reviewFixture(id),
          { ...env, FIXTURE_MODE: mode },
        );
      const completed = await review("strict-fresh", "completed");
      expect(completed.status, completed.stderr).toBe(0);
      const original = JSON.parse(JSON.parse(completed.stdout).content[0].text);
      expect(original).toMatchObject({
        status: "completed",
        review: { findings: [] },
        result_replay_available: false,
      });
      const replay = await review("strict-fresh", "completed");
      expect(replay.status).toBe(1);
      expect(replay.stderr).toContain("original request ID");
      const normal = await review("strict-fresh", "completed", false);
      expect(normal.status).toBe(0);
      expect(normal.stdout).toBe(replay.stdout);
      expect(
        JSON.parse(JSON.parse(replay.stdout).content[0].text),
      ).not.toHaveProperty("review");
      for (const state of ["incomplete", "refused", "unknown"]) {
        const result = await review("strict-" + state, state);
        expect(result.status).toBe(1);
        expect(
          JSON.parse(JSON.parse(result.stdout).content[0].text).status,
        ).toBe(state);
      }
      expect((await readFile(callsFile, "utf8")).trim().split("\n")).toEqual(
        Array(4).fill("provider"),
      );
    }),
  20000,
);

it(
  "guards Worker review envelopes and unwraps pending status without calling review",
  async () =>
    fixture(async (dir) => {
      expect(cli(dir, ["set", "endpoint", "http://127.0.0.1/mcp"]).status).toBe(
        0,
      );
      expect(cli(dir, ["set", "secret-store", "env"]).status).toBe(0);
      const { env, callsFile } = await mockReviewTransport(dir);
      const bundle = await reviewFixture("worker-strict-fixture");
      const review = (mode: string, strict = true) =>
        cli(dir, ["review", ...(strict ? ["--strict-exit"] : [])], bundle, {
          ...env,
          FIXTURE_MODE: mode,
        });
      const success = review("completed");
      expect(success.status, success.stderr).toBe(0);
      for (const mode of ["error", "malformed", "replay", "mismatch", "unexpected-format"]) {
        const strict = review(mode);
        const normal = review(mode, false);
        expect(strict.status).toBe(1);
        expect(normal.status).toBe(0);
        expect(strict.stdout).toBe(normal.stdout);
      }
      const extended = {
        ...JSON.parse(bundle),
        requirements: "AC-1: Preserve input.",
        result_format: { version: 2, criterion_ids: ["AC-1"] },
      };
      extended.input_sha256 = await inputHash(extended);
      for (const [mode, expected] of [
        ["completed", 0],
        ["wrong-criterion", 1],
      ] as const) {
        const result = cli(
          dir,
          ["review", "--strict-exit"],
          JSON.stringify(extended),
          {
            ...env,
            FIXTURE_MODE: mode,
          },
        );
        expect(result.status, result.stderr).toBe(expected);
      }
      const pending = cli(dir, ["status", "--pending"], undefined, {
        ...env,
        FIXTURE_MODE: "pending",
      });
      expect(pending.status, pending.stderr).toBe(0);
      expect(JSON.parse(pending.stdout)).toMatchObject({
        backend: "worker",
        requests: [{ request_id: "pending-id", budget_reserved_microusd: 100 }],
        has_more: false,
      });
      const unsupported = cli(dir, ["status", "--pending"], undefined, {
        ...env,
        FIXTURE_MODE: "unsupported",
      });
      expect(unsupported.status).toBe(1);
      expect(unsupported.stderr).toContain("Worker pending status unavailable");
      expect((await readFile(callsFile, "utf8")).trim().split("\n")).toEqual([
        ...Array(13).fill("review"),
        "review_pending",
        "review_pending",
      ]);
    }),
  25000,
);
