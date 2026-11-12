import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import {
  InMemoryTransport,
  McpServer,
  createMcpHandler,
  fromJsonSchema,
} from "@modelcontextprotocol/server";
import type { Transport } from "@modelcontextprotocol/server";
import {
  connectRemote,
  HANDSHAKE_OPTIONS,
  REMOTE_FAILURE_MESSAGE,
  TOOL_CALL_OPTIONS,
  validateEndpoint,
} from "../src/client/connection.js";
import { serveStdio } from "../src/client/stdio.js";

const stdio = vi.hoisted(() => ({
  transport: undefined as Transport | undefined,
  ready: () => {},
}));
vi.mock("@modelcontextprotocol/server/stdio", () => ({
  StdioServerTransport: class {
    constructor() {
      if (!stdio.transport) throw new Error("Missing synthetic transport");
      stdio.ready();
      return stdio.transport;
    }
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  stdio.transport = undefined;
  stdio.ready = () => {};
});

const schema = {
  type: "object" as const,
  properties: {
    request_id: { type: "string" as const },
    source: { type: "string" as const },
  },
  required: ["request_id"],
  additionalProperties: false,
};
const result = {
  content: [{ type: "text" as const, text: "Synthetic review" }],
  structuredContent: { status: "completed", marker: [1, true] },
  _meta: { synthetic: "preserved" },
};
const options = {
  endpoint: "https://synthetic.invalid/mcp",
  loadToken: async () => "synthetic-not-a-credential",
};

function fixture() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const requests: Array<{ headers: Headers }> = [];
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "synthetic", version: "1" });
    for (const name of ["review", "review_status", "unrelated_private_tool"]) {
      server.registerTool(
        name,
        {
          description: `Remote ${name}`,
          inputSchema: fromJsonSchema<Record<string, unknown>>(schema),
        },
        async (args) => {
          calls.push({ name, args });
          return result;
        },
      );
    }
    return server;
  });
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    requests.push({ headers: request.headers });
    return handler.fetch(request as Parameters<typeof handler.fetch>[0]);
  });
  vi.stubGlobal("fetch", fetcher);
  return { calls, requests, fetcher };
}

describe("npm remote connection", () => {
  it.each([
    "https://host.example/mcp",
    "http://localhost:3100/mcp",
    "http://127.0.0.1/mcp",
    "http://[::1]/mcp",
  ])("allows bounded endpoint %s", (endpoint) => {
    expect(validateEndpoint(endpoint)).toBeInstanceOf(URL);
  });
  it.each([
    "http://example.com/mcp",
    "http://127.attacker.invalid/mcp",
    "ftp://localhost/mcp",
    "https://user:pass@example.com/mcp",
    "https://example.com/mcp?",
    "https://example.com/mcp#",
    "https://example.com/mcp?a=b",
    "bad endpoint",
  ])(
    "rejects unsafe endpoint %s before loading credentials",
    async (endpoint) => {
      const loadToken = vi.fn(async () => "synthetic");
      await expect(connectRemote({ endpoint, loadToken })).rejects.toThrow();
      expect(loadToken).not.toHaveBeenCalled();
    },
  );
  it("uses authenticated MCP without changing arguments/results and enforces finite timeouts", async () => {
    const f = fixture();
    const client = await connectRemote(options);
    try {
      expect((await client.listTools()).tools).toHaveLength(3);
      const args = { request_id: "original-id", source: "synthetic source" };
      expect(
        await client.callTool({ name: "review", arguments: args }),
      ).toEqual(result);
      expect(f.calls).toEqual([{ name: "review", args }]);
      expect(
        f.requests.every(
          (request) =>
            request.headers.get("authorization") ===
            "Bearer synthetic-not-a-credential",
        ),
      ).toBe(true);
      expect(
        f.fetcher.mock.calls.every(([, init]) => init?.redirect === "error"),
      ).toBe(true);
      expect(HANDSHAKE_OPTIONS).toEqual({
        timeout: 15000,
        maxTotalTimeout: 15000,
        resetTimeoutOnProgress: false,
      });
      expect(TOOL_CALL_OPTIONS).toEqual({
        timeout: 65000,
        maxTotalTimeout: 65000,
        resetTimeoutOnProgress: false,
      });
    } finally {
      await client.close();
    }
  });
  it.each([401, 403, 302, 500])(
    "does not retry status %s or disclose response text",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response("private remote error", {
            status,
            headers: { location: "https://another.invalid/mcp" },
          }),
      );
      vi.stubGlobal("fetch", fetcher);
      await expect(connectRemote(options)).rejects.toThrow(
        REMOTE_FAILURE_MESSAGE,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("enforces tool/list budgets even when callers request longer or progress-reset timeouts", async () => {
    fixture();
    const call = vi
      .spyOn(Client.prototype, "callTool")
      .mockResolvedValue(result);
    const list = vi
      .spyOn(Client.prototype, "listTools")
      .mockResolvedValue({ tools: [] });
    const client = await connectRemote(options);
    try {
      const longer = {
        timeout: 999999,
        maxTotalTimeout: 999999,
        resetTimeoutOnProgress: true,
      };
      await client.listTools(undefined, longer);
      await client.callTool(
        { name: "review_status", arguments: { request_id: "same-id" } },
        longer,
      );
      expect(list).toHaveBeenLastCalledWith(undefined, HANDSHAKE_OPTIONS);
      expect(call).toHaveBeenLastCalledWith(
        { name: "review_status", arguments: { request_id: "same-id" } },
        TOOL_CALL_OPTIONS,
      );
    } finally {
      await client.close();
    }
  });
  it("bounds a stalled handshake at fifteen seconds without retrying", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const connecting = connectRemote(options);
    const failure = expect(connecting).rejects.toThrow(REMOTE_FAILURE_MESSAGE);
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("npm stdio bridge", () => {
  it("exposes only review tools, preserves schema and data, and closes both transports", async () => {
    const f = fixture();
    const [local, serverSide] = InMemoryTransport.createLinkedPair();
    stdio.transport = serverSide;
    const ready = new Promise<void>((resolve) => {
      stdio.ready = resolve;
    });
    const running = serveStdio(options);
    await ready;
    const client = new Client({ name: "synthetic-host", version: "1" });
    await client.connect(local);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "review",
        "review_status",
      ]);
      expect(tools.map((tool) => tool.inputSchema)).toEqual([schema, schema]);
      expect(tools[0]?.description).toContain("explicitly opts in");
      expect(tools[0]?.description).toContain("luna-test (gpt-6-luna)");
      expect(tools[1]?.description).toBe("Remote review_status");
      const args = { request_id: "keep-this-id", source: "synthetic" };
      expect(
        await client.callTool({ name: "review", arguments: args }),
      ).toEqual(result);
      expect(f.calls).toEqual([{ name: "review", args }]);
      // Transport failures are sanitized instead of exposing remote exception messages.
      f.fetcher.mockRejectedValueOnce(
        new Error("private token/source failure"),
      );
      expect(
        await client.callTool({
          name: "review_status",
          arguments: { request_id: "keep-this-id" },
        }),
      ).toEqual({
        isError: true,
        content: [{ type: "text", text: REMOTE_FAILURE_MESSAGE }],
      });
      expect(f.calls).toHaveLength(1);
    } finally {
      await client.close();
      await running;
    }
  });
  it.each(["EOF", "SIGINT", "SIGTERM"])(
    "cleans up on %s without writing non-MCP stdout",
    async (event) => {
      fixture();
      const { StdioServerTransport } = await vi.importActual<
        typeof import("@modelcontextprotocol/server/stdio")
      >("@modelcontextprotocol/server/stdio");
      const input = new PassThrough();
      const output = new PassThrough();
      const chunks: Buffer[] = [];
      output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stdio.transport = new StdioServerTransport(input, output);
      const ready = new Promise<void>((resolve) => {
        stdio.ready = resolve;
      });
      const beforeInt = process.listenerCount("SIGINT");
      const beforeTerm = process.listenerCount("SIGTERM");
      const running = serveStdio(options);
      await ready;
      await Promise.resolve();
      if (event === "EOF") input.end();
      else process.emit(event as "SIGINT" | "SIGTERM");
      await running;
      expect(process.listenerCount("SIGINT")).toBe(beforeInt);
      expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
      expect(Buffer.concat(chunks).toString()).toBe("");
    },
  );
});
