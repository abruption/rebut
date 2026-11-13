// Real loopback HTTP, no provider calls. Run manually to exercise Node's
// otherwise hidden 300-second headers timeout, independently of fake timers.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connectRemote } from "../src/client/connection.js";

const delayMs = Number(process.argv[2] ?? 310_000);
assert(
  Number.isSafeInteger(delayMs) && delayMs > 300_000 && delayMs < 1_800_000,
);
let calls = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();
const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString());
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    let result;
    if (message.method === "initialize") {
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "loopback-deadline-fixture", version: "1" },
      };
    } else if (message.method === "tools/call") {
      calls++;
      // Deliberately do not send headers until after Node's old 300s bound.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          resolve();
        }, delayMs);
        timers.add(timer);
      });
      result = {
        content: [{ type: "text", text: "synthetic delayed result" }],
      };
    } else throw new Error("Unexpected fixture method");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  } catch {
    response.writeHead(500).end();
  }
});
server.requestTimeout = 0;
server.timeout = 0;
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
let client: Awaited<ReturnType<typeof connectRemote>> | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
try {
  client = await connectRemote({
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    loadToken: async () => "synthetic-loopback-token",
  });
  const started = Date.now();
  console.log(
    JSON.stringify({
      loopback_started: true,
      delay_ms: delayMs,
      provider_calls: 0,
    }),
  );
  const result = await Promise.race([
    client.callTool({
      name: "review_status",
      arguments: { request_id: "synthetic" },
    }),
    new Promise<never>((_, reject) => {
      watchdog = setTimeout(
        () => reject(new Error("Loopback smoke watchdog")),
        delayMs + 15_000,
      );
    }),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(result.content, [
    { type: "text", text: "synthetic delayed result" },
  ]);
  console.log(
    JSON.stringify({
      loopback_passed: true,
      elapsed_ms: Date.now() - started,
      calls,
      provider_calls: 0,
    }),
  );
} finally {
  if (watchdog) clearTimeout(watchdog);
  for (const timer of timers) clearTimeout(timer);
  await client?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
