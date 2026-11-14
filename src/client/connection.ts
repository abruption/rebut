import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { CLIENT_TOOL_TIMEOUT_MS } from "../timeouts.js";
import { createNodeHttpTransport } from "./http.js";

export interface RemoteOptions {
  endpoint: string;
  preferredProfile?: { id: string; model: string; reasoning?: string };
  reviewUnavailable?: boolean;
  loadToken: () => Promise<string>;
}

export const HANDSHAKE_OPTIONS = {
  timeout: 15_000,
  maxTotalTimeout: 15_000,
  resetTimeoutOnProgress: false,
} as const;
export const TOOL_CALL_OPTIONS = {
  timeout: CLIENT_TOOL_TIMEOUT_MS,
  maxTotalTimeout: CLIENT_TOOL_TIMEOUT_MS,
  resetTimeoutOnProgress: false,
} as const;
export const REMOTE_FAILURE_MESSAGE =
  "Remote MCP request failed. Keep the same request_id and query review_status before any further paid invocation.";

export function validateEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Invalid MCP endpoint");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    /[?#]/.test(endpoint)
  ) {
    throw new Error(
      "MCP endpoint requires HTTPS (HTTP loopback is allowed), without credentials, query, or fragment",
    );
  }
  return url;
}

export async function connectRemote(options: RemoteOptions): Promise<Client> {
  const url = validateEndpoint(options.endpoint);
  // Node fetch otherwise imposes its own 300-second headers/body deadlines,
  // independently of the MCP request timer. Do not alter the global dispatcher.
  const http = createNodeHttpTransport();
  const transport = new StreamableHTTPClientTransport(url, {
    authProvider: { token: options.loadToken },
    requestInit: { redirect: "error" },
    fetch: async (input, init) => {
      const target = new URL(
        input instanceof Request ? input.url : String(input),
      );
      if (
        target.origin !== url.origin ||
        target.username ||
        target.password ||
        target.search ||
        target.hash
      ) {
        throw new Error(REMOTE_FAILURE_MESSAGE);
      }
      return http.fetch(input, { ...init, redirect: "error" });
    },
    onInsufficientScope: "throw",
    maxStepUpRetries: 0,
    reconnectionOptions: {
      maxRetries: 0,
      maxReconnectionDelay: 1_000,
      initialReconnectionDelay: 1_000,
      reconnectionDelayGrowFactor: 1,
    },
  });
  const client = new Client({ name: "rebut-mcp", version: "0.3.0" });
  const close = client.close.bind(client);
  let closing: Promise<void> | undefined;
  client.close = () =>
    (closing ??= (async () => {
      try {
        await close();
      } finally {
        await http.close();
      }
    })());
  // Enforce the same finite budgets for CLI consumers and the stdio bridge.
  const callTool = client.callTool.bind(client);
  client.callTool = (params, requestOptions) =>
    callTool(params, { ...requestOptions, ...TOOL_CALL_OPTIONS });
  const listTools = client.listTools.bind(client);
  client.listTools = (params, requestOptions) =>
    listTools(params, { ...requestOptions, ...HANDSHAKE_OPTIONS });
  try {
    await client.connect(transport, HANDSHAKE_OPTIONS);
    return client;
  } catch {
    await client.close().catch(() => {});
    throw new Error(REMOTE_FAILURE_MESSAGE);
  }
}
