import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parse } from "smol-toml";

const npm = process.env.npm_execpath;
assert(npm, "Run through npm run test:windows-poc.");
const repository = process.cwd();
const fixture = await mkdtemp(join(tmpdir(), "codex-rebut windows poc-"));
const configDir = join(fixture, "Rebut settings");
const prefix = join(fixture, "npm install");
const npmrc = join(fixture, "npmrc");
const apiKey = "synthetic-rebut-poc-credential-not-real-123456789";
const windows = process.platform === "win32";
const env = {
  PATH: process.env.PATH,
  HOME: fixture,
  ...(windows
    ? {
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        PATHEXT: process.env.PATHEXT,
        USERPROFILE: fixture,
        APPDATA: fixture,
        LOCALAPPDATA: fixture,
      }
    : {}),
  TMPDIR: fixture,
  TEMP: fixture,
  TMP: fixture,
  REBUT_CONFIG_DIR: configDir,
  NPM_CONFIG_USERCONFIG: npmrc,
  NPM_CONFIG_GLOBALCONFIG: join(fixture, "npm-globalrc"),
  NPM_CONFIG_CACHE: join(fixture, "npm-cache"),
  NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
};
const callOptions = { timeout: 10_000, maxTotalTimeout: 10_000 };
let client;
let failed = false;
const stderrChecks = [];

function node(args, opts = {}) {
  const { cwd = fixture, extraEnv = {}, timeout = 15_000 } = opts;
  return spawnSync(process.execPath, args, {
    cwd,
    env: { ...env, ...extraEnv },
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
  });
}

function success(result, operation) {
  assert(!result.stdout?.includes(apiKey) && !result.stderr?.includes(apiKey));
  assert.ifError(result.error);
  assert.equal(result.status, 0, operation + ": " + result.stderr);
  return result.stdout.trim();
}

async function connect(registration, preload, key) {
  client = new Client({ name: "rebut-windows-poc-fixture", version: "1" });
  const transport = new StdioClientTransport({
    command: registration.command,
    args: ["--import", pathToFileURL(preload).href, ...registration.args],
    cwd: fixture,
    env: {
      ...env,
      REBUT_OPENAI_API_KEY: key,
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const checkStderr = () =>
    assert(
      !stderr.includes(apiKey),
      "Synthetic credential appeared in stderr.",
    );
  stderrChecks.push(checkStderr);
  try {
    await client.connect(transport, callOptions);
  } catch (error) {
    checkStderr();
    throw Error("MCP handshake failed: " + stderr, { cause: error });
  }
}

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args }, callOptions);
  assert(
    !JSON.stringify(result).includes(apiKey),
    "Synthetic credential appeared in the MCP result.",
  );
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return JSON.parse(result.content[0].text);
}

try {
  await writeFile(npmrc, "");
  await writeFile(env.NPM_CONFIG_GLOBALCONFIG, "");
  if (windows) {
    const runtimeDir = join(fixture, "runtime on PATH");
    const shimDir = join(fixture, "npx on PATH");
    await Promise.all([mkdir(runtimeDir), mkdir(shimDir)]);
    const runtime = join(runtimeDir, "node.exe");
    await copyFile(process.execPath, runtime);
    await writeFile(join(shimDir, "npx.cmd"), "@echo off\r\n");
    const launcher = pathToFileURL(
      join(repository, "src", "client", "npx-launcher.ts"),
    ).href;
    const probe = `
      import { checkNpxPath, NpxLauncherError } from ${JSON.stringify(launcher)};
      try {
        await checkNpxPath({});
        console.log("verified");
      } catch (error) {
        if (!(error instanceof NpxLauncherError)) throw error;
        console.log(error.code);
      }
    `;
    const probeEnv = Object.fromEntries(
      Object.entries(env).filter(([key]) => key.toUpperCase() !== "PATH"),
    );
    const check = (directories = [runtimeDir, shimDir]) =>
      success(
        spawnSync(
          runtime,
          [
            "--experimental-transform-types",
            "--input-type=module",
            "-e",
            probe,
          ],
          {
            cwd: fixture,
            env: { ...probeEnv, PATH: directories.join(delimiter) },
            encoding: "utf8",
            timeout: 15_000,
          },
        ),
        "Windows npx runtime check",
      );
    assert.equal(check(), "verified", "npx.cmd falls back to the PATH Node");
    for (const component of [".", "\\bin", '""']) {
      assert.equal(
        check([component, runtimeDir, shimDir]),
        "NPX_RUNTIME_UNVERIFIED",
        "ambiguous PATH components prevent migration",
      );
    }
    const ordinaryShim = join(runtimeDir, "npx.cmd");
    await writeFile(ordinaryShim, "@echo off\r\n");
    assert.equal(check(), "verified", "npx.cmd selects the verified sibling Node");
    await rm(ordinaryShim);
    const sibling = join(shimDir, "node.exe");
    await writeFile(sibling, "unverified neighboring runtime");
    assert.equal(
      check(),
      "NPX_RUNTIME_UNVERIFIED",
      "npx.cmd selects its neighboring Node ahead of the verified PATH Node",
    );
    await rm(sibling);
    await mkdir(sibling);
    assert.equal(check(), "NPX_RUNTIME_UNVERIFIED", "the sibling must be a file");
    await rm(sibling, { recursive: true });
    const competingNode = join(shimDir, "node.cmd");
    await writeFile(competingNode, "@echo off\r\n");
    assert.equal(
      check([shimDir, runtimeDir]),
      "NPX_RUNTIME_UNVERIFIED",
      "the fallback node command is ambiguous",
    );
    await rm(competingNode);
    await writeFile(join(shimDir, "npx.exe"), "unverified competing launcher");
    assert.equal(check(), "NPX_RUNTIME_UNVERIFIED", "the npx command is ambiguous");
  }
  const packed = success(
    node(
      [
        npm,
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        fixture,
      ],
      {
        cwd: repository,
        timeout: 60_000,
      },
    ),
    "pack",
  );
  const [artifact] = JSON.parse(packed);
  const archive = join(fixture, artifact.filename);
  success(
    node(
      [
        npm,
        "install",
        "--prefix",
        prefix,
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        archive,
      ],
      {
        timeout: 120_000,
      },
    ),
    "install packed archive",
  );
  const entry = join(prefix, "node_modules", "rebut-mcp", "bin", "rebut.mjs");
  const cli = (...args) => success(node([entry, ...args]), args[0]);
  assert.equal(cli("--version"), artifact.version);
  if (windows) {
    const bin = join(prefix, "node_modules", ".bin");
    assert(env.SystemRoot, "Windows runner must provide SystemRoot.");
    const shim = spawnSync(
      join(env.SystemRoot, "System32", "cmd.exe"),
      ["/d", "/c", "rebut.cmd --version"],
      {
        cwd: bin,
        env,
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    assert.equal(success(shim, "installed Windows npm shim"), artifact.version);
  }
  // Local development can check the harness using POSIX settings. The Windows
  // run tests the built-in defaults without a Rebut config file.
  if (!windows) cli("set", "secret-store", "env");
  const fresh = JSON.parse(cli("doctor"));
  assert.equal(fresh.mode, "local");
  assert.equal(fresh.secretStore, "env");
  assert.equal(fresh.credentialAvailable, false);
  if (windows)
    await assert.rejects(access(join(configDir, "config.json")), {
      code: "ENOENT",
    });

  const codexHome = join(fixture, "Codex Home");
  const claudeConfig = join(fixture, "Claude", "settings.json");
  cli("setup", "--client", "codex", "--codex-home", codexHome);
  cli("setup", "--client", "claude", "--claude-config", claudeConfig);
  const codexText = await readFile(join(codexHome, "config.toml"), "utf8");
  const claudeText = await readFile(claudeConfig, "utf8");
  const registrations = {
    codex: parse(codexText).mcp_servers.rebut,
    claude: JSON.parse(claudeText).mcpServers.rebut,
  };
  assert(!codexText.includes(apiKey) && !claudeText.includes(apiKey));
  for (const [host, reg] of Object.entries(registrations)) {
    assert.equal(await realpath(reg.command), await realpath(process.execPath));
    assert.equal(await realpath(reg.args[0]), await realpath(entry));
    assert.deepEqual(reg.args.slice(1), ["mcp", "--client", host]);
  }
  assert.deepEqual(registrations.codex.env_vars, ["REBUT_OPENAI_API_KEY"]);
  assert.equal(
    registrations.claude.env.REBUT_OPENAI_API_KEY,
    "${REBUT_OPENAI_API_KEY:-}",
  );
  assert(registrations.codex.enabled_tools.includes("review_pair"));
  assert.equal(registrations.codex.env.REBUT_CONFIG_DIR, configDir);
  assert.equal(registrations.claude.env.REBUT_CONFIG_DIR, configDir);

  await writeFile(join(fixture, "sample.ts"), "export const fixture = 1;\n");
  const requestId = "windows-poc-001";
  const bundle = JSON.parse(
    cli(
      "collect",
      "--root",
      fixture,
      "--request-id",
      requestId,
      "--requirements",
      "Synthetic fixture only",
      "--profile",
      "luna-test",
      "--",
      "sample.ts",
    ),
  );
  const preload = join(fixture, "synthetic-provider.mjs");
  const marker = join(fixture, "provider-calls");
  await writeFile(
    preload,
    `
    import assert from "node:assert/strict";
    import { appendFile } from "node:fs/promises";
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer " + process.env.REBUT_OPENAI_API_KEY);
      const request = JSON.parse(init.body);
      assert.equal(request.model, "gpt-6-luna");
      await appendFile(${JSON.stringify(marker)}, "one synthetic call\\n");
      return Response.json({
        id: "resp_windows_poc", status: "completed", model: request.model,
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120,
          input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } },
        output: [{ type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: JSON.stringify({
            summary: "Synthetic review", findings: [], additional_evidence: [],
          }) }] }],
      });
    };
  `,
  );
  await connect(registrations.codex, preload, apiKey);
  const tools = await client.listTools({}, callOptions);
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "review",
    "review_pair",
    "review_status",
  ]);
  const result = await call("review", bundle);
  assert.equal(result.status, "completed");
  assert.equal(result.actual_model, "gpt-6-luna");
  assert(result.review?.summary);
  await client.close();

  await connect(registrations.claude, preload, "");
  const saved = await call("review_status", { request_id: requestId });
  assert.equal(saved.status, "completed");
  assert.equal(saved.input_sha256, bundle.input_sha256);
  assert.equal(saved.actual_model, "gpt-6-luna");
  assert.deepEqual(saved.usage, result.usage);
  assert.equal(saved.review, undefined);
  const duplicate = await call("review", bundle);
  assert.equal(duplicate.status, "completed");
  assert.equal(duplicate.result_replay_available, false);
  assert.equal(duplicate.review, undefined);
  const changed = JSON.parse(
    cli(
      "collect",
      "--root",
      fixture,
      "--request-id",
      requestId,
      "--requirements",
      "Different synthetic requirement",
      "--profile",
      "luna-test",
      "--",
      "sample.ts",
    ),
  );
  assert.notEqual(changed.input_sha256, bundle.input_sha256);
  assert.equal((await call("review", changed)).status, "conflict");
  await client.close();
  assert.equal(await readFile(marker, "utf8"), "one synthetic call\n");
  const database = await readFile(join(configDir, "local", "ledger.sqlite"));
  assert(
    !database.includes(Buffer.from(apiKey)),
    "Synthetic credential appeared in SQLite.",
  );
  if (windows)
    await assert.rejects(access(join(configDir, "config.json")), {
      code: "ENOENT",
    });

  if (windows) {
    const write = node([entry, "set", "mode", "local"]);
    assert.ifError(write.error);
    assert.equal(write.status, 1);
    assert.match(write.stderr, /REBUT_CONFIG_DIR without config\.json/);
    await assert.rejects(access(join(configDir, "config.json")), {
      code: "ENOENT",
    });
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        mode: "local",
        secretStore: "env",
        vaultwardenItem: "synthetic",
      }),
    );
    const configured = node([entry, "doctor"]);
    assert.ifError(configured.error);
    assert.equal(configured.status, 1);
    assert.match(configured.stderr, /REBUT_CONFIG_DIR without config\.json/);
    console.log(
      "Windows: npm cmd shim passed. Persistent settings read and write rejected as expected.",
    );
  }
  console.log(
    "Packed CLI, generated launcher arguments, stdio, SQLite restart, dedup and conflict passed. Provider calls were synthetic.",
  );
} catch (error) {
  failed = true;
  throw error;
} finally {
  try {
    try {
      await client?.close();
    } finally {
      try {
        for (const check of stderrChecks) check();
      } finally {
        await rm(fixture, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    }
  } catch (error) {
    if (!failed) throw error;
    process.stderr.write(
      "The fixture also failed a cleanup or stderr check.\n",
    );
  }
}
