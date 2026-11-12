import { constants } from "node:fs";
import { lstat, realpath, open } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ReviewInputSchema,
  inputHash,
  safePath,
  type ReviewInput,
} from "../src/contracts.js";
const forbidden =
  /(^|\/)(\.git|node_modules|\.env(?:\..*)?|\.dev\.vars.*|\.ssh|\.aws|\.config|.*\.(pem|key|p12|pfx|sqlite|db)|(?:credentials|secrets|id_rsa|id_ed25519)(?:\..*)?)$/i;
export function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      (m) => m.replace(/[^\r\n]/g, "*"),
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED]",
    )
    .replace(
      /(["']?(?:api[_-]?key|secret|password|access[_-]?token|authorization)["']?\s*[=:]\s*)(Bearer[ \t]+[A-Za-z0-9._~+/-]+=*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"'`,;}\]]{8,})/gi,
      (_match, prefix: string, value: string) =>
        prefix + value.replace(/[^\r\n]+/g, '"[REDACTED]"'),
    );
}
async function readSafe(root: string, relative: string) {
  if (
    !safePath(relative) ||
    relative
      .split("/")
      .some((_, i, a) => forbidden.test(a.slice(0, i + 1).join("/")))
  )
    throw new Error("Disallowed source path");
  const parts = relative.split("/");
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("Symlink sources are not allowed");
  }
  const expected = await lstat(current);
  if (!expected.isFile() || expected.size > 100000)
    throw new Error("Unsupported source type or size");
  const resolved = await realpath(current);
  if (!resolved.startsWith(root + path.sep))
    throw new Error("Source escapes root");
  const handle = await open(
    current,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (stat.dev !== expected.dev || stat.ino !== expected.ino)
      throw new Error("Source changed while opening");
    if (!stat.isFile() || stat.size > 100000)
      throw new Error("Unsupported source type or size");
    const buffer = Buffer.alloc(100001);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        used,
        buffer.length - used,
        null,
      );
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > 100000 || buffer.subarray(0, used).includes(0))
      throw new Error("Oversize or binary source");
    return redact(
      new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, used),
      ),
    );
  } finally {
    await handle.close();
  }
}
export async function collect(
  root: string,
  files: string[],
  requirements: string,
  request_id: string,
  profile = "astra-medium",
): Promise<ReviewInput> {
  if (files.length === 0 || files.length > 40 || requirements.length > 16000)
    throw new Error("Collection exceeds input limits");
  if (new Set(files).size !== files.length)
    throw new Error("Duplicate source paths");
  const canonicalRoot = await realpath(root);
  const material = {
    schema_version: 1 as const,
    task_kind: "code" as const,
    requirements: redact(requirements),
    files: await Promise.all(
      files.map(async (file) => ({
        path: file,
        start_line: 1,
        content: await readSafe(canonicalRoot, file),
      })),
    ),
    diff: "",
  };
  return ReviewInputSchema.parse({
    ...material,
    request_id,
    profile,
    input_sha256: await inputHash(material),
  });
}
async function main() {
  const [root, id, requirements, ...files] = process.argv.slice(2);
  if (!root || !id || !requirements || !files.length)
    throw new Error(
      "Usage: npm run collect -- ROOT REQUEST_ID REQUIREMENTS FILE...",
    );
  // stdout only: caller chooses a protected destination. Never uploads automatically.
  process.stdout.write(
    JSON.stringify(await collect(root, files, requirements, id), null, 2) +
      "\n",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stderr.write(
      "Collection failed: check explicit paths, sizes, source type, and request fields.\n",
    );
    process.exitCode = 1;
  });
