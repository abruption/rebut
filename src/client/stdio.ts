import {
  McpServer,
  fromJsonSchema,
  type JsonSchemaType,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  connectRemote,
  REMOTE_FAILURE_MESSAGE,
  type RemoteOptions,
} from "./connection.js";

const REVIEW_GUIDANCE =
  "Use only when the user explicitly opts in to a review using the frozen profile provider. Keep the original request_id and backend after uncertainty and query review_status before another paid invocation. Do not automatically change reviewers, providers, or keys. Project default real API tests: luna-test (gpt-6-luna).";

/** Runs until stdin closes or the process receives SIGINT/SIGTERM. */
export async function serveStdio(options: RemoteOptions): Promise<void> {
  const remote = await connectRemote(options);
  const server = new McpServer({ name: "rebut-mcp", version: "0.3.0" });
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= Promise.resolve().then(async () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      await Promise.allSettled([server.close(), remote.close()]);
      finish();
    }));
  const onSignal = () => {
    void close();
  };
  server.server.onclose = () => {
    void close();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const { tools } = await remote.listTools();
    for (const tool of tools) {
      if (tool.name !== "review" && tool.name !== "review_status") continue;
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description:
            tool.name === "review"
              ? `${tool.description ?? ""}\n\n${REVIEW_GUIDANCE}${options.preferredProfile ? "\nPreferred profile for new reviews: " + options.preferredProfile.id + " (model " + options.preferredProfile.model + ", reasoning " + (options.preferredProfile.reasoning ?? "provider default") + "). Explicit request profile remains authoritative." : ""}`.trim()
              : tool.description,
          inputSchema: fromJsonSchema<Record<string, unknown>>(
            tool.inputSchema as JsonSchemaType,
          ),
          ...(tool.outputSchema
            ? {
                outputSchema: fromJsonSchema(
                  tool.outputSchema as JsonSchemaType,
                ),
              }
            : {}),
          annotations: tool.annotations,
          icons: tool.icons,
          _meta: tool._meta,
        },
        async (args) => {
          try {
            if (tool.name === "review" && options.reviewUnavailable)
              return {
                isError: true,
                content: [
                  {
                    type: "text" as const,
                    text: "Configured model preference is unavailable. Correct it with profile list/set before a new review. Existing request metadata remains available through review_status.",
                  },
                ],
              };
            return await remote.callTool({ name: tool.name, arguments: args });
          } catch {
            return {
              isError: true,
              content: [{ type: "text", text: REMOTE_FAILURE_MESSAGE }],
            };
          }
        },
      );
    }
    if (
      !["review", "review_status"].every((name) =>
        tools.some((tool) => tool.name === name),
      )
    ) {
      throw new Error(REMOTE_FAILURE_MESSAGE);
    }
    await server.connect(new StdioServerTransport());
    await finished;
  } catch {
    throw new Error(REMOTE_FAILURE_MESSAGE);
  } finally {
    await close();
  }
}
