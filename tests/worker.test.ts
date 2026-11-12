import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { inputHash } from "../src/contracts.js";
let mf: Miniflare,
  calls = 0;
const token = "synthetic-test-token-not-a-secret";
const cfg = JSON.parse(readFileSync("config.example.json", "utf8"));
cfg.hostname = "127.0.0.1";
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "rebut",
          modules: [{ type: "ESModule", path: "dist/worker.js" }],
          compatibilityDate: "2026-11-12",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          bindings: {
            REBUT_CONFIG: JSON.stringify(cfg),
            AUTH_TOKENS: JSON.stringify({
              test: createHash("sha256").update(token).digest("hex"),
            }),
            OPENAI_API_KEY: "fake",
          },
          outboundService: async (req) => {
            expect(req.url).toBe("https://api.openai.com/v1/responses");
            calls++;
            return new Response(
              JSON.stringify({
                id: "resp_mock",
                status: "completed",
                model: "gpt-6-astra",
                usage: {
                  input_tokens: 100,
                  output_tokens: 20,
                  total_tokens: 120,
                  input_tokens_details: { cached_tokens: 0 },
                  output_tokens_details: { reasoning_tokens: 10 },
                },
                output: [
                  {
                    type: "message",
                    role: "assistant",
                    status: "completed",
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify({
                          summary: "No supported defects.",
                          findings: [],
                          additional_evidence: [],
                        }),
                      },
                    ],
                  },
                ],
              }),
              {
                headers: {
                  "content-type": "application/json",
                  "x-request-id": "req_mock",
                },
              },
            );
          },
        },
      ],
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const statement of readFileSync("migrations/0001_ledger.sql", "utf8")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
}, 20000);
afterAll(async () => {
  await mf?.dispose();
});
async function decode(r: any) {
  const text = await r.text();
  if (text.startsWith("event:"))
    return JSON.parse(
      text
        .split("\n")
        .find((l: string) => l.startsWith("data:"))!
        .slice(5),
    );
  return JSON.parse(text);
}
async function rpc(method: string, params?: unknown, authenticated = true) {
  return mf.dispatchFetch("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      Host: "127.0.0.1",
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
      ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}
it("rejects nonauthenticated and cross origin requests without provider calls", async () => {
  expect((await rpc("tools/list", {}, false)).status).toBe(401);
  expect(
    (
      await mf.dispatchFetch("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "https://evil.invalid",
        },
      })
    ).status,
  ).toBe(403);
  expect(calls).toBe(0);
});
it("lists real MCP tools and runs synthetic review exactly once", async () => {
  const listed = await rpc("tools/list", {});
  expect(listed.status).toBe(200);
  const body = (await decode(listed)) as any;
  expect(body.result.tools.map((t: any) => t.name)).toEqual([
    "review",
    "review_status",
  ]);
  const input = {
    schema_version: 1 as const,
    task_kind: "code" as const,
    requirements: "Preserve value",
    files: [
      {
        path: "sample.ts",
        start_line: 1,
        content: "export const value = 1;\n",
      },
    ],
    diff: "",
    request_id: "synthetic-1",
    profile: "astra-medium",
    input_sha256: "",
  };
  input.input_sha256 = await inputHash(input);
  const results = await Promise.all([
    rpc("tools/call", { name: "review", arguments: input }),
    rpc("tools/call", { name: "review", arguments: input }),
  ]);
  const outcomes = await Promise.all(
    results.map(async (r) =>
      JSON.parse(((await decode(r)) as any).result.content[0].text),
    ),
  );
  expect(outcomes.some((o) => o.status === "completed")).toBe(true);
  expect(calls).toBe(1);
  const duplicate = await rpc("tools/call", {
    name: "review",
    arguments: input,
  });
  expect(
    JSON.parse(((await decode(duplicate)) as any).result.content[0].text)
      .result_replay_available,
  ).toBe(false);
  expect(calls).toBe(1);
  const status = await rpc("tools/call", {
    name: "review_status",
    arguments: { request_id: "synthetic-1" },
  });
  const metadata = JSON.parse(
    ((await decode(status)) as any).result.content[0].text,
  );
  expect(metadata.status).toBe("completed");
  expect(metadata.review).toBeUndefined();
});
it("rejects oversize transport without paying", async () => {
  expect(
    (
      await mf.dispatchFetch("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "x".repeat(160001),
      })
    ).status,
  ).toBe(413);
  expect(calls).toBe(1);
});
