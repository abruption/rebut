import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  chmod,
  stat,
  readdir,
  symlink,
  link,
  open,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupClaude, removeClaude } from "../src/client/claude.js";
const state = vi.hoisted(() => ({ home: undefined as string | undefined }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => state.home!,
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const roots: string[] = [];
const base = process.cwd().startsWith("/Volumes/Kingston NV/")
  ? "/Volumes/Kingston NV/tmp"
  : tmpdir();
async function fixture(source?: string) {
  const root = await mkdtemp(join(base, "codex-claude-setup-"));
  await chmod(root, 0o700);
  roots.push(root);
  state.home = root;
  const path = join(root, ".claude.json");
  if (source !== undefined) await writeFile(path, source, { mode: 0o600 });
  return {
    root,
    path,
    options: {
      claudeConfig: path,
      entrypoint: join(root, "package with spaces/bin/rebut.mjs"),
      nodePath: "/runtime/node",
    },
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  state.home = undefined;
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
it("creates a user-only entry at the documented default without granting permissions", async () => {
  const { path, options } = await fixture();
  vi.stubEnv("CLAUDE_CONFIG_DIR", "");
  await setupClaude({ ...options, claudeConfig: undefined });
  const value = JSON.parse(await readFile(path, "utf8"));
  expect(value.mcpServers.rebut).toMatchObject({
    type: "stdio",
    command: "/runtime/node",
    args: [options.entrypoint, "mcp"],
    timeout: 1_860_000,
  });
  expect(value).not.toHaveProperty("permissions");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});
it("preserves unrelated JSON bytes and large numeric literals across setup and remove", async () => {
  const original =
    '{\n "opaque" : 9007199254740993, "projects":{"x":{"trust":false}}, "mcpServers": {"other":{"command":"other","env":{"SECRET":"synthetic-existing-value"}}}\n}';
  const { path, options } = await fixture(original);
  await setupClaude(options);
  let text = await readFile(path, "utf8");
  expect(text).toContain('"opaque" : 9007199254740993');
  expect(text).toContain(
    '"other":{"command":"other","env":{"SECRET":"synthetic-existing-value"}}',
  );
  expect((await setupClaude(options)).changed).toBe(false);
  expect(await readFile(path, "utf8")).toBe(text);
  await removeClaude({ ...options, nodePath: "/new/runtime/node" });
  text = await readFile(path, "utf8");
  expect(text).toContain('"opaque" : 9007199254740993');
  expect(JSON.parse(text).mcpServers).not.toHaveProperty("rebut");
  expect(JSON.parse(text).projects.x.trust).toBe(false);
});
it("requires replacement acknowledgement for conflicting or unrecognized entries", async () => {
  const { path, options } = await fixture(
    '{"mcpServers":{"rebut":{"command":"different"}}}',
  );
  const before = await readFile(path, "utf8");
  await expect(setupClaude(options)).rejects.toMatchObject({
    code: "SERVER_CONFLICT",
  });
  await expect(removeClaude(options)).rejects.toMatchObject({
    code: "SERVER_CONFLICT",
  });
  expect(await readFile(path, "utf8")).toBe(before);
  await setupClaude({ ...options, replace: true });
  expect(
    JSON.parse(await readFile(path, "utf8")).mcpServers.rebut.command,
  ).toBe(options.nodePath);
  await removeClaude(options);
  expect((await removeClaude(options)).changed).toBe(false);
});
it("does not create a missing config on removal and refuses ambiguous relocated paths", async () => {
  const { path, options } = await fixture();
  expect((await removeClaude(options)).changed).toBe(false);
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  vi.stubEnv("CLAUDE_CONFIG_DIR", "/different/config");
  await expect(
    setupClaude({ ...options, claudeConfig: undefined }),
  ).rejects.toMatchObject({ code: "CONFIG_PATH_REQUIRED" });
  expect((await setupClaude(options)).changed).toBe(true);
});
it("registers variable-name placeholders only for explicit env mode and keeps the data directory", async () => {
  const { path, options } = await fixture();
  await setupClaude({
    ...options,
    forwardApiKeyEnv: true,
    apiKeyEnv: "REBUT_ANTHROPIC_API_KEY",
    configDir: "/private/settings",
  });
  let entry = JSON.parse(await readFile(path, "utf8")).mcpServers.rebut;
  expect(entry.env).toEqual({
    REBUT_CONFIG_DIR: "/private/settings",
    REBUT_ANTHROPIC_API_KEY: "${REBUT_ANTHROPIC_API_KEY:-}",
  });
  expect(JSON.stringify(entry)).not.toContain("REBUT_ADMIN_TOKEN");
  await setupClaude({ ...options, replace: true });
  entry = JSON.parse(await readFile(path, "utf8")).mcpServers.rebut;
  expect(entry.env).toBeUndefined();
  await setupClaude({ ...options, replace: true, forwardTokenEnv: true });
  expect(JSON.parse(await readFile(path, "utf8")).mcpServers.rebut.env).toEqual(
    { REBUT_TOKEN: "${REBUT_TOKEN:-}" },
  );
  await expect(
    setupClaude({
      ...options,
      forwardApiKeyEnv: true,
      apiKeyEnv: "ANTHROPIC_API_KEY",
    }),
  ).rejects.toMatchObject({ code: "INVALID_ENV" });
});
it.each([
  '{"mcpServers":{},"mcpServers":{}}',
  '{"a":{"x":1,"x":2}}',
  '{"mcpServers":{},"\\u006dcpServers":{}}',
  '{/*comment*/"mcpServers":{}}',
  '{"mcpServers":{},}',
  '{"mcpServers":[]}',
  "null",
  "[]",
  "",
])("rejects invalid/ambiguous JSON without changes: %s", async (original) => {
  const { path, options } = await fixture(original);
  await expect(setupClaude(options)).rejects.toMatchObject({
    code: "INVALID_CONFIG",
  });
  expect(await readFile(path, "utf8")).toBe(original);
});
it("rejects unsafe links, public files, oversized state and path interpolation", async () => {
  const { root, path, options } = await fixture("{}");
  await chmod(path, 0o644);
  await expect(setupClaude(options)).rejects.toMatchObject({
    code: "UNSAFE_CONFIG",
  });
  await chmod(path, 0o600);
  await link(path, join(root, "hardlink"));
  await expect(setupClaude(options)).rejects.toMatchObject({
    code: "UNSAFE_CONFIG",
  });
  await rm(join(root, "hardlink"));
  await symlink(path, join(root, "symlink"));
  await expect(
    setupClaude({ ...options, claudeConfig: join(root, "symlink") }),
  ).rejects.toMatchObject({ code: "UNSAFE_CONFIG" });
  await expect(
    setupClaude({
      ...options,
      entrypoint: "/path/${SHOULD_NOT_EXPAND}/bin/rebut.mjs",
    }),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
  await writeFile(path, '{"large":"' + "x".repeat(8 * 1024 * 1024) + '"}');
  await expect(setupClaude(options)).rejects.toMatchObject({
    code: "CONFIG_TOO_LARGE",
  });
});
it("refuses a concurrent observed write and cleans its staging file", async () => {
  const { root, path, options } = await fixture("{}");
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  let reads = 0;
  vi.mocked(open).mockImplementation(
    async (...args: Parameters<typeof open>) => {
      if (args[0] === path && ++reads === 2)
        await actual.writeFile(path, '{"concurrent":true}', { mode: 0o600 });
      return actual.open(...args);
    },
  );
  await expect(setupClaude(options)).rejects.toMatchObject({
    code: "CONFIG_CHANGED",
  });
  expect(await readFile(path, "utf8")).toBe('{"concurrent":true}');
  expect((await readdir(root)).filter((x) => x.endsWith(".tmp"))).toEqual([]);
});

it("refuses a write that would cross the readable size limit, retaining the original file", async () => {
  const prefix = '{"padding":"',
    suffix = '"}';
  const original =
    prefix +
    "x".repeat(8 * 1024 * 1024 - 80 - prefix.length - suffix.length) +
    suffix;
  const { root, path, options } = await fixture(original);
  await expect(setupClaude(options)).rejects.toMatchObject({
    code: "CONFIG_TOO_LARGE",
  });
  expect(await readFile(path, "utf8")).toBe(original);
  expect((await readdir(root)).filter((x) => x.endsWith(".tmp"))).toEqual([]);
});

it("refuses a BOM rather than silently changing unrelated source bytes", async () => {
  const source = "\ufeff{}";
  const { path, options } = await fixture(source);
  await expect(setupClaude(options)).rejects.toMatchObject({
    code: "INVALID_CONFIG",
  });
  expect(await readFile(path, "utf8")).toBe(source);
});
