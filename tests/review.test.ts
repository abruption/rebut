import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inputHash,
  ReviewInputSchema,
  type Profile,
  type ReviewInput,
} from "../src/contracts.js";
import {
  buildReviewBody,
  estimateReservation,
  runReview,
} from "../src/review.js";

const profile: Profile = {
  model: "test-model",
  reasoning: "low",
  maxOutputTokens: 1000,
  inputMicrousdPerMillion: 2_000_000,
  outputMicrousdPerMillion: 8_000_000,
  priceVersion: "test-v1",
};
const input: ReviewInput = {
  schema_version: 1,
  request_id: "req-1",
  profile: "default",
  input_sha256: "a".repeat(64),
  task_kind: "code",
  requirements: "Preserve input.",
  files: [
    { path: "src/a.ts", start_line: 8, content: "return 0;\nreturn 1;\n" },
  ],
  diff: "",
};
const review = {
  summary: "Input is lost.",
  additional_evidence: [],
  findings: [
    {
      severity: "high",
      title: "Input discarded",
      explanation: "Returns a constant.",
      path: "src/a.ts",
      line: 8,
      end_line: 9,
      counterexample: "Input 2 returns 0.",
      remediation: "Return the input.",
    },
  ],
};
function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: "resp_test",
    model: "test-model-2026-11-01",
    status: "completed",
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 10 },
      output_tokens_details: { reasoning_tokens: 5 },
    },
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(review) }],
      },
    ],
    ...overrides,
  };
}
const mockFetch = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "x-request-id": "req_api" },
    }),
  );
afterEach(() => vi.useRealTimers());

describe("review input contract", () => {
  it("requires strict and bounded fields", () => {
    expect(ReviewInputSchema.safeParse(input).success).toBe(true);
    for (const patch of [
      { extra: true },
      { request_id: "bad id" },
      { request_id: "x".repeat(81) },
      { profile: "x".repeat(65) },
      { schema_version: 2 },
      { input_sha256: "abc" },
      { requirements: "x".repeat(16001) },
      { diff: "x".repeat(100001) },
      { files: [] },
      {
        files: Array.from({ length: 41 }, (_, n) => ({
          ...input.files[0],
          path: `file${n}`,
        })),
      },
    ]) {
      expect(ReviewInputSchema.safeParse({ ...input, ...patch }).success).toBe(
        false,
      );
    }
  });
  it("rejects unsafe, duplicated paths, invalid line numbers and oversized UTF-8", () => {
    for (const path of [
      "/a",
      "../a",
      "a/../b",
      "a//b",
      "a/./b",
      "C:/a",
      "a\\b",
      "a\nb",
    ]) {
      expect(
        ReviewInputSchema.safeParse({
          ...input,
          files: [{ ...input.files[0], path }],
        }).success,
      ).toBe(false);
    }
    expect(
      ReviewInputSchema.safeParse({
        ...input,
        files: [input.files[0], input.files[0]],
      }).success,
    ).toBe(false);
    expect(
      ReviewInputSchema.safeParse({
        ...input,
        files: [{ ...input.files[0], start_line: 0 }],
      }).success,
    ).toBe(false);
    expect(
      ReviewInputSchema.safeParse({
        ...input,
        files: [{ ...input.files[0], content: "한".repeat(43_000) }],
      }).success,
    ).toBe(false);
    expect(
      ReviewInputSchema.safeParse({
        ...input,
        files: [],
        diff: "nonempty diff",
      }).success,
    ).toBe(true);
  });
  it("hashes only review evidence in canonical key order", async () => {
    const hash = await inputHash(input);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await inputHash({
        ...input,
        request_id: "different",
        profile: "other",
        input_sha256: "b".repeat(64),
      } as ReviewInput),
    ).toBe(hash);
    expect(
      await inputHash({
        ...input,
        files: [
          { content: input.files[0]!.content, start_line: 8, path: "src/a.ts" },
        ],
      }),
    ).toBe(hash);
    expect(await inputHash({ ...input, requirements: "Changed" })).not.toBe(
      hash,
    );
  });
});

describe("reservation and request", () => {
  it("reserves full serialized body bytes plus framing and maximum output without cache discount", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify(buildReviewBody(input, profile)),
    ).length;
    expect(estimateReservation(input, profile)).toBe(
      Math.ceil(((bytes + 4096) * 2_000_000 + 1000 * 8_000_000) / 1_000_000),
    );
  });
  it("uses fixed endpoint, strict output, no storage or tools, and records validated usage", async () => {
    const fetcher = mockFetch(payload());
    const result = await runReview(input, profile, "fake-key", fetcher);
    expect(result).toEqual({
      status: "completed",
      review,
      response_id: "resp_test",
      api_request_id: "req_api",
      requested_model: "test-model",
      actual_model: "test-model-2026-11-01",
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cached_tokens: 10,
        reasoning_tokens: 5,
      },
      estimated_cost_microusd: 360,
      price_version: "test-v1",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options?.redirect).toBe("manual");
    const body = JSON.parse(options?.body as string);
    expect(body.store).toBe(false);
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(body.input).not.toContain("prompt_cache_breakpoint");
    expect(body.service_tier).toBe("default");
    expect(body.tools).toBeUndefined();
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
      schema: { additionalProperties: false },
    });
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.max_output_tokens).toBe(1000);
  });
});

describe("response validation", () => {
  it("distinguishes refusal and incomplete responses", async () => {
    const refused = payload({
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "refusal", refusal: "No." }],
        },
      ],
    });
    expect(
      (await runReview(input, profile, "fake", mockFetch(refused))).status,
    ).toBe("refused");
    expect(
      (
        await runReview(
          input,
          profile,
          "fake",
          mockFetch(payload({ status: "incomplete" })),
        )
      ).status,
    ).toBe("incomplete");
  });
  it("rejects malformed structured output and ungrounded line/path references", async () => {
    for (const value of [
      { ...review, extra: "bad" },
      {
        ...review,
        findings: [{ ...review.findings[0], path: "not-supplied.ts" }],
      },
      { ...review, findings: [{ ...review.findings[0], end_line: 10 }] },
      {
        ...review,
        findings: [{ ...review.findings[0], line: 9, end_line: 8 }],
      },
      { ...review, findings: [{ ...review.findings[0], counterexample: "" }] },
    ]) {
      const body = payload({
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: JSON.stringify(value) }],
          },
        ],
      });
      expect(
        (await runReview(input, profile, "fake", mockFetch(body))).status,
      ).toBe("invalid_output");
    }
    const invalidJson = payload({
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "secret invalid JSON" }],
        },
      ],
    });
    expect(
      (await runReview(input, profile, "fake", mockFetch(invalidJson))).status,
    ).toBe("invalid_output");
  });
  it("accepts exact unified-diff new-side lines but rejects omitted gaps", async () => {
    const diffInput = {
      ...input,
      files: [],
      diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -8,2 +8,2 @@\n-return old;\n+return 0;\n return 1;\n",
    };
    expect(
      (await runReview(diffInput, profile, "fake", mockFetch(payload())))
        .status,
    ).toBe("completed");
    expect(
      (
        await runReview(
          {
            ...diffInput,
            diff: diffInput.diff
              .replace("@@ -8,2 +8,2 @@", "@@ -8 +8 @@")
              .replace(" return 1;\n", ""),
          },
          profile,
          "fake",
          mockFetch(payload()),
        )
      ).status,
    ).toBe("invalid_output");
  });
  it("does not count invalid usage as a completed review", async () => {
    for (const usage of [
      undefined,
      { input_tokens: -1 },
      {
        input_tokens: 1,
        output_tokens: 2,
        total_tokens: 3,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 999,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    ]) {
      const result = await runReview(
        input,
        profile,
        "fake",
        mockFetch(payload({ usage })),
      );
      expect(result.status).toBe("unknown");
      expect(result.usage).toBeUndefined();
      expect(result.review).toBeUndefined();
    }
  });
  it("rejects mismatched model identity before calculating settled usage", async () => {
    const result = await runReview(
      input,
      profile,
      "fake",
      mockFetch(payload({ model: "different-model" })),
    );
    expect(result.status).toBe("unknown");
    expect(result.usage).toBeUndefined();
    expect(result.estimated_cost_microusd).toBeUndefined();
  });
  it("bounds response bytes even without a content-length header", async () => {
    const result = await runReview(
      input,
      profile,
      "fake",
      mockFetch({ private: "x".repeat(1_000_001) }),
    );
    expect(result.status).toBe("unknown");
    expect(result.review).toBeUndefined();
  });
  it("returns unknown without upstream bodies, exception strings, or retries", async () => {
    for (const status of [400, 401, 429, 500]) {
      const fetcher = mockFetch({ error: "private-upstream-error" }, status);
      const result = await runReview(input, profile, "fake", fetcher);
      expect(result.status).toBe("unknown");
      expect(result.upstream_status).toBe(status);
      expect(JSON.stringify(result)).not.toContain("private-upstream-error");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private-fetch-error"));
    expect(
      JSON.stringify(await runReview(input, profile, "fake", fetcher)),
    ).not.toContain("private-fetch-error");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const invalidJsonFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not JSON"));
    expect(
      (await runReview(input, profile, "fake", invalidJsonFetcher)).status,
    ).toBe("unknown");
  });
  it("bounds the entire request including uncooperative fetch to 45 seconds", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const promise = runReview(input, profile, "fake", fetcher);
    await vi.advanceTimersByTimeAsync(45_000);
    expect((await promise).status).toBe("unknown");
    expect((fetcher.mock.calls[0]![1]?.signal as AbortSignal).aborted).toBe(
      true,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
