import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  readSettings,
  SettingsSchema,
  writeSettings,
} from "../src/client/settings.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    open: vi.fn(actual.open),
  };
});

const roots: string[] = [];
const settings = () =>
  SettingsSchema.parse({
    schemaVersion: 1,
    mode: "worker",
    endpoint: "https://worker.invalid/mcp",
    secretStore: "env",
    vaultwardenItem: "Rebut — MCP Access Token",
  });

async function fixture(): Promise<{ root: string; directory: string }> {
  const root = await mkdtemp(join(tmpdir(), "rebut-settings-"));
  await chmod(root, 0o700);
  roots.push(root);
  const directory = join(root, "settings");
  vi.stubEnv("REBUT_CONFIG_DIR", directory);
  return { root, directory };
}

afterEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  vi.mocked(open).mockImplementation(
    async (...args: Parameters<typeof open>) => actual.open(...args),
  );
  vi.mocked(lstat).mockImplementation(
    async (...args: Parameters<typeof lstat>) => actual.lstat(...args),
  );
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it.skipIf(process.platform === "win32")(
  "reads and replaces private settings while retaining missing-file defaults",
  async () => {
    const { directory } = await fixture();
    await expect(readSettings()).resolves.toMatchObject({ mode: "local" });
    await writeSettings(settings());
    await expect(readSettings()).resolves.toEqual(settings());
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, "config.json"))).mode & 0o777).toBe(
      0o600,
    );
  },
);

it.skipIf(process.platform === "win32")(
  "rejects writable directories and public, linked, or symlinked settings",
  async () => {
    const { directory } = await fixture();
    const path = join(directory, "config.json");
    await mkdir(directory, { mode: 0o700 });
    await chmod(directory, 0o770);
    await writeFile(path, JSON.stringify(settings()), { mode: 0o600 });
    await expect(readSettings()).rejects.toThrow("SETTINGS_UNSAFE");
    await expect(writeSettings(settings())).rejects.toThrow("SETTINGS_UNSAFE");

    await chmod(directory, 0o700);
    await chmod(path, 0o640);
    await expect(readSettings()).rejects.toThrow("SETTINGS_UNSAFE");

    await chmod(path, 0o600);
    const hardlink = join(directory, "linked.json");
    await link(path, hardlink);
    await expect(readSettings()).rejects.toThrow("SETTINGS_UNSAFE");
    await unlink(hardlink);

    const target = join(directory, "target.json");
    await rename(path, target);
    await symlink(target, path);
    await expect(readSettings()).rejects.toThrow("SETTINGS_UNSAFE");
  },
);

it.skipIf(process.platform === "win32")(
  "refuses to create settings beneath a writable ancestor",
  async () => {
    const { root, directory } = await fixture();
    await chmod(root, 0o770);
    await expect(writeSettings(settings())).rejects.toThrow("SETTINGS_UNSAFE");
    await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a settings directory not owned by the current user",
  async () => {
    const { directory } = await fixture();
    const path = join(directory, "config.json");
    await mkdir(directory, { mode: 0o700 });
    await writeFile(path, JSON.stringify(settings()), { mode: 0o600 });
    const actual = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    const uid = process.getuid!();
    vi.mocked(lstat).mockImplementation(
      async (...args: Parameters<typeof lstat>) => {
        const result = await actual.lstat(...args);
        if (resolve(String(args[0])) !== resolve(directory)) return result;
        return new Proxy(result, {
          get(target, property, receiver) {
            if (property === "uid") return uid === 0 ? 1 : 0;
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    );
    await expect(readSettings()).rejects.toThrow("SETTINGS_UNSAFE");
    await expect(writeSettings(settings())).rejects.toThrow("SETTINGS_UNSAFE");
  },
);

it.skipIf(process.platform === "win32")(
  "detects settings replacement between pathname inspection and descriptor open",
  async () => {
    const { directory } = await fixture();
    await mkdir(directory, { mode: 0o700 });
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify(settings()), { mode: 0o600 });
    const actual = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    let replaced = false;
    vi.mocked(open).mockImplementation(
      async (...args: Parameters<typeof open>) => {
        if (!replaced && resolve(String(args[0])) === resolve(path)) {
          replaced = true;
          await rename(path, join(directory, "observed.json"));
          await writeFile(
            path,
            JSON.stringify({
              ...settings(),
              endpoint: "https://attacker.invalid/mcp",
            }),
            { mode: 0o600 },
          );
        }
        return actual.open(...args);
      },
    );
    await expect(readSettings()).rejects.toThrow("SETTINGS_UNSAFE");
    expect(replaced).toBe(true);
    expect(await readFile(path, "utf8")).toContain("attacker.invalid");
  },
);

it.skipIf(process.platform === "win32")(
  "detects directory replacement before opening its stable descriptor",
  async () => {
    const { root, directory } = await fixture();
    await mkdir(directory, { mode: 0o700 });
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify(settings()), { mode: 0o600 });
    const actual = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    let replaced = false;
    vi.mocked(open).mockImplementation(
      async (...args: Parameters<typeof open>) => {
        if (!replaced && resolve(String(args[0])) === resolve(directory)) {
          replaced = true;
          await rename(directory, join(root, "observed-settings"));
          await mkdir(directory, { mode: 0o700 });
          await writeFile(
            path,
            JSON.stringify({
              ...settings(),
              endpoint: "https://attacker.invalid/mcp",
            }),
            { mode: 0o600 },
          );
        }
        return actual.open(...args);
      },
    );
    await expect(readSettings()).rejects.toThrow("SETTINGS_UNSAFE");
    expect(replaced).toBe(true);
  },
);
