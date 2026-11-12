import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  lstat,
  chmod,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateEndpoint } from "./connection.js";
export const SettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    endpoint: z.string().max(2048).optional(),
    secretStore: z.enum(["keychain", "vaultwarden", "env"]),
    vaultwardenItem: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => !/[\x00-\x1f\x7f]/.test(s)),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;
export function settingsPath(): string {
  return join(
    process.env.REBUT_CONFIG_DIR
      ? resolve(process.env.REBUT_CONFIG_DIR)
      : process.platform === "win32"
        ? join(process.env.APPDATA || homedir(), "Rebut")
        : join(homedir(), ".config", "rebut"),
    "config.json",
  );
}
export async function readSettings(): Promise<Settings> {
  try {
    const path = settingsPath();
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error();
    const data = SettingsSchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (data.endpoint) validateEndpoint(data.endpoint);
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        schemaVersion: 1,
        secretStore: process.platform === "darwin" ? "keychain" : "env",
        vaultwardenItem: "Rebut — MCP Access Token",
      };
    throw new Error("SETTINGS_INVALID");
  }
}
export async function writeSettings(value: Settings): Promise<void> {
  const checked = SettingsSchema.parse(value);
  if (checked.endpoint) validateEndpoint(checked.endpoint);
  const path = settingsPath(),
    dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("SETTINGS_UNSAFE");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(dir, ".config-" + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(checked, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
