import { afterEach, expect, it, vi } from "vitest";
import {
  runReview,
  buildReviewBody,
  estimateReservation,
} from "../src/review.js";
import { anthropicSchema } from "../src/anthropic.js";
import type { Profile, ReviewInput } from "../src/contracts.js";
const profile: Profile = {
  provider: "anthropic",
  model: "claude-opus-5-5",
  reasoning: "medium",
  maxOutputTokens: 8192,
  inputMicrousdPerMillion: 4_000_000,
  outputMicrousdPerMillion: 20_000_000,
  priceVersion: "fixture",
};
const input: ReviewInput = {
  schema_version: 1,
  request_id: "anthropic-1",
  profile: "claude-medium",
  input_sha256: "a".repeat(64),
  task_kind: "code",
  requirements: "Return input",
  files: [{ path: "a.ts", start_line: 1, content: "return 0;\n" }],
  diff: "",
};
const review = {
  summary: "Input discarded",
  findings: [
    {
      severity: "high",
      title: "Constant",
      explanation: "Returns zero",
      path: "a.ts",
      line: 1,
      end_line: 1,
      counterexample: "Input 2 returns 0",
      remediation: "Return input",
    },
  ],
  additional_evidence: [],
};
const key = "synthetic-anthropic-key-not-real-123456789";
function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: profile.model,
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "PRIVATE_THINKING_SENTINEL" },
      { type: "text", text: JSON.stringify(review) },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 0,
      service_tier: "standard",
      inference_geo: "global",
      speed: "standard",
    },
    ...overrides,
  };
}
function mocked(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "request-id": "req_anthropic" },
    }),
  );
}
afterEach(() => vi.useRealTimers());
it("sends only the Claude protocol and validates a grounded structured result with conservative usage", async () => {
  const fetcher = mocked(payload());
  const result = await runReview(input, profile, key, fetcher);
  expect(result.status).toBe("completed");
  expect(result.requested_provider).toBe("anthropic");
  expect(result.api_request_id).toBe("req_anthropic");
  expect(result.usage).toEqual({
    input_tokens: 120,
    output_tokens: 20,
    cached_tokens: 20,
  });
  expect(result.estimated_cost_microusd).toBe(880);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_THINKING");
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://api.anthropic.com/v1/messages");
  expect(options?.headers).toMatchObject({
    "x-api-key": key,
    "anthropic-version": "2026-10-21",
  });
  expect(options?.redirect).toBe("manual");
  const body = JSON.parse(options!.body as string);
  expect(body).toMatchObject({
    model: profile.model,
    max_tokens: 8192,
    service_tier: "standard_only",
    inference_geo: "global",
    output_config: { effort: "medium", format: { type: "json_schema" } },
  });
  for (const name of [
    "tools",
    "store",
    "prompt_cache_options",
    "cache_control",
    "stream",
  ])
    expect(body).not.toHaveProperty(name);
  const schema = body.output_config.format.schema;
  expect(schema.properties.findings.items.properties.line).toEqual({
    type: "integer",
  });
  expect(schema.additionalProperties).toBe(false);
  expect(
    estimateReservation(input, profile, options!.body as string),
  ).toBeGreaterThan(result.estimated_cost_microusd!);
});
it("keeps the outbound schema restricted while the local full schema still rejects invalid content", async () => {
  expect(() => anthropicSchema({ $ref: "#/bad", type: "object" })).toThrow();
  for (const bad of [
    { ...review, summary: "" },
    { ...review, findings: [{ ...review.findings[0], line: 0 }] },
    { ...review, findings: [{ ...review.findings[0], path: "missing.ts" }] },
  ]) {
    const r = await runReview(
      input,
      profile,
      key,
      mocked(
        payload({ content: [{ type: "text", text: JSON.stringify(bad) }] }),
      ),
    );
    expect(r.status).toBe("invalid_output");
    expect(r.estimated_cost_microusd).toBe(880);
  }
  expect(() =>
    buildReviewBody(input, { ...profile, reasoning: "unsupported" }),
  ).toThrow();
});
it("handles null optional counters without claiming missing thinking as zero", async () => {
  const r = await runReview(
    input,
    profile,
    key,
    mocked(
      payload({
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
          output_tokens_details: null,
          service_tier: null,
          inference_geo: null,
          speed: null,
        },
      }),
    ),
  );
  expect(r.status).toBe("completed");
  expect(r.usage).toEqual({
    input_tokens: 10,
    output_tokens: 20,
    cached_tokens: 0,
  });
  const known = await runReview(
    input,
    profile,
    key,
    mocked(
      payload({
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          output_tokens_details: { thinking_tokens: 5 },
        },
      }),
    ),
  );
  expect(known.usage?.reasoning_tokens).toBe(5);
  expect(known.usage?.output_tokens).toBe(20);
});
it.each(["max_tokens", "model_context_window_exceeded", "refusal"])(
  "settles terminal %s usage before text parsing",
  async (stop_reason) => {
    const r = await runReview(
      input,
      profile,
      key,
      mocked(payload({ stop_reason, content: [] })),
    );
    expect(r.status).toBe(stop_reason === "refusal" ? "refused" : "incomplete");
    expect(r.estimated_cost_microusd).toBe(880);
  },
);
it.each(["end_turn", "max_tokens", "refusal"])(
  "keeps invalid usage unknown even for %s",
  async (stop_reason) => {
    for (const usage of [
      { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 1 },
      { input_tokens: 100, output_tokens: 20, service_tier: "priority" },
      { input_tokens: 100, output_tokens: 20, inference_geo: "us" },
      { input_tokens: 100, output_tokens: 20, speed: "fast" },
      {
        input_tokens: 100,
        output_tokens: 20,
        server_tool_use: { web_search_requests: 1 },
      },
      {
        input_tokens: 100,
        output_tokens: 20,
        output_tokens_details: { thinking_tokens: 21 },
      },
      { input_tokens: 100, output_tokens: 8193 },
      {
        input_tokens: Number.MAX_SAFE_INTEGER,
        cache_read_input_tokens: 1,
        output_tokens: 20,
      },
      { input_tokens: 100, output_tokens: -1 },
      { input_tokens: 100, output_tokens: 20, unexpected_billed_counter: 1 },
      {
        input_tokens: 100,
        output_tokens: 20,
        output_tokens_details: {
          thinking_tokens: 5,
          unexpected_billed_counter: 1,
        },
      },
    ]) {
      const r = await runReview(
        input,
        profile,
        key,
        mocked(payload({ stop_reason, usage })),
      );
      expect(r.status).toBe("unknown");
      expect(r.unknown_reason).toBe("usage_invalid");
      expect(r.estimated_cost_microusd).toBeUndefined();
    }
  },
);
it("rejects unexpected content, duplicate text, and model mismatch without a second request", async () => {
  for (const content of [
    [
      {
        type: "tool_use",
        id: "bad",
        name: "shell",
        input: { command: "never execute" },
      },
    ],
    [
      { type: "text", text: JSON.stringify(review) },
      { type: "text", text: JSON.stringify(review) },
    ],
  ]) {
    const fetcher = mocked(payload({ content }));
    const r = await runReview(input, profile, key, fetcher);
    expect(r.status).toBe("invalid_output");
    expect(fetcher).toHaveBeenCalledOnce();
  }
  const r = await runReview(
    input,
    profile,
    key,
    mocked(payload({ model: "different-model" })),
  );
  expect(r.unknown_reason).toBe("model_mismatch");
  expect(
    (
      await runReview(
        input,
        profile,
        key,
        mocked(payload({ model: profile.model + "-20261101" })),
      )
    ).status,
  ).toBe("completed");
});
it.each(["tool_use", "pause_turn", "stop_sequence"])(
  "does not resume or retry unexpected stop %s",
  async (stop_reason) => {
    const fetcher = mocked(payload({ stop_reason }));
    const r = await runReview(input, profile, key, fetcher);
    expect(r.status).toBe("unknown");
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it("preserves only allowlisted HTTP error metadata", async () => {
  const r = await runReview(
    input,
    profile,
    key,
    mocked(
      {
        type: "error",
        error: { type: "overloaded_error", message: "PRIVATE_ERROR_BODY" },
      },
      529,
    ),
  );
  expect(r).toMatchObject({
    status: "unknown",
    unknown_reason: "provider_http_error",
    upstream_status: 529,
    upstream_error_code: "overloaded_error",
    api_request_id: "req_anthropic",
  });
  expect(JSON.stringify(r)).not.toContain("PRIVATE_ERROR");
  const hidden = await runReview(
    input,
    profile,
    key,
    mocked({ error: { type: "SECRET_UNRECOGNIZED_ERROR" } }, 401),
  );
  expect(hidden.upstream_error_code).toBeUndefined();
});
it("retains finite timeout and cancellation with exactly one Claude call", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
  const p = runReview(input, profile, key, fetcher);
  await vi.advanceTimersByTimeAsync(1_800_001);
  expect((await p).unknown_reason).toBe("provider_timeout");
  expect(fetcher).toHaveBeenCalledOnce();
  const controller = new AbortController();
  const p2 = runReview(input, profile, key, fetcher, controller.signal);
  controller.abort();
  expect((await p2).unknown_reason).toBe("execution_aborted");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("uses the shared bounded body reader", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response("{}", { headers: { "content-length": "1000001" } }),
    );
  const r = await runReview(input, profile, key, fetcher);
  expect(r.unknown_reason).toBe("response_too_large");
});
