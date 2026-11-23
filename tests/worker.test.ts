import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { inputHash } from "../src/contracts.js";
let mf: Miniflare,
  calls = 0;
let malformedProviderBody = false;
let anthropicCalls = 0;
const token = "synthetic-test-token-not-a-secret";
const recoveryToken = "synthetic-recovery-token-not-a-secret";
const otherToken = "synthetic-other-token-not-a-secret";
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
              other: createHash("sha256").update(otherToken).digest("hex"),
              recovery: createHash("sha256")
                .update(recoveryToken)
                .digest("hex"),
            }),
            OPENAI_API_KEY: "fake",
            ANTHROPIC_API_KEY: "fake-anthropic",
            ADMIN_TOKEN_SHA256: createHash("sha256")
              .update("synthetic-admin-token-not-a-secret")
              .digest("hex"),
          },
          outboundService: async (req) => {
            if (req.url === "https://api.anthropic.com/v1/messages") {
              anthropicCalls++;
              expect(req.headers.get("x-api-key")).toBe("fake-anthropic");
              expect(req.headers.get("authorization")).toBeNull();
              const body = (await req.json()) as any;
              expect(body.model).toBe("claude-opus-5-5");
              return new Response(
                JSON.stringify({
                  id: "msg_worker",
                  type: "message",
                  role: "assistant",
                  model: body.model,
                  stop_reason: "end_turn",
                  usage: { input_tokens: 100, output_tokens: 20 },
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        summary: "Synthetic Claude Worker review",
                        findings: [],
                        additional_evidence: [],
                      }),
                    },
                  ],
                }),
                { headers: { "request-id": "req_worker_claude" } },
              );
            }
            expect(req.url).toBe("https://api.openai.com/v1/responses");
            calls++;
            if (malformedProviderBody)
              return new Response("private malformed provider body", {
                headers: { "x-request-id": "req_malformed_fixture" },
              });
            return new Response(
              JSON.stringify({
                id: "resp_mock",
                status: "completed",
                model: "gpt-6.2-astra",
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
  for (const statement of (
    readFileSync("migrations/0001_ledger.sql", "utf8") +
    readFileSync("migrations/0002_profiles.sql", "utf8")
  )
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
async function rpc(
  method: string,
  params?: unknown,
  authenticated: boolean | string = true,
) {
  return mf.dispatchFetch("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      Host: "127.0.0.1",
      "content-type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
      ...(authenticated
        ? {
            Authorization: `Bearer ${typeof authenticated === "string" ? authenticated : token}`,
          }
        : {}),
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
it("rejects invalid Worker auth configuration and permits an absent administrator", async () => {
  const ordinaryDigest = createHash("sha256").update(token).digest("hex");
  const separateAdminDigest = createHash("sha256")
    .update("separate-synthetic-admin-token")
    .digest("hex");
  const principals = JSON.stringify({ test: ordinaryDigest });
  const authCases: Array<{
    valid: boolean;
    bindings: { AUTH_TOKENS: string; ADMIN_TOKEN_SHA256?: string };
  }> = [
    {
      valid: false,
      bindings: {
        AUTH_TOKENS: JSON.stringify({
          first: ordinaryDigest,
          second: ordinaryDigest,
        }),
        ADMIN_TOKEN_SHA256: separateAdminDigest,
      },
    },
    { valid: false, bindings: { AUTH_TOKENS: principals, ADMIN_TOKEN_SHA256: ordinaryDigest } },
    { valid: false, bindings: { AUTH_TOKENS: "{", ADMIN_TOKEN_SHA256: separateAdminDigest } },
    { valid: false, bindings: { AUTH_TOKENS: principals, ADMIN_TOKEN_SHA256: "invalid" } },
    { valid: true, bindings: { AUTH_TOKENS: principals, ADMIN_TOKEN_SHA256: "" } },
    { valid: true, bindings: { AUTH_TOKENS: principals } },
  ];
  for (const [index, { valid, bindings }] of authCases.entries()) {
    const isolated = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: `auth-config-${index}`,
            modules: [{ type: "ESModule", path: "dist/worker.js" }],
            compatibilityDate: "2026-11-12",
            compatibilityFlags: ["nodejs_compat"],
            d1Databases: ["DB"],
            bindings: {
              REBUT_CONFIG: JSON.stringify(cfg),
              ...bindings,
            },
          },
        ],
      }),
    );
    try {
      const routes = valid ? ["/mcp", "/admin/budget"] : ["/mcp", "/profiles", "/admin/budget"];
      for (const path of routes) {
        const response = await isolated.dispatchFetch(
          "http://127.0.0.1" + path,
          {
            headers: {
              Host: "127.0.0.1",
              Authorization: `Bearer ${token}`,
            },
          },
        );
        if (!valid) {
          expect(response.status).toBe(503);
          expect(await response.text()).toBe("Service not configured");
        } else {
          expect(response.status).toBe(path === "/mcp" ? 405 : 401);
        }
      }
    } finally {
      await isolated.dispose();
    }
  }
});
it("lists real MCP tools and runs synthetic review exactly once", async () => {
  const listed = await rpc("tools/list", {});
  expect(listed.status).toBe(200);
  const body = (await decode(listed)) as any;
  expect(body.result.tools.map((t: any) => t.name)).toEqual([
    "review",
    "review_status",
    "review_pending",
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
  expect(metadata).toMatchObject({
    status: "completed",
    requested_model: "gpt-6.2-astra",
    actual_model: "gpt-6.2-astra",
    price_version: "openai-standard-2026-11-18",
    estimated_cost_microusd: 1600,
    budget_accounted_microusd: 1600,
  });
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
const adminToken = "synthetic-admin-token-not-a-secret";
async function profileHttp(
  path: string,
  method = "GET",
  body?: unknown,
  bearer = token,
) {
  return mf.dispatchFetch("http://127.0.0.1" + path, {
    method,
    headers: {
      Host: "127.0.0.1",
      Authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
it("separates profile administration from review access and applies revisions without model execution", async () => {
  const before = calls;
  const profiles = await profileHttp("/profiles");
  expect(profiles.status).toBe(200);
  const initial = (await profiles.json()) as any;
  expect(
    initial.profiles.find((p: any) => p.id === "astra-medium").revision,
  ).toBe(0);
  const profile = {
    ...cfg.profiles["astra-medium"],
    model: "future-responses-model",
    reasoning: "future_effort",
  };
  expect(
    (
      await profileHttp("/admin/profiles/future", "PUT", {
        expected_revision: 0,
        profile,
      })
    ).status,
  ).toBe(401);
  const created = await profileHttp(
    "/admin/profiles/future",
    "PUT",
    { expected_revision: 0, profile },
    adminToken,
  );
  expect(created.status).toBe(200);
  expect(((await created.json()) as any).record).toMatchObject({
    id: "future",
    revision: 1,
    enabled: true,
    profile: { model: "future-responses-model", reasoning: "future_effort" },
  });
  expect(
    (
      await profileHttp(
        "/admin/profiles/future",
        "PUT",
        { expected_revision: 0, profile },
        adminToken,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await profileHttp(
        "/admin/profiles/future",
        "DELETE",
        { expected_revision: 1 },
        adminToken,
      )
    ).status,
  ).toBe(200);
  const listed = (await (await profileHttp("/profiles")).json()) as any;
  expect(listed.profiles.find((p: any) => p.id === "future")).toMatchObject({
    enabled: false,
    revision: 2,
  });
  expect(calls).toBe(before);
});
it("retains original resolved model and revision for a completed ID after profile changes and disabling", async () => {
  const profile = { ...cfg.profiles["astra-medium"] };
  expect(
    (
      await profileHttp(
        "/admin/profiles/mutable",
        "PUT",
        { expected_revision: 0, profile },
        adminToken,
      )
    ).status,
  ).toBe(200);
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
    request_id: "profile-snapshot-1",
    profile: "mutable",
    input_sha256: "",
  };
  input.input_sha256 = await inputHash(input);
  const outcome = JSON.parse(
    (
      await decode(
        await rpc("tools/call", { name: "review", arguments: input }),
      )
    ).result.content[0].text,
  );
  expect(outcome).toMatchObject({
    status: "completed",
    requested_model: "gpt-6.2-astra",
    profile_revision: 1,
  });
  const after = calls;
  expect(
    (
      await profileHttp(
        "/admin/profiles/mutable",
        "PUT",
        {
          expected_revision: 1,
          profile: { ...profile, model: "new-responses-model" },
        },
        adminToken,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await profileHttp(
        "/admin/profiles/mutable",
        "DELETE",
        { expected_revision: 2 },
        adminToken,
      )
    ).status,
  ).toBe(200);
  const duplicate = JSON.parse(
    (
      await decode(
        await rpc("tools/call", { name: "review", arguments: input }),
      )
    ).result.content[0].text,
  );
  expect(duplicate).toMatchObject({
    status: "completed",
    requested_model: "gpt-6.2-astra",
    profile_revision: 1,
  });
  expect(calls).toBe(after);
  const disabled = JSON.parse(
    (
      await decode(
        await rpc("tools/call", {
          name: "review",
          arguments: { ...input, request_id: "profile-snapshot-2" },
        }),
      )
    ).result.content[0].text,
  );
  expect(disabled.status).toBe("profile_not_allowed");
  expect(calls).toBe(after);
});

it("persists safe unknown diagnostics without releasing budget or invoking the provider again", async () => {
  const input = {
    schema_version: 1 as const,
    task_kind: "code" as const,
    requirements: "Synthetic unknown diagnostic",
    files: [
      { path: "sample.ts", start_line: 1, content: "export const value = 1;" },
    ],
    diff: "",
    request_id: "synthetic-unknown-diagnostic",
    profile: "astra-medium",
    input_sha256: "",
  };
  input.input_sha256 = await inputHash(input);
  const before = calls;
  malformedProviderBody = true;
  try {
    const outcome = JSON.parse(
      (
        await decode(
          await rpc("tools/call", { name: "review", arguments: input }),
        )
      ).result.content[0].text,
    );
    expect(outcome).toMatchObject({
      status: "unknown",
      unknown_reason: "response_invalid_json",
      api_request_id: "req_malformed_fixture",
    });
    const row = await (
      await mf.getD1Database("DB")
    )
      .prepare(
        "SELECT state,reserved_microusd,charged_microusd,metadata FROM requests WHERE request_id=?",
      )
      .bind(input.request_id)
      .first<any>();
    expect(row.state).toBe("unknown");
    expect(row.charged_microusd).toBe(row.reserved_microusd);
    const totals = await (
      await mf.getD1Database("DB")
    )
      .prepare(
        "SELECT SUM(charged_microusd) AS total, COUNT(*) AS count, SUM(state IN ('reserved','unknown')) AS active FROM requests",
      )
      .first<any>();
    expect(cfg.limits.maxConcurrent).toBe(1);
    expect(totals.active).toBe(1);
    expect(row.reserved_microusd).toBeLessThanOrEqual(
      cfg.limits.requestMicrousd,
    );
    expect(totals.total + row.reserved_microusd).toBeLessThanOrEqual(
      cfg.limits.dailyMicrousd,
    );
    expect(totals.total + row.reserved_microusd).toBeLessThanOrEqual(
      cfg.limits.monthlyMicrousd,
    );
    expect(totals.count + 1).toBeLessThanOrEqual(cfg.limits.dailyRequests);
    expect(JSON.parse(row.metadata)).toMatchObject({
      unknown_reason: "response_invalid_json",
      api_request_id: "req_malformed_fixture",
    });
    expect(row.metadata).not.toContain("private malformed");
    const replay = JSON.parse(
      (
        await decode(
          await rpc("tools/call", { name: "review", arguments: input }),
        )
      ).result.content[0].text,
    );
    expect(replay).toMatchObject({
      status: "unknown",
      unknown_reason: "response_invalid_json",
      result_replay_available: false,
    });
    const blocked = JSON.parse(
      (
        await decode(
          await rpc("tools/call", {
            name: "review",
            arguments: { ...input, request_id: "synthetic-unknown-blocked" },
          }),
        )
      ).result.content[0].text,
    );
    expect(blocked.status).toBe("limit_exceeded");
    expect(calls).toBe(before + 1);
  } finally {
    malformedProviderBody = false;
    // Isolated fixture cleanup so this unknown does not occupy the slot for unrelated tests.
    await (
      await mf.getD1Database("DB")
    )
      .prepare("DELETE FROM requests WHERE request_id=?")
      .bind(input.request_id)
      .run();
  }
});

it("routes a Claude profile through its own Worker secret with persistent deduplication", async () => {
  const input = {
    schema_version: 2 as const,
    provider: "anthropic" as const,
    task_kind: "code" as const,
    requirements: "Synthetic Claude",
    files: [{ path: "fixture.ts", start_line: 1, content: "return 1;" }],
    diff: "",
    request_id: "synthetic-claude-worker",
    profile: "claude-medium",
    input_sha256: "",
  };
  input.input_sha256 = await inputHash(input);
  const before = anthropicCalls;
  const result = JSON.parse(
    (
      await decode(
        await rpc("tools/call", { name: "review", arguments: input }),
      )
    ).result.content[0].text,
  );
  expect(result).toMatchObject({
    status: "completed",
    requested_provider: "anthropic",
    api_request_id: "req_worker_claude",
  });
  const replay = JSON.parse(
    (
      await decode(
        await rpc("tools/call", { name: "review", arguments: input }),
      )
    ).result.content[0].text,
  );
  expect(replay.result_replay_available).toBe(false);
  expect(anthropicCalls).toBe(before + 1);
  const row = await (
    await mf.getD1Database("DB")
  )
    .prepare("SELECT metadata FROM requests WHERE request_id=?")
    .bind(input.request_id)
    .first<any>();
  expect(JSON.parse(row.metadata).requested_provider).toBe("anthropic");
  expect(row.metadata).not.toContain("fake-anthropic");
});

it("keeps Worker metadata available without a provider key and never reserves a missing-key request", async () => {
  for (const only of ["openai", "anthropic", "neither"]) {
    const missing = only === "anthropic" ? "astra-medium" : "claude-medium";
    let outbound = 0;
    const isolated = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "missing-provider",
            modules: [{ type: "ESModule", path: "dist/worker.js" }],
            compatibilityDate: "2026-11-12",
            compatibilityFlags: ["nodejs_compat"],
            d1Databases: ["DB"],
            bindings: {
              REBUT_CONFIG: JSON.stringify(cfg),
              AUTH_TOKENS: JSON.stringify({
                test: createHash("sha256").update(token).digest("hex"),
              }),
              ...(only === "openai"
                ? { OPENAI_API_KEY: "fake-openai" }
                : only === "anthropic"
                  ? { ANTHROPIC_API_KEY: "fake-anthropic" }
                  : {}),
            },
            outboundService: async () => {
              outbound++;
              throw Error("must not call provider");
            },
          },
        ],
      }),
    );
    try {
      const db = await isolated.getD1Database("DB");
      for (const statement of (
        readFileSync("migrations/0001_ledger.sql", "utf8") +
        readFileSync("migrations/0002_profiles.sql", "utf8")
      )
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean))
        await db.prepare(statement).run();
      const raw = {
        schema_version: 2 as const,
        provider:
          missing === "astra-medium"
            ? ("openai" as const)
            : ("anthropic" as const),
        request_id: "missing-provider-key",
        profile: missing,
        input_sha256: "",
        task_kind: "code" as const,
        requirements: "Synthetic",
        files: [{ path: "a.ts", start_line: 1, content: "return 1;" }],
        diff: "",
      };
      raw.input_sha256 = await inputHash(raw);
      const request = async (method: string, params: unknown) =>
        decode(
          await isolated.dispatchFetch("http://127.0.0.1/mcp", {
            method: "POST",
            headers: {
              Host: "127.0.0.1",
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "MCP-Protocol-Version": "2025-03-26",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          }),
        );
      const failure = await request("tools/call", {
        name: "review",
        arguments: raw,
      });
      expect(failure.result.isError).toBe(true);
      expect(JSON.parse(failure.result.content[0].text).status).toBe(
        "provider_key_unavailable",
      );
      const status = await request("tools/call", {
        name: "review_status",
        arguments: { request_id: raw.request_id },
      });
      expect(JSON.parse(status.result.content[0].text).status).toBe(
        "not_found",
      );
      expect(
        (await db.prepare("SELECT COUNT(*) AS n FROM requests").first<any>()).n,
      ).toBe(0);
      expect(outbound).toBe(0);
    } finally {
      await isolated.dispose();
    }
  }
}, 20000);

it("lists only the caller's pending rows, formats authoritative amounts, and truncates at 100", async () => {
  const db = await mf.getD1Database("DB");
  const before = calls + anthropicCalls;
  const insert = (
    principal: string,
    id: string,
    state: string,
    reserved: number,
    charged: number,
  ) =>
    db
      .prepare(
        "INSERT INTO requests (principal,request_id,fingerprint,input_sha256,profile,claim,created_at,day,month,state,reserved_microusd,charged_microusd,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        principal,
        id,
        "fixture-fingerprint",
        "fixture-hash",
        "fixture-profile",
        "fixture-claim",
        "2026-11-23T00:00:00.000Z",
        "2026-11-23",
        "2026-11",
        state,
        reserved,
        charged,
        JSON.stringify({
          request_id: "wrong-id",
          budget_reserved_microusd: 99999,
        }),
      );
  await db.batch([
    ...Array.from({ length: 101 }, (_, i) =>
      insert(
        "recovery",
        "pending-" + String(i).padStart(3, "0"),
        i % 2 ? "unknown" : "reserved",
        42,
        7,
      ),
    ),
    insert("other", "pending-private", "unknown", 88, 80),
    insert("recovery", "pending-ignored", "completed", 43, 9),
  ]);
  try {
    const call = async (bearer: string, name: string, args: object) =>
      JSON.parse(
        (
          await decode(
            await rpc("tools/call", { name, arguments: args }, bearer),
          )
        ).result.content[0].text,
      );
    const own = await call(recoveryToken, "review_pending", {});
    expect(own.requests).toHaveLength(100);
    expect(own.has_more).toBe(true);
    expect(own.requests[0]).toMatchObject({
      request_id: "pending-000",
      status: "reserved",
      profile: "fixture-profile",
      budget_reserved_microusd: 42,
      budget_accounted_microusd: 7,
      result_replay_available: false,
    });
    expect(Object.keys(own.requests[0]).sort()).toEqual([
      "budget_accounted_microusd",
      "budget_reserved_microusd",
      "created_at",
      "input_sha256",
      "profile",
      "request_id",
      "result_replay_available",
      "status",
    ]);
    expect(own.requests.at(-1).request_id).toBe("pending-099");
    expect(
      own.requests.some(
        (request: any) => "principal" in request || "review" in request,
      ),
    ).toBe(false);
    expect(await call(otherToken, "review_pending", {})).toMatchObject({
      requests: [
        {
          request_id: "pending-private",
          status: "unknown",
          budget_reserved_microusd: 88,
          budget_accounted_microusd: 80,
        },
      ],
      has_more: false,
    });
    expect(
      await call(recoveryToken, "review_status", {
        request_id: "pending-private",
      }),
    ).toEqual({ status: "not_found" });
    expect(
      await call(otherToken, "review_status", { request_id: "pending-000" }),
    ).toEqual({ status: "not_found" });
    expect(
      await call(recoveryToken, "review_status", { request_id: "pending-100" }),
    ).toMatchObject({
      status: "reserved",
      budget_reserved_microusd: 42,
      budget_accounted_microusd: 7,
    });
    expect(calls + anthropicCalls).toBe(before);
  } finally {
    await db
      .prepare("DELETE FROM requests WHERE request_id LIKE 'pending-%'")
      .run();
  }
}, 20000);

it("keeps budget aggregates and the one-time schedule behind Worker admin auth", async () => {
  const request = (path: string, method: string, bearer: string) =>
    mf.dispatchFetch("http://127.0.0.1" + path, {
      method,
      headers: { Authorization: `Bearer ${bearer}` },
    });
  const admin = "synthetic-admin-token-not-a-secret";
  const path = "/admin/budget";
  const before = calls + anthropicCalls;
  expect((await request(path, "GET", token)).status).toBe(401);
  expect((await request(path + "/start-day/15", "PUT", token)).status).toBe(
    401,
  );
  expect(await (await request(path, "GET", admin)).json()).toMatchObject({
    monthly_start_day: 1,
    effective_at: null,
    max_concurrent: cfg.limits.maxConcurrent,
  });
  expect((await request(path + "/start-day/15", "PUT", admin)).status).toBe(
    503,
  );
  const db = await mf.getD1Database("DB");
  // Prepare complete statements so the semicolon inside the trigger stays intact.
  const migration = readFileSync("migrations/0003_budget_cycle.sql", "utf8");
  const trigger = migration.indexOf("CREATE TRIGGER");
  for (const statement of migration
    .slice(0, trigger)
    .split(";")
    .map((s) => s.trim())) {
    if (
      statement &&
      !statement.split("\n").every((line) => line.startsWith("--"))
    )
      await db.prepare(statement).run();
  }
  await db.prepare(migration.slice(trigger)).run();
  const update = await request(path + "/start-day/15", "PUT", admin);
  expect(update.status).toBe(200);
  expect(await update.json()).toMatchObject({
    status: "configured",
    monthly_start_day: 15,
  });
  expect((await request(path + "/start-day/2", "PUT", admin)).status).toBe(409);
  expect(await (await request(path, "GET", admin)).json()).toMatchObject({
    monthly_start_day: 15,
    monthly_limit_microusd: cfg.limits.monthlyMicrousd,
    effective_at: expect.any(String),
    next_reset_at: expect.any(String),
  });
  // Exercise the guard in the D1 emulator using the legacy insert shape.
  await expect(
    db
      .prepare(
        `INSERT INTO requests
    (principal,request_id,fingerprint,input_sha256,profile,claim,created_at,day,month,state,reserved_microusd,charged_microusd)
    VALUES ('test','old-writer','f','h','p','c','2026-11-15T00:00:00.000Z','2026-11-15','2026-11','reserved',1,1)`,
      )
      .run(),
  ).rejects.toThrow(/budget_schedule_changed/);
  expect(calls + anthropicCalls).toBe(before);
}, 20000);
