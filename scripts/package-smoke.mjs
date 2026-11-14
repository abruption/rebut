import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
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
function run(args, cwd = root, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: { ...env, ...extraEnv },
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

let server, client, transport, cliProcess;
try {
  await mkdir(config, { recursive: true, mode: 0o700 });
  await writeFile(env.NPM_CONFIG_USERCONFIG, "", { mode: 0o600 });
  await writeFile(env.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });
  const suppliedDirectory = process.env.REBUT_SMOKE_ARTIFACT_DIR
    ? resolve(root, process.env.REBUT_SMOKE_ARTIFACT_DIR)
    : undefined;
  const [pack] = JSON.parse(
    suppliedDirectory
      ? await readFile(join(suppliedDirectory, "pack.json"), "utf8")
      : run([npm, "pack", "--json", "--pack-destination", directory]),
  );
  assert(/^rebut-mcp-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/.test(pack.filename));
  const tarball = join(suppliedDirectory ?? directory, pack.filename);
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
      tarball,
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

  await client.close();
  await transport.close();
  const localKey = "synthetic-local-api-key-not-a-real-key-123456789";
  const localEnv = { ...env, REBUT_OPENAI_API_KEY: localKey };
  const preload = join(directory, "synthetic-provider.mjs");
  await writeFile(
    preload,
    `
    globalThis.fetch=async(input,init)=>{
      const url=input instanceof Request?input.url:String(input);
      if(url!=='https://api.openai.com/v1/responses')throw Error('Unexpected external request');
      if(new Headers(init.headers).get('authorization')!=='Bearer '+process.env.REBUT_OPENAI_API_KEY)throw Error('Wrong credential role');
      const body=JSON.parse(init.body);
      if(process.env.REBUT_SMOKE_STALL==='1'){
        const {writeFile}=await import('node:fs/promises');
        await writeFile(process.env.REBUT_SMOKE_MARKER,'1');
        return new Promise(()=>{});
      }
      return new Response(JSON.stringify({id:'resp_packaged_local',model:body.model,status:'completed',usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:5}},output:[{type:'message',role:'assistant',status:'completed',phase:'final_answer',content:[{type:'output_text',text:JSON.stringify({summary:'Synthetic local package review',findings:[],additional_evidence:[]})}]}]}),{headers:{'x-request-id':'req_packaged_local'}});
    };
  `,
    { mode: 0o600 },
  );
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      secretStore: "env",
      vaultwardenItem: "unused synthetic",
    }),
    { mode: 0o600 },
  );
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", preload, entry, "mcp"],
    cwd: directory,
    env: localEnv,
    stderr: "pipe",
  });
  let localStderr = "";
  transport.stderr.on("data", (data) => {
    localStderr += data;
  });
  client = new Client({ name: "local-package-smoke", version: "1" });
  await bounded(client.connect(transport), "Local MCP initialize");
  assert.deepEqual(
    (await client.listTools()).tools.map((t) => t.name),
    ["review", "review_status"],
  );
  const bundle = {
    schema_version: 1,
    task_kind: "code",
    requirements: "Synthetic only",
    files: [
      { path: "sample.ts", start_line: 1, content: "export const value = 1;" },
    ],
    diff: "",
  };
  const frozen = {
    ...bundle,
    request_id: "local-package-smoke",
    profile: "luna-test",
    input_sha256: createHash("sha256")
      .update(JSON.stringify(bundle))
      .digest("hex"),
  };
  const localResult = await bounded(
    client.callTool({ name: "review", arguments: frozen }),
    "Local synthetic review",
  );
  const localOutcome = JSON.parse(localResult.content[0].text);
  assert.equal(localOutcome.status, "completed");
  assert.equal(localOutcome.actual_model, "gpt-6-luna");
  const localStatus = JSON.parse(
    (
      await client.callTool({
        name: "review_status",
        arguments: { request_id: frozen.request_id },
      })
    ).content[0].text,
  );
  assert.equal(localStatus.status, "completed");
  assert(!localStatus.review);
  const localClosed = new Promise((resolve) => {
    client.onclose = resolve;
  });
  const localPid = transport.pid;
  process.kill(localPid, "SIGTERM");
  await bounded(localClosed, "Local MCP shutdown");
  assert.throws(() => process.kill(localPid, 0), { code: "ESRCH" });
  assert(!localStderr.includes(localKey) && !localStderr.includes(token));
  // Restarted status lookup needs no OpenAI key and cannot make a provider call.
  const restart = spawnSync(
    process.execPath,
    [entry, "status", frozen.request_id],
    { cwd: directory, env, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(restart.status, 0);
  assert.equal(
    JSON.parse(JSON.parse(restart.stdout).content[0].text).status,
    "completed",
  );
  // Exercise SIGTERM during provider execution in a real installed child.
  const markerFile = join(directory, "synthetic-provider-entered");
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", preload, entry, "mcp"],
    cwd: directory,
    env: {
      ...localEnv,
      REBUT_SMOKE_STALL: "1",
      REBUT_SMOKE_MARKER: markerFile,
    },
    stderr: "pipe",
  });
  transport.stderr.on("data", () => {});
  client = new Client({ name: "local-interrupted-smoke", version: "1" });
  await bounded(client.connect(transport), "Interrupted local initialize");
  const interrupted = { ...frozen, request_id: "local-package-interrupted" };
  const interruptedCall = client
    .callTool({ name: "review", arguments: interrupted })
    .then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  await bounded(
    (async () => {
      for (;;) {
        try {
          await readFile(markerFile);
          return;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    })(),
    "Synthetic provider start",
  );
  const interruptedClosed = new Promise((resolve) => {
    client.onclose = resolve;
  });
  const interruptedPid = transport.pid;
  process.kill(interruptedPid, "SIGTERM");
  await bounded(interruptedClosed, "In-flight local shutdown");
  await bounded(interruptedCall, "Interrupted caller completion");
  assert.throws(() => process.kill(interruptedPid, 0), { code: "ESRCH" });
  const interruptedStatus = spawnSync(
    process.execPath,
    [entry, "status", interrupted.request_id],
    { cwd: directory, env, encoding: "utf8", timeout: 15000 },
  );
  assert.equal(interruptedStatus.status, 0);
  const recorded = JSON.parse(
    JSON.parse(interruptedStatus.stdout).content[0].text,
  );
  assert.equal(recorded.status, "unknown");
  assert.equal(recorded.unknown_reason, "execution_aborted");
  assert.equal(
    recorded.budget_accounted_microusd,
    recorded.budget_reserved_microusd,
  );
  assert.equal((await readFile(markerFile, "utf8")).trim(), "1");
  const cliConfig = join(home, "cli-interrupted-settings");
  await mkdir(cliConfig, { mode: 0o700 });
  await writeFile(
    join(cliConfig, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      secretStore: "env",
      vaultwardenItem: "unused",
    }),
    { mode: 0o600 },
  );
  const cliMarker = join(directory, "synthetic-cli-provider-entered");
  const cliEnv = {
    ...localEnv,
    REBUT_CONFIG_DIR: cliConfig,
    REBUT_SMOKE_STALL: "1",
    REBUT_SMOKE_MARKER: cliMarker,
  };
  cliProcess = spawn(process.execPath, ["--import", preload, entry, "review"], {
    cwd: directory,
    env: cliEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let cliOutput = "",
    cliErrors = "";
  cliProcess.stdout.on("data", (data) => {
    cliOutput += data;
  });
  cliProcess.stderr.on("data", (data) => {
    cliErrors += data;
  });
  const cliExit = new Promise((resolve, reject) => {
    cliProcess.once("close", resolve);
    cliProcess.once("error", reject);
  });
  const cliBundle = { ...frozen, request_id: "local-cli-interrupted" };
  cliProcess.stdin.end(JSON.stringify(cliBundle));
  await bounded(
    (async () => {
      for (;;) {
        try {
          await readFile(cliMarker);
          return;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    })(),
    "CLI provider start",
  );
  cliProcess.kill("SIGTERM");
  assert.equal(await bounded(cliExit, "In-flight CLI shutdown"), 143);
  assert(!cliOutput.includes(localKey) && !cliErrors.includes(localKey));
  const cliStatus = spawnSync(
    process.execPath,
    [entry, "status", cliBundle.request_id],
    {
      cwd: directory,
      env: { ...env, REBUT_CONFIG_DIR: cliConfig },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(cliStatus.status, 0);
  const cliRecorded = JSON.parse(JSON.parse(cliStatus.stdout).content[0].text);
  assert.equal(cliRecorded.status, "unknown");
  assert.equal(cliRecorded.unknown_reason, "execution_aborted");
  assert.equal(
    cliRecorded.budget_accounted_microusd,
    cliRecorded.budget_reserved_microusd,
  );
  assert.equal((await readFile(cliMarker, "utf8")).trim(), "1");
  const doctor = spawnSync(process.execPath, [entry, "doctor", "--connect"], {
    cwd: directory,
    env: localEnv,
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(doctor.status, 0);
  const health = JSON.parse(doctor.stdout);
  assert.equal(health.mode, "local");
  assert.deepEqual(health.localTools, ["review", "review_status"]);
  const ledger = await readFile(join(config, "local", "ledger.sqlite"));
  assert(!ledger.includes(Buffer.from(localKey)));
  assert(!ledger.includes(Buffer.from("Synthetic local package review")));
  console.log(
    "Packed local artifact: no endpoint, isolated SQLite, synthetic API-key role, review/status, restart, in-flight MCP/CLI SIGTERM settlement and doctor passed; real provider calls: zero.",
  );
  // Claude host registration and provider are exercised from the actual installed tarball.
  const anthropicConfig = join(home, "anthropic-settings");
  const anthropicKey = "synthetic-anthropic-package-key-not-real-123456789";
  const anthropicEnv = {
    REBUT_CONFIG_DIR: anthropicConfig,
    REBUT_ANTHROPIC_API_KEY: anthropicKey,
  };
  run([entry, "set", "provider", "anthropic"], directory, anthropicEnv);
  run([entry, "set", "secret-store", "env"], directory, anthropicEnv);
  const claudeConfig = join(home, "claude-user.json");
  run(
    [entry, "setup", "--client", "claude", "--claude-config", claudeConfig],
    directory,
    anthropicEnv,
  );
  const registered = JSON.parse(await readFile(claudeConfig, "utf8")).mcpServers
    .rebut;
  assert.equal(registered.timeout, 1_860_000);
  assert.equal(
    registered.env.REBUT_ANTHROPIC_API_KEY,
    "${REBUT_ANTHROPIC_API_KEY:-}",
  );
  assert(!JSON.stringify(registered).includes(anthropicKey));
  assert(
    !registered.env.ANTHROPIC_API_KEY && !registered.env.REBUT_ADMIN_TOKEN,
  );
  const anthroPreload = join(directory, "synthetic-anthropic.mjs");
  const anthroMarker = join(directory, "anthropic-calls");
  await writeFile(
    anthroPreload,
    `
    import {appendFile} from 'node:fs/promises';
    globalThis.fetch=async(input,init)=>{
      const url=input instanceof Request?input.url:String(input);
      const headers=new Headers(init?.headers);
      if(headers.get('x-api-key')!==process.env.REBUT_ANTHROPIC_API_KEY)throw Error('Wrong provider credential');
      if(url==='https://api.anthropic.com/v1/models/claude-opus-5-5' && init.method==='GET'){
        await appendFile(${JSON.stringify(anthroMarker)},'metadata\\n');
        return new Response(JSON.stringify({id:'claude-opus-5-5'}));
      }
      if(url!=='https://api.anthropic.com/v1/messages'||init.method!=='POST')throw Error('Unexpected external request');
      await appendFile(${JSON.stringify(anthroMarker)},'review\\n');
      const body=JSON.parse(init.body);
      return new Response(JSON.stringify({id:'msg_packaged',type:'message',role:'assistant',model:body.model,stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:20},content:[{type:'text',text:JSON.stringify({summary:'Synthetic Claude package review',findings:[],additional_evidence:[]})}]}),{headers:{'request-id':'req_packaged_claude'}});
    };`,
    { mode: 0o600 },
  );
  await client.close();
  await transport.close();
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", anthroPreload, entry, "mcp"],
    cwd: directory,
    env: { ...env, ...anthropicEnv },
    stderr: "pipe",
  });
  let anthropicStderr = "";
  transport.stderr.on("data", (data) => {
    anthropicStderr += data;
  });
  const fixtureSyntax = spawnSync(
    process.execPath,
    ["--check", anthroPreload],
    { env, encoding: "utf8" },
  );
  assert.equal(
    fixtureSyntax.status,
    0,
    "Synthetic Anthropic fixture syntax failed.",
  );
  client = new Client({ name: "anthropic-package-smoke", version: "1" });
  await bounded(client.connect(transport), "Claude MCP initialize");
  const claudeBundle = {
    ...frozen,
    profile: "claude-medium",
    request_id: "packaged-claude",
  };
  const reviewed = JSON.parse(
    (
      await bounded(
        client.callTool({ name: "review", arguments: claudeBundle }),
        "Claude review",
      )
    ).content[0].text,
  );
  assert.equal(reviewed.status, "completed");
  assert.equal(reviewed.requested_provider, "anthropic");
  assert(!JSON.stringify(reviewed).includes(anthropicKey));
  const replayed = JSON.parse(
    (await client.callTool({ name: "review", arguments: claudeBundle }))
      .content[0].text,
  );
  assert.equal(replayed.result_replay_available, false);
  assert(!replayed.review);
  await client.close();
  await transport.close();
  const saved = JSON.parse(
    JSON.parse(
      run([entry, "status", claudeBundle.request_id], directory, {
        REBUT_CONFIG_DIR: anthropicConfig,
      }),
    ).content[0].text,
  );
  assert.equal(saved.requested_provider, "anthropic");
  const metadata = JSON.parse(
    run(
      ["--import", anthroPreload, entry, "doctor", "--provider"],
      directory,
      anthropicEnv,
    ),
  );
  assert.equal(metadata.providerDiagnostic.status, "metadata_reachable");
  assert.equal(
    (await readFile(anthroMarker, "utf8")).trim(),
    "review\nmetadata",
  );
  run(
    [entry, "remove", "--client", "claude", "--claude-config", claudeConfig],
    directory,
    anthropicEnv,
  );
  assert(!JSON.parse(await readFile(claudeConfig, "utf8")).mcpServers.rebut);
  const anthroLedger = await readFile(
    join(anthropicConfig, "local", "ledger.sqlite"),
  );
  assert(!anthroLedger.includes(Buffer.from(anthropicKey)));
  assert(
    !anthroLedger.includes(Buffer.from("Synthetic Claude package review")),
  );
  assert(!anthropicStderr.includes(anthropicKey));
  console.log(
    "Packed Claude artifact: isolated host registration/removal, provider review/status/dedup and metadata-only diagnostic passed; real provider calls: zero.",
  );
} finally {
  if (
    cliProcess &&
    cliProcess.exitCode === null &&
    cliProcess.signalCode === null
  )
    cliProcess.kill("SIGKILL");
  await client?.close();
  await transport?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
