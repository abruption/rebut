import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { connectRemote } from "../src/client/connection.js";
import { ReviewInputSchema } from "../src/contracts.js";
export async function main(args = process.argv.slice(2)) {
  const endpoint = process.env.REBUT_ENDPOINT,
    token = process.env.REBUT_TOKEN;
  if (!endpoint || !token)
    throw new Error("Missing private client configuration");
  const client = await connectRemote({
    endpoint,
    loadToken: async () => token,
  });
  try {
    const [command, id] = args;
    if (command === "list") {
      process.stdout.write(
        JSON.stringify(await client.listTools(), null, 2) + "\n",
      );
      return;
    }
    let toolArgs: Record<string, unknown>, tool: string;
    if (command === "status") {
      if (!id) throw new Error("Missing request ID");
      tool = "review_status";
      toolArgs = { request_id: id };
    } else if (command === "review") {
      const buffers: Buffer[] = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        const b = Buffer.from(chunk);
        size += b.length;
        if (size > 160000) throw new Error("Input too large");
        buffers.push(b);
      }
      toolArgs = ReviewInputSchema.parse(
        JSON.parse(Buffer.concat(buffers).toString("utf8")),
      );
      tool = "review";
    } else
      throw new Error(
        "Expected list, status ID, or review with bundle on stdin",
      );
    const result = await client.callTool({ name: tool, arguments: toolArgs });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally {
    await client.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  main().catch(() => {
    process.stderr.write(
      "MCP request failed. Keep the original request ID and query status before any further paid invocation.\n",
    );
    process.exitCode = 1;
  });
