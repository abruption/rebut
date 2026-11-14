import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { loadToken, storeToken } from "../src/client/secrets.js";
import { writeSettings } from "../src/client/settings.js";
import { runCli } from "../src/cli.js";
const data = vi.hoisted(() => ({
  values: new Map<string, string>(),
  accounts: [] as string[],
}));
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(
    (executable: string, _args: unknown, options: { input: string }) => {
      if (executable !== "/usr/bin/osascript")
        throw Error("Unexpected executable");
      const request = JSON.parse(options.input);
      data.accounts.push(request.account);
      if (request.action === "store")
        data.values.set(request.account, request.value);
      return {
        status: 0,
        stdout: JSON.stringify({
          status: 0,
          value: data.values.get(request.account),
        }),
      };
    },
  ),
}));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  data.values.clear();
  data.accounts = [];
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
it.skipIf(process.platform !== "darwin")(
  "uses separate Keychain accounts and the existing api-key stdin flow without a real Keychain call",
  async () => {
    const base = process.cwd().startsWith("/Volumes/Kingston NV/")
      ? "/Volumes/Kingston NV/tmp"
      : tmpdir();
    const dir = await mkdtemp(join(base, "codex-provider-keychain-"));
    await chmod(dir, 0o700);
    roots.push(dir);
    vi.stubEnv("REBUT_CONFIG_DIR", dir);
    const settings = {
      schemaVersion: 1 as const,
      provider: "anthropic" as const,
      mode: "local" as const,
      secretStore: "keychain" as const,
      vaultwardenItem: "unused",
      vaultwardenAdminItem: "unused",
    };
    await writeSettings(settings);
    const key = "synthetic-anthropic-key-not-real-123456789";
    vi.spyOn(process, "stdin", "get").mockReturnValue(
      Readable.from([key + "\n"]) as typeof process.stdin,
    );
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runCli(["set", "api-key", "--stdin"]);
    expect(data.values.get("anthropic-api-key")).toBe(key);
    expect(data.values.has("openai-api-key")).toBe(false);
    expect(output.mock.calls.flat().join("")).not.toContain(key);
    const other = "synthetic-openai-key-not-real-123456789";
    await storeToken(other, settings, "provider", "openai");
    expect(await loadToken(settings, "provider", "openai")).toBe(other);
    expect(await loadToken(settings, "provider", "anthropic")).toBe(key);
    expect(data.accounts).not.toContain("codex-mcp-admin");
  },
);
