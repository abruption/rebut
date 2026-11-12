import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "smol-toml";
import { removeCodex, setupCodex } from "../src/client/codex.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const roots: string[] = [];
async function fixture(source?: string) {
  const base = process.cwd().startsWith("/Volumes/Kingston NV/")
    ? "/Volumes/Kingston NV/tmp"
    : process.cwd().startsWith("/Volumes/Samsung T5/")
      ? "/Volumes/Samsung T5/tmp"
      : tmpdir();
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "codex-rebut-setup-"));
  await chmod(root, 0o700);
  roots.push(root);
  const codexHome = join(root, "home with spaces");
  const configPath = join(codexHome, "config.toml");
  if (source !== undefined) {
    await mkdir(codexHome, { mode: 0o700 });
    await writeFile(configPath, source, { mode: 0o600 });
  }
  return {
    options: {
      codexHome,
      entrypoint: join(root, "package with spaces", "bin", "rebut.mjs"),
      nodePath: "/usr/local/bin/node",
    },
    configPath,
  };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("portable Codex setup", () => {
  it("creates only the enabled Rebut server with absolute stdio arguments and private permissions", async () => {
    const { options, configPath } = await fixture();
    expect(await setupCodex(options)).toEqual({ configPath, changed: true });
    const document = parse(await readFile(configPath, "utf8"));
    expect(document).toEqual({
      mcp_servers: {
        rebut: {
          command: options.nodePath,
          args: [options.entrypoint, "mcp"],
          startup_timeout_sec: 60,
          tool_timeout_sec: 75,
          enabled_tools: ["review", "review_status"],
        },
      },
    });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect((await stat(options.codexHome)).mode & 0o777).toBe(0o700);
  });

  it("forwards only the token variable name without writing any credential values", async () => {
    vi.stubEnv("REBUT_TOKEN", "test-secret-token-value");
    vi.stubEnv("BW_PASSWORD", "test-secret-password-value");
    vi.stubEnv("BW_SESSION", "test-secret-session-value");
    const { options, configPath } = await fixture();
    const settings = { ...options, forwardTokenEnv: true };
    await setupCodex(settings);
    const raw = await readFile(configPath, "utf8");
    const server = (parse(raw).mcp_servers as Record<string, unknown>).rebut;
    expect(server).toEqual({
      command: options.nodePath,
      args: [options.entrypoint, "mcp"],
      startup_timeout_sec: 60,
      tool_timeout_sec: 75,
      enabled_tools: ["review", "review_status"],
      env_vars: ["REBUT_TOKEN"],
    });
    for (const secret of [
      "test-secret-token-value",
      "test-secret-password-value",
      "test-secret-session-value",
      "BW_PASSWORD",
      "BW_SESSION",
    ]) {
      expect(raw).not.toContain(secret);
    }
    expect((await setupCodex(settings)).changed).toBe(false);
  });

  it("persists only the explicit nonsecret configuration directory as an absolute path", async () => {
    const { options, configPath } = await fixture();
    const configDir = "relative settings directory";
    const settings = { ...options, configDir };
    await setupCodex(settings);
    const server = (
      parse(await readFile(configPath, "utf8")).mcp_servers as Record<
        string,
        unknown
      >
    ).rebut;
    expect(server).toHaveProperty("env", {
      REBUT_CONFIG_DIR: resolve(configDir),
    });
    expect(server).not.toHaveProperty("env_vars");
    expect((await setupCodex(settings)).changed).toBe(false);
    expect((await removeCodex(settings)).changed).toBe(true);
  });

  it("preserves unrelated comments, sections, and secrets byte for byte and is idempotent", async () => {
    const source =
      '# custom settings\nmodel = "gpt-6-astra"\n\n[mcp_servers.other]\ncommand = "other" # keep\n[mcp_servers.other.env]\nTOKEN = "private-value"\n\n[profiles.work]\nmodel = "gpt-6-luna"\n';
    const { options, configPath } = await fixture(source);
    await setupCodex(options);
    const first = await readFile(configPath, "utf8");
    expect(first.startsWith(source)).toBe(true);
    expect(await setupCodex(options)).toEqual({ configPath, changed: false });
    expect(await readFile(configPath, "utf8")).toBe(first);
    expect(Object.keys(parse(first).mcp_servers as object)).toEqual([
      "other",
      "rebut",
    ]);
  });

  it("refuses conflicts without disclosing or overwriting config and replaces nested env when explicit", async () => {
    const before =
      '# keep root\n[ mcp_servers."rebut" ]\ncommand = "custom"\n[mcp_servers.rebut.env]\nAPI_TOKEN = "private-value"\n\n[mcp_servers.other]\ncommand = "other" # keep other\n';
    const { options, configPath } = await fixture(before);
    await expect(setupCodex(options)).rejects.toMatchObject({
      code: "SERVER_CONFLICT",
    });
    expect(await readFile(configPath, "utf8")).toBe(before);
    await setupCodex({ ...options, replace: true });
    const after = await readFile(configPath, "utf8");
    expect(after).toContain("# keep root\n");
    expect(after).toContain(
      '[mcp_servers.other]\ncommand = "other" # keep other\n',
    );
    expect(after).not.toContain("private-value");
    expect(
      (parse(after).mcp_servers as Record<string, unknown>).rebut,
    ).not.toHaveProperty("env");
  });

  it("rejects malformed TOML and invalid server maps without overwriting", async () => {
    for (const before of [
      'secret = "private-value"\n[broken',
      'mcp_servers = "private-value"\n',
    ]) {
      const { options, configPath } = await fixture(before);
      await expect(setupCodex(options)).rejects.toMatchObject({
        code: "INVALID_CONFIG",
      });
      expect(await readFile(configPath, "utf8")).toBe(before);
    }
  });

  it("preserves header-looking text inside multiline strings and supports inline server definitions", async () => {
    const source =
      'notes = """\n[mcp_servers.rebut]\ncommand = "pretend"\n"""\n\n[mcp_servers.other]\ncommand = "real"\n';
    const { options, configPath } = await fixture(source);
    await setupCodex(options);
    expect((await readFile(configPath, "utf8")).startsWith(source)).toBe(true);
    const inline = await fixture(
      'mcp_servers = { rebut = { command = "old" }, other = { command = "keep", env = { SECRET = "private-value" } } }\n',
    );
    await setupCodex({ ...inline.options, replace: true });
    const document = parse(await readFile(inline.configPath, "utf8"));
    expect((document.mcp_servers as Record<string, unknown>).other).toEqual({
      command: "keep",
      env: { SECRET: "private-value" },
    });
  });

  it("detects a concurrent edit and leaves the external edit intact without temporary files", async () => {
    const before = 'model = "before"\n';
    const external = 'model = "external edit"\n';
    const { options, configPath } = await fixture(before);
    vi.mocked(readFile)
      .mockResolvedValueOnce(before)
      .mockImplementationOnce(async () => {
        await writeFile(configPath, external);
        return external;
      });
    await expect(setupCodex(options)).rejects.toMatchObject({
      code: "CONFIG_CHANGED",
    });
    expect(await readFile(configPath, "utf8")).toBe(external);
    expect(await readdir(options.codexHome)).toEqual(["config.toml"]);
  });

  it("removes the owned server while preserving all other values", async () => {
    const source = '# preserve\n[mcp_servers.other]\ncommand = "other"\n';
    const { options, configPath } = await fixture(source);
    await setupCodex(options);
    expect((await removeCodex(options)).changed).toBe(true);
    expect(await readFile(configPath, "utf8")).toContain(source);
    expect(
      (
        parse(await readFile(configPath, "utf8")).mcp_servers as Record<
          string,
          unknown
        >
      ).rebut,
    ).toBeUndefined();
    expect((await removeCodex(options)).changed).toBe(false);
  });
});
