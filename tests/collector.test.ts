import { mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
import { collect, redact } from "../scripts/collect.js";
it("collects only explicit text sources and rejects symlinks, secrets and binaries", async () => {
  const cwd = process.cwd();
  const tempBase = cwd.startsWith("/Volumes/Kingston NV/")
    ? "/Volumes/Kingston NV/tmp"
    : cwd.startsWith("/Volumes/Samsung T5/")
      ? "/Volumes/Samsung T5/tmp"
      : tmpdir();
  const root = tempBase + "/codex-rebut-test-" + randomUUID();
  await mkdir(root, { mode: 0o700 });
  try {
    await writeFile(
      root + "/a.ts",
      'const key = "sk-abcdefghijklmnopqrstuvwxyz";\n',
    );
    await writeFile(root + "/.env", "SECRET=value");
    await writeFile(root + "/binary", Buffer.from([0, 1]));
    await symlink(root + "/a.ts", root + "/link");
    execFileSync("mkfifo", [root + "/pipe"]);
    const result = await collect(root, ["a.ts"], "Check behavior", "id");
    expect(result.files[0]!.content).toContain("[REDACTED]");
    expect(result.input_sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const file of [".env", "link", "../outside", "binary", "pipe"])
      await expect(collect(root, [file], "Check", "id")).rejects.toThrow();
    expect(redact('password="abcdefgh12345"')).toContain("[REDACTED]");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("redacts quoted keys, bearer headers and multiline private values", () => {
  for (const input of [
    '{"password":"abcdefgh12345"}',
    'authorization = "Bearer abcdefgh12345"',
    "Authorization: Bearer abcdefgh12345",
    "'api_key': 'abcdefgh12345'",
    'secret="abcdefgh\n12345"',
  ]) {
    const result = redact(input);
    expect(result).not.toContain("abcdefgh");
    expect(result).not.toContain("12345");
    expect(result.split("\n")).toHaveLength(input.split("\n").length);
  }
});
