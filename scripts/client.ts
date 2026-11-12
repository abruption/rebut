import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { ReviewInputSchema } from "../src/contracts.js";
const endpoint = process.env.REBUT_ENDPOINT,
  token = process.env.REBUT_TOKEN;
async function main() {
  if (!endpoint || !token)
    throw new Error("Missing private client configuration");
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  )
    throw new Error("HTTPS required");
  const transport = new StreamableHTTPClientTransport(url, {
    authProvider: { token: async () => token },
    requestInit: { redirect: "error" },
    reconnectionOptions: {
      maxRetries: 0,
      maxReconnectionDelay: 1000,
      initialReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  });
  const client = new Client({ name: "rebut-cli", version: "0.1.0" });
  try {
    await client.connect(transport, { timeout: 15000 });
    const [command, id] = process.argv.slice(2);
    if (command === "list") {
      process.stdout.write(
        JSON.stringify(await client.listTools(), null, 2) + "\n",
      );
      return;
    }
    let args: Record<string, unknown>, tool: string;
    if (command === "status") {
      if (!id) throw new Error("Missing request ID");
      tool = "review_status";
      args = { request_id: id };
    } else if (command === "review") {
      const buffers: Buffer[] = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        const b = Buffer.from(chunk);
        size += b.length;
        if (size > 160000) throw new Error("Input too large");
        buffers.push(b);
      }
      args = ReviewInputSchema.parse(
        JSON.parse(Buffer.concat(buffers).toString("utf8")),
      );
      tool = "review";
    } else
      throw new Error(
        "Expected list, status ID, or review with bundle on stdin",
      );
    const result = await client.callTool(
      { name: tool, arguments: args },
      { timeout: 65000 },
    );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally {
    await client.close();
  }
}
main().catch(() => {
  process.stderr.write(
    "MCP request failed. Keep the original request ID and query status before any further paid invocation.\n",
  );
  process.exitCode = 1;
});
