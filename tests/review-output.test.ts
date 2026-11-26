import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
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

const material = {
  schema_version: 2 as const,
  task_kind: "code" as const,
  requirements: "AC-1: Preserve entries.\nAC-2: Preserve caller behavior.",
  files: [
    {
      path: "src/example.ts",
      start_line: 10,
      content: "line one\nline two\nline three",
    },
  ],
  diff: "",
};
function profile(provider: "openai" | "anthropic"): Profile {
  return {
    provider,
    model: provider === "openai" ? "gpt-6-luna" : "claude-haiku-5-5",
    reasoning: "medium",
    maxOutputTokens: 8192,
    inputMicrousdPerMillion: 500000,
    outputMicrousdPerMillion: 2500000,
    priceVersion: "mock-rates",
  };
}
async function input(provider: "openai" | "anthropic", extended = true) {
  const selection = {
    ...material,
    provider,
    ...(extended
      ? {
          result_format: {
            version: 2 as const,
            criterion_ids: ["AC-1", "AC-2"],
          },
        }
      : {}),
  };
  return ReviewInputSchema.parse({
    ...selection,
    profile: "fixture-profile",
    request_id: "fixture-id",
    input_sha256: await inputHash(selection),
  });
}
const reference = { path: "src/example.ts", line: 10, end_line: 10 };
const finding = {
  ...reference,
  severity: "medium",
  title: "Entry lost",
  explanation: "The input is discarded.",
  counterexample: "A nonempty input becomes empty.",
  remediation: "Preserve the input.",
};
const oldReview = {
  summary: "An entry is lost.",
  additional_evidence: [],
  findings: [finding],
};
const extendedReview = {
  ...oldReview,
  findings: [
    {
      ...finding,
      requirement_refs: ["AC-1"],
      reproduction: [
        { kind: "test", suggestion: "Pass one entry and expect it back." },
      ],
    },
  ],
  requirement_coverage: [
    {
      criterion_ref: "AC-1",
      status: "assessed",
      evidence: [reference, { ...reference, line: 11, end_line: 11 }],
    },
  ],
};
function respond(
  provider: "openai" | "anthropic",
  review: unknown,
  cutoff = false,
  output = cutoff ? profile(provider).maxOutputTokens : 500,
) {
  const text = cutoff ? '{"summary":' : JSON.stringify(review);
  const selected = profile(provider);
  return vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json(
      provider === "anthropic"
        ? {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            model: selected.model,
            stop_reason: cutoff ? "max_tokens" : "end_turn",
            usage: { input_tokens: 100, output_tokens: output },
            content: [{ type: "text", text }],
          }
        : {
            id: "resp_fixture",
            model: selected.model,
            status: cutoff ? "incomplete" : "completed",
            usage: {
              input_tokens: 100,
              output_tokens: output,
              total_tokens: 100 + output,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 20 },
            },
            output: [
              {
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text }],
              },
            ],
          },
    ),
  );
}

it.each(["openai", "anthropic"] as const)(
  "%s receives physical citation ranges and rejects embedded coordinates in both formats",
  async (provider) => {
    const file = {
      path: "packet.md",
      start_line: 10,
      content: "### src/example.ts\n42 | return 0;\n\n",
    };
    const active = profile(provider);
    for (const extended of [false, true]) {
      const selected = { ...(await input(provider, extended)), files: [file] };
      selected.input_sha256 = await inputHash(selected);
      const body = buildReviewBody(selected, active);
      const material = JSON.parse(
        "input" in body ? body.input : body.messages[0]!.content,
      );
      expect(material.citation_ranges).toEqual([
        { path: "packet.md", ranges: [[10, 12]] },
      ]);
      expect(material.files).toEqual([file]);
      const base = extended ? extendedReview : oldReview;
      const submit = async (path: string, line: number) => {
        const coordinates = { path, line, end_line: line };
        return runReview(
          selected,
          active,
          "synthetic",
          respond(provider, {
            ...base,
            findings: [{ ...base.findings[0], ...coordinates }],
            ...(extended
              ? {
                  requirement_coverage: [
                    {
                      ...extendedReview.requirement_coverage[0],
                      evidence: [coordinates],
                    },
                  ],
                }
              : {}),
          }),
        );
      };
      for (const [path, line] of [
        ["src/example.ts", 42],
        ["packet.md", 42],
      ] as const) {
        expect(await submit(path, line)).toMatchObject({
          status: "invalid_output",
          invalid_output_reason: "ungrounded_finding",
        });
      }
      expect(await submit("packet.md", 11)).toMatchObject({
        status: "completed",
      });
    }
  },
);

it("unions overlapping file and diff spans and keeps gaps and unsupplied lines out", async () => {
  const selected = {
    ...(await input("openai", false)),
    files: [
      { path: "src/changed.ts", start_line: 22, content: " tail\nnext\n" },
    ],
    diff: [
      "diff --git a/src/changed.ts b/src/changed.ts",
      "--- a/src/changed.ts",
      "+++ b/src/changed.ts",
      "@@ -50 +51,2 @@",
      "-old",
      "+new",
      "+new",
      "@@ -10,3 +20,3 @@",
      " context",
      "-old",
      "+new",
      " tail",
      "@@ -70 +80,4 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
  };
  selected.input_sha256 = await inputHash(selected);
  const active = profile("openai");
  const body = buildReviewBody(selected, active);
  if (!("input" in body)) throw Error("OpenAI body expected");
  expect(JSON.parse(body.input).citation_ranges).toEqual([
    { path: "src/changed.ts", ranges: [[20, 23], [51, 52], [80, 80]] },
  ]);
  const submit = (line: number, end_line: number) =>
    runReview(
      selected,
      active,
      "synthetic",
      respond("openai", {
        ...oldReview,
        findings: [{ ...finding, path: "src/changed.ts", line, end_line }],
      }),
    );
  expect(await submit(20, 23)).toMatchObject({ status: "completed" });
  expect(await submit(23, 51)).toMatchObject({
    status: "invalid_output",
    invalid_output_reason: "ungrounded_finding",
  });
  expect(await submit(80, 81)).toMatchObject({
    status: "invalid_output",
    invalid_output_reason: "ungrounded_finding",
  });
});

it.each(["openai", "anthropic"] as const)(
  "%s omits an oversized citation hint without changing the evidence or instructions",
  async (provider) => {
    const selected = {
      ...(await input(provider, false)),
      files: Array.from({ length: 20 }, (_, i) => ({
        path: `src/${"a".repeat(470)}/${i}.ts`,
        start_line: 10,
        content: "line one\nline two",
      })),
    };
    selected.input_sha256 = await inputHash(selected);
    expect(ReviewInputSchema.safeParse(selected).success).toBe(true);
    const body = buildReviewBody(selected, profile(provider));
    const material = JSON.parse(
      "input" in body ? body.input : body.messages[0]!.content,
    );
    expect(material).toMatchObject({ files: selected.files });
    expect(material).not.toHaveProperty("citation_ranges");
    expect("input" in body ? body.instructions : body.system).toContain(
      "count physical lines",
    );
  },
);

it("preserves v0.5.0 hashes for unselected output and pins the ordered opt-in criteria", async () => {
  const legacy = await input("openai", false);
  expect(legacy.input_sha256).toBe(
    "87e2cb2f8a76f9208a638c63f67e89c810650417df57109c7e328bbf9247c152",
  );
  const v1 = { ...legacy, schema_version: 1 as const, provider: undefined };
  expect(await inputHash(v1)).toBe(
    "80543aaac2b9373717f434967cff60d8ac0fa15779c1ccee14d2519d5dc22f4f",
  );
  const extended = await input("openai");
  expect(extended.input_sha256).not.toBe(legacy.input_sha256);
  expect(
    await inputHash({
      ...extended,
      result_format: { criterion_ids: ["AC-1", "AC-2"], version: 2 },
    }),
  ).toBe(extended.input_sha256);
  expect(
    await inputHash({
      ...extended,
      result_format: { version: 2, criterion_ids: ["AC-2", "AC-1"] },
    }),
  ).not.toBe(extended.input_sha256);
  expect(await inputHash({ ...extended, provider: "anthropic" })).not.toBe(
    extended.input_sha256,
  );
});

it("requires one case-sensitive, anchored and nonempty requirements line for every supplied ID", async () => {
  const valid = await input("openai");
  for (const patch of [
    { schema_version: 1, provider: undefined },
    { result_format: { version: 1, criterion_ids: ["AC-1"] } },
    { result_format: { version: 2, criterion_ids: [] } },
    { result_format: { version: 2, criterion_ids: ["AC-1", "AC-1"] } },
    { result_format: { version: 2, criterion_ids: ["ac-1"] } },
    {
      requirements:
        "See AC-1: Preserve entries.\nAC-2: Preserve caller behavior.",
    },
    {
      requirements: "AC-10: Preserve entries.\nAC-2: Preserve caller behavior.",
    },
    { requirements: "AC-1: \nAC-2: Preserve caller behavior." },
    { requirements: valid.requirements + "\nAC-1: Duplicate." },
  ])
    expect(ReviewInputSchema.safeParse({ ...valid, ...patch }).success).toBe(
      false,
    );
});

it.each(["openai", "anthropic"] as const)(
  "%s selects and validates the matching response format and reserves for its request body",
  async (provider) => {
    const oldInput = await input(provider, false);
    const selected = await input(provider);
    const active = profile(provider);
    const body: any = buildReviewBody(selected, active);
    const schema =
      provider === "openai"
        ? body.text.format.schema
        : body.output_config.format.schema;
    expect(schema.required).toContain("requirement_coverage");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.findings.items.required).toContain("reproduction");
    expect(schema.properties.findings.items.additionalProperties).toBe(false);
    expect(
      schema.properties.requirement_coverage.items.additionalProperties,
    ).toBe(false);
    const payload = JSON.parse(
      provider === "openai" ? body.input : body.messages[0].content,
    );
    expect(payload.criterion_ids).toEqual(["AC-1", "AC-2"]);
    expect(estimateReservation(selected, active)).toBeGreaterThan(
      estimateReservation(oldInput, active),
    );

    const old = await runReview(
      oldInput,
      active,
      "synthetic",
      respond(provider, oldReview),
    );
    expect(old.status).toBe("completed");
    expect(old.review).toEqual(oldReview);
    expect(old).not.toHaveProperty("output_schema_version");
    expect(
      await runReview(
        oldInput,
        active,
        "synthetic",
        respond(provider, extendedReview),
      ),
    ).toMatchObject({
      status: "invalid_output",
      invalid_output_reason: "schema_mismatch",
    });
    const extended = await runReview(
      selected,
      active,
      "synthetic",
      respond(provider, extendedReview),
    );
    expect(extended).toMatchObject({
      status: "completed",
      output_schema_version: 2,
      review: {
        findings: extendedReview.findings,
        requirement_coverage: [
          {
            criterion_ref: "AC-1",
            status: "assessed",
            evidence: extendedReview.requirement_coverage[0]!.evidence,
          },
          { criterion_ref: "AC-2", status: "unassessed", evidence: [] },
        ],
      },
    });
    expect(
      await runReview(
        selected,
        active,
        "synthetic",
        respond(provider, extendedReview, true),
      ),
    ).toMatchObject({
      status: "incomplete",
      output_schema_version: 2,
      usage: { output_tokens: 8192 },
    });
  },
);

it("rejects unapproved references and unsupported coverage", async () => {
  const selected = await input("openai");
  for (const edit of [
    (r: typeof extendedReview) => {
      r.findings[0]!.requirement_refs = ["AC-99"];
    },
    (r: typeof extendedReview) => {
      r.requirement_coverage[0]!.criterion_ref = "AC-99";
    },
    (r: typeof extendedReview) => {
      r.requirement_coverage.push({ ...r.requirement_coverage[0]! });
    },
    (r: typeof extendedReview) => {
      r.requirement_coverage[0]!.evidence[0]!.line = 999;
    },
    (r: typeof extendedReview) => {
      r.findings[0]!.requirement_refs = [];
      r.requirement_coverage[0]!.evidence = [];
    },
  ]) {
    const r = structuredClone(extendedReview);
    edit(r);
    expect(
      await runReview(
        selected,
        profile("openai"),
        "synthetic",
        respond("openai", r),
      ),
    ).toMatchObject({
      status: "invalid_output",
      invalid_output_reason: "invalid_requirement_coverage",
    });
  }
  const executionClaim = structuredClone(extendedReview);
  Object.assign(executionClaim.findings[0]!.reproduction[0]!, {
    executed: true,
  });
  expect(
    await runReview(
      selected,
      profile("openai"),
      "synthetic",
      respond("openai", executionClaim),
    ),
  ).toMatchObject({
    status: "invalid_output",
    invalid_output_reason: "schema_mismatch",
  });
});

it("bounds coverage rows and still reports truncation at the configured limit", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `AC-${i + 1}`);
  const selected = {
    ...(await input("anthropic")),
    requirements: ids
      .map((id) => `${id}: Preserve the supplied value.`)
      .join("\n"),
    result_format: { version: 2 as const, criterion_ids: ids },
  };
  selected.input_sha256 = await inputHash(selected);
  expect(ReviewInputSchema.safeParse(selected).success).toBe(true);
  expect(
    ReviewInputSchema.safeParse({
      ...selected,
      result_format: { version: 2, criterion_ids: [...ids, "AC-13"] },
      requirements: selected.requirements + "\nAC-13: Extra criterion.",
    }).success,
  ).toBe(false);
  const review = {
    summary: "Evidence is incomplete.",
    additional_evidence: [],
    findings: [],
    requirement_coverage: ids.map((criterion_ref) => ({
      criterion_ref,
      status: "unassessed",
      evidence: [],
    })),
  };
  const result = await runReview(
    selected,
    profile("anthropic"),
    "synthetic",
    respond("anthropic", review),
  );
  expect(result.review).toEqual(review);
  const cutoff = await runReview(
    selected,
    profile("anthropic"),
    "synthetic",
    respond("anthropic", review, true),
  );
  expect(cutoff).toMatchObject({
    status: "incomplete",
    usage: { output_tokens: 8192 },
  });
  expect(cutoff).not.toHaveProperty("review");
});

it("retains repeated references and citations, including a citation in a linked finding", async () => {
  const repeated = structuredClone(extendedReview);
  repeated.findings[0]!.requirement_refs.push("AC-1");
  repeated.requirement_coverage[0]!.evidence.push(reference);
  const result = await runReview(
    await input("anthropic"),
    profile("anthropic"),
    "synthetic",
    respond("anthropic", repeated),
  );
  expect(result.review).toMatchObject({
    findings: [{ requirement_refs: ["AC-1", "AC-1"] }],
    requirement_coverage: [
      {
        criterion_ref: "AC-1",
        evidence: [
          reference,
          { ...reference, line: 11, end_line: 11 },
          reference,
        ],
      },
      { criterion_ref: "AC-2", evidence: [] },
    ],
  });
});

it("does not interpret an execution claim in suggestion prose", async () => {
  const review = structuredClone(extendedReview);
  const suggestion = "I ran the test and confirmed the failure.";
  review.findings[0]!.reproduction[0]!.suggestion = suggestion;
  const result = await runReview(
    await input("openai"),
    profile("openai"),
    "synthetic",
    respond("openai", review),
  );
  expect(result).toMatchObject({
    status: "completed",
    review: { findings: [{ reproduction: [{ kind: "test", suggestion }] }] },
  });
});

it("accepts structural coverage when a linked finding concerns only part of a criterion", async () => {
  const selected = {
    ...(await input("openai")),
    requirements:
      "AC-1: Preserve entries and preserve the caller state.\nAC-2: Preserve caller behavior.",
  };
  selected.input_sha256 = await inputHash(selected);
  const review = structuredClone(extendedReview);
  review.requirement_coverage[0]!.evidence = [];
  const result = await runReview(
    selected,
    profile("openai"),
    "synthetic",
    respond("openai", review),
  );
  expect(result).toMatchObject({
    status: "completed",
    review: {
      requirement_coverage: [
        { criterion_ref: "AC-1", status: "assessed", evidence: [] },
        { criterion_ref: "AC-2", status: "unassessed", evidence: [] },
      ],
    },
  });
});

it("compares one fixture across the two providers, output modes and token caps", async () => {
  const rows: object[] = [];
  for (const provider of ["openai", "anthropic"] as const) {
    for (const useExtended of [false, true]) {
      const selected = await input(provider, useExtended);
      const report = useExtended ? extendedReview : oldReview;
      for (const cap of [8192, 10240]) {
        const configured = { ...profile(provider), maxOutputTokens: cap };
        const complete = respond(provider, report);
        let responseBytes = 0;
        const result = await runReview(
          selected,
          configured,
          "synthetic",
          async (resource, init) => {
            const response = await complete(resource, init);
            responseBytes = Buffer.byteLength(
              await response.clone().text(),
              "utf8",
            );
            return response;
          },
        );
        expect(result.status).toBe("completed");
        expect(result.review).toBeDefined();
        expect(complete).toHaveBeenCalledTimes(1);
        const posted = String(complete.mock.calls[0]![1]?.body);
        const requestBytes = Buffer.byteLength(posted, "utf8");
        const body = JSON.parse(posted);
        expect(
          provider === "openai" ? body.max_output_tokens : body.max_tokens,
        ).toBe(cap);
        const reservation = estimateReservation(selected, configured, posted);
        expect(reservation).toBe(
          Math.ceil(
            ((requestBytes + 4096) * configured.inputMicrousdPerMillion +
              cap * configured.outputMicrousdPerMillion) /
              1_000_000,
          ),
        );

        const demand = 9000;
        const cutoff = cap < demand;
        const capped = respond(provider, report, cutoff, Math.min(demand, cap));
        const simulated = await runReview(
          selected,
          configured,
          "synthetic",
          capped,
        );
        expect(simulated.status).toBe(cutoff ? "incomplete" : "completed");
        expect(simulated.usage?.output_tokens).toBe(Math.min(demand, cap));
        if (cutoff) expect(simulated).not.toHaveProperty("review");
        expect(capped).toHaveBeenCalledTimes(1);

        rows.push({
          provider,
          format: useExtended ? "v2" : "legacy",
          cap,
          requestBytes,
          responseBytes,
          reviewBytes: Buffer.byteLength(JSON.stringify(result.review), "utf8"),
          reservation,
          mockStatus: simulated.status,
        });
      }
    }
  }
  expect(rows).toHaveLength(8);
  if (process.env.REBUT_PRINT_OUTPUT_MATRIX === "1")
    console.log("OUTPUT_MATRIX " + JSON.stringify(rows));
});

it("keeps the packaged hash examples aligned with canonical UTF-8 serialization", async () => {
  const material = {
    schema_version: 2 as const,
    provider: "openai" as const,
    task_kind: "code" as const,
    requirements: "AC-1: Preserve 순서.",
    files: [
      { path: "sample.ts", start_line: 1, content: "export const value = 1;" },
    ],
    diff: "",
  };
  const selection = { version: 2 as const, criterion_ids: ["AC-1"] };
  const hashes = await Promise.all([
    inputHash({ ...material, schema_version: 1, provider: undefined }),
    inputHash(material),
    inputHash({ ...material, result_format: selection }),
  ]);
  expect(hashes).toEqual([
    "412b5f538cfa6fac93c83813b6f4b723156f40ae06d50848072c58a5dabc8ca0",
    "f8add8f03abd7292de2918d02a70b435953019074a35d6a45d3a182f177417c5",
    "fd39d1847c3a55e9a318020874a96b55fcaad132c5c7c2df6325d4e8d1cf032a",
  ]);
  for (const locale of ["en", "ko", "ja", "zh-CN"]) {
    const guide = readFileSync(`docs/guide/${locale}/configuration.md`, "utf8");
    expect(guide).toContain(JSON.stringify(material));
    expect(guide).toContain(JSON.stringify(selection));
    for (const hash of hashes) expect(guide).toContain(hash);
  }
});
