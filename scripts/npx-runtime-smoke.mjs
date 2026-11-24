import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export async function verifyNpxRuntime({ archive, directory, npm, env }) {
  const workspace = join(directory, "npx workspace");
  const prefix = join(directory, "npx prefix");
  const projectBin = join(workspace, "node_modules", ".bin");
  const config = join(directory, "npx Rebut settings");
  await mkdir(projectBin, { recursive: true, mode: 0o700 });
  await mkdir(prefix, { mode: 0o700 });
  await mkdir(config, { mode: 0o700 });
  await writeFile(join(prefix, "package.json"), '{"private":true}\n');
  const windows = process.platform === "win32";
  await writeFile(
    join(projectBin, windows ? "node.cmd" : "node"),
    windows ? "@exit /b 97\r\n" : "#!/bin/sh\nexit 97\n",
    { mode: 0o700 },
  );

  const source = new URL("../src/client/npx-launcher.ts", import.meta.url);
  const args = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--experimental-transform-types",
        "--input-type=module",
        "-e",
        `import { npxLauncherArgs } from ${JSON.stringify(source.href)};
         console.log(JSON.stringify(npxLauncherArgs("claude", process.argv[1])));`,
        prefix,
      ],
      { env, encoding: "utf8", timeout: 10_000 },
    ),
  );
  const packageArg = args.indexOf("--package=rebut-mcp@latest");
  assert(packageArg >= 0, "The migration must use npm's Rebut release tag.");
  args[packageArg] = "--package=" + archive;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(dirname(npm), "npx-cli.js"), ...args],
    cwd: workspace,
    env: {
      ...env,
      REBUT_CONFIG_DIR: config,
      NPM_CONFIG_OFFLINE: "true",
    },
  });
  const client = new Client({ name: "rebut-npx-runtime-probe", version: "1" });
  const timeout = { timeout: 20_000, maxTotalTimeout: 20_000 };
  try {
    await client.connect(transport, timeout);
    const { tools } = await client.listTools({}, timeout);
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ["review", "review_pair", "review_status"],
    );
  } finally {
    await client.close();
  }
}
