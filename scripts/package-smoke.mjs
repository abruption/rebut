import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
} from "@modelcontextprotocol/server";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = root.startsWith("/Volumes/Kingston NV/")
  ? "/Volumes/Kingston NV/tmp"
  : root.startsWith("/Volumes/Samsung T5/")
    ? "/Volumes/Samsung T5/tmp"
    : tmpdir();
const directory = await mkdtemp(join(temporaryRoot, "codex-rebut-package-"));
await chmod(directory, 0o700);
const home = join(directory, "home");
const config = join(home, "settings");
const prefix = join(directory, "installed");
const token = "synthetic-package-smoke-token-not-a-real-credential";
// Do not inherit credentials, registry configuration, NODE_PATH or startup overrides.
const env = {
  HOME: home,
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  TMPDIR: directory,
  REBUT_CONFIG_DIR: config,
  REBUT_TOKEN: token,
  NPM_CONFIG_CACHE: join(directory, "cache"),
  NPM_CONFIG_USERCONFIG: join(directory, "npmrc"),
  NPM_CONFIG_GLOBALCONFIG: join(directory, "global-npmrc"),
  NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
};
const npm = process.env.npm_execpath;
assert(npm, "Run through npm run test:package so the npm CLI is explicit.");
function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    "Package smoke subprocess failed (output withheld).",
  );
  assert(
    !result.stdout.includes(token) && !result.stderr.includes(token),
    "Credential echoed.",
  );
  return result.stdout;
}
function bounded(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), 20_000);
    }),
  ]).finally(() => clearTimeout(timer));
}

let server, client, transport;
try {
  await mkdir(config, { recursive: true, mode: 0o700 });
  await writeFile(env.NPM_CONFIG_USERCONFIG, "", { mode: 0o600 });
  await writeFile(env.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });
  const [pack] = JSON.parse(
    run([npm, "pack", "--json", "--pack-destination", directory]),
  );
  const files = pack.files.map((file) => file.path);
  for (const file of [
    "bin/rebut.mjs",
    "lib/cli.mjs",
    "LICENSE",
    "README.md",
    "README.en.md",
    "README.zh-CN.md",
    "README.ja.md",
  ])
    assert(files.includes(file), `Missing packaged file: ${file}`);
  for (const file of files)
    assert(
      !/(^|\/)(?:AGENTS\.md|\.env[^/]*|\.dev\.vars[^/]*|[^/]*\.private\.json|[^/]*\.(?:review|bundle)\.json)$/.test(
        file,
      ),
      "Private artifact in package.",
    );
  run(
    [
      npm,
      "install",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      join(directory, pack.filename),
    ],
    directory,
  );
  const installed = join(prefix, "node_modules/rebut-mcp");
  const entry = join(installed, "bin/rebut.mjs");
  const pkg = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  assert.equal(run([entry, "--version"], directory).trim(), pkg.version);
  assert(run([entry, "--help"], directory).includes("rebut"));
  // Exercise the installed npm bin link as well as the absolute Node entry point.
  const bin = spawnSync(
    join(prefix, "node_modules/.bin/rebut"),
    ["--version"],
    {
      cwd: directory,
      env,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(bin.status, 0, "Installed bin link failed.");
  assert.equal(bin.stdout.trim(), pkg.version);

  const calls = [];
  let authenticatedRequests = 0;
  const handler = createMcpHandler(() => {
    const fixture = new McpServer({ name: "package-fixture", version: "1" });
    for (const name of ["review", "review_status", "unrelated_tool"])
      fixture.registerTool(
        name,
        {
          description: "Synthetic local fixture",
          inputSchema: fromJsonSchema({
            type: "object",
            properties: { request_id: { type: "string" } },
            required: ["request_id"],
          }),
        },
        async (args) => {
          calls.push({ name, args });
          assert.equal(
            name,
            "review_status",
            "Smoke must never submit a review.",
          );
          return {
            content: [{ type: "text", text: "synthetic status" }],
            structuredContent: {
              request_id: args.request_id,
              status: "completed",
            },
          };
        },
      );
    return fixture;
  });
  server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(401).end();
        return;
      }
      authenticatedRequests++;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const result = await handler.fetch(
        new Request(`http://127.0.0.1${request.url}`, {
          method: request.method,
          headers: request.headers,
          ...(body.length ? { body } : {}),
        }),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      secretStore: "env",
      vaultwardenItem: "unused synthetic fixture",
      endpoint: `http://127.0.0.1:${server.address().port}/mcp`,
    }),
    { mode: 0o600 },
  );
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, "mcp"],
    cwd: directory,
    env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", (data) => {
    stderr += data;
  });
  client = new Client({ name: "package-smoke", version: "1" });
  await bounded(client.connect(transport), "MCP initialize");
  const tools = await bounded(client.listTools(), "MCP tools/list");
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "review",
    "review_status",
  ]);
  const requestId = "synthetic-existing-request";
  const result = await bounded(
    client.callTool({
      name: "review_status",
      arguments: { request_id: requestId },
    }),
    "MCP review_status",
  );
  assert.deepEqual(result.structuredContent, {
    request_id: requestId,
    status: "completed",
  });
  assert.deepEqual(calls, [
    { name: "review_status", args: { request_id: requestId } },
  ]);
  assert(authenticatedRequests > 0);
  const closed = new Promise((resolve) => {
    client.onclose = resolve;
  });
  const pid = transport.pid;
  process.kill(pid, "SIGTERM");
  await bounded(closed, "MCP SIGTERM shutdown");
  assert.throws(
    () => process.kill(pid, 0),
    { code: "ESRCH" },
    "MCP child still running after shutdown.",
  );
  assert(!stderr.includes(token), "Credential echoed in stderr.");
  console.log(
    "Packed artifact: isolated install, bin, stdio handshake, filtered tools, authenticated status and SIGTERM passed; no provider calls.",
  );
} finally {
  await client?.close();
  await transport?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
