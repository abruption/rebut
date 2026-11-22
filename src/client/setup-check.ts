import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type { McpClient } from "./settings.js";

type FileObservation =
  | { status: "present"; path: string }
  | { status: "missing" | "not_file" | "unverified" };

async function observeFile(path: string): Promise<FileObservation> {
  // A registration can contain an explicit Windows network share.
  if (process.platform === "win32" && /^[\\/]{2}/.test(path))
    return { status: "unverified" };
  try {
    const target = await realpath(path);
    return (await stat(target)).isFile()
      ? { status: "present", path: target }
      : { status: "not_file" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      status:
        code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unverified",
    };
  }
}

function samePath(first: string, second: string) {
  const a = resolve(first),
    b = resolve(second);
  return process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

export async function inspectLauncher(
  value: unknown,
  expected: { client: McpClient; entrypoint: string },
) {
  if (value === undefined) return { status: "not_registered" };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { status: "custom_registration" };
  const entry = value as Record<string, unknown>;
  const { command, args, type } = entry;
  if (expected.client === "codex" && entry.enabled === false)
    return { status: "disabled" };
  if (
    (type !== undefined && type !== "stdio") ||
    entry.url !== undefined ||
    typeof command !== "string" ||
    !isAbsolute(command) ||
    (!/^node(?:\.exe)?$/i.test(basename(command)) &&
      !samePath(command, process.execPath)) ||
    !Array.isArray(args) ||
    typeof args[0] !== "string" ||
    !isAbsolute(args[0]) ||
    !/[\\/]bin[\\/]rebut\.mjs$/i.test(args[0]) ||
    args[1] !== "mcp" ||
    (args.length !== 2 &&
      (args.length !== 4 ||
        args[2] !== "--client" ||
        args[3] !== expected.client))
  )
    return { status: "custom_registration" };

  const [node, pkg] = await Promise.all([
    observeFile(command),
    observeFile(args[0]),
  ]);
  const launcher = { node: node.status, package: pkg.status };
  if (
    node.status === "missing" ||
    node.status === "not_file" ||
    pkg.status === "missing" ||
    pkg.status === "not_file"
  )
    return { status: "missing_launcher", launcher };
  if (node.status !== "present" || pkg.status !== "present")
    return { status: "unverified_launcher", launcher };
  const currentNode = await observeFile(process.execPath);
  if (currentNode.status !== "present")
    return { status: "unverified_launcher", launcher };
  const current =
    args.length === 4 &&
    samePath(node.path, currentNode.path) &&
    samePath(pkg.path, expected.entrypoint);
  return {
    status: current ? "current_launcher" : "different_launcher",
    launcher,
  };
}
