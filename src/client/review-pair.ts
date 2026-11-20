import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  inputHash,
  ReviewInputSchema,
  type ReviewInput,
} from "../contracts.js";

const ReviewPairSchema = z.strictObject({
  first: ReviewInputSchema.describe(
    "An unchanged schema version 2 bundle from rebut collect.",
  ),
  second: z
    .strictObject({
      request_id: ReviewInputSchema.shape.request_id,
      profile: ReviewInputSchema.shape.profile,
      provider: ReviewInputSchema.shape.provider.unwrap(),
    })
    .describe(
      "Explicit second reviewer. Rebut copies the first bundle's evidence and computes a supplier-pinned hash.",
    ),
});

type ReviewResult = {
  isError?: boolean;
  content: ReadonlyArray<{ type: string; text?: string }>;
};

function toolResult(value: object, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

export function registerReviewPair(
  server: McpServer,
  callReview: (
    input: ReviewInput,
    signal: AbortSignal,
  ) => Promise<ReviewResult>,
  localMaxConcurrent?: number,
) {
  server.registerTool(
    "review_pair",
    {
      description:
        "Use only when the user explicitly opts in to two paid reviews with distinct profiles. Dispatches through the active backend in parallel and shares its budget and concurrency limits. Keep both request IDs. After a lost response, call review_status for each original ID on this backend. Never start replacement paid requests automatically.",
      inputSchema: ReviewPairSchema,
    },
    async ({ first, second }, extra) => {
      if (
        first.schema_version !== 2 ||
        first.request_id === second.request_id ||
        first.profile === second.profile
      ) {
        return toolResult(
          {
            status: "invalid_review_pair",
            message:
              "Use a schema version 2 first bundle, distinct request IDs, and distinct profiles.",
          },
          true,
        );
      }
      if ((await inputHash(first)) !== first.input_sha256)
        return toolResult({ status: "input_hash_mismatch" }, true);

      const candidate = { ...first, ...second };
      const parsed = ReviewInputSchema.safeParse(candidate);
      if (!parsed.success)
        return toolResult({ status: "invalid_second_bundle" }, true);
      const secondary = {
        ...parsed.data,
        input_sha256: await inputHash(parsed.data),
      };
      if (localMaxConcurrent !== undefined && localMaxConcurrent < 2)
        return toolResult(
          {
            status: "pair_concurrency_unavailable",
            message:
              "Local parallel review requires a concurrency limit of at least 2. Use rebut set max-concurrent 2 to opt in.",
          },
          true,
        );
      const signal = extra.mcpReq.signal;
      if (signal.aborted)
        return toolResult(
          { status: "review_pair_cancelled_before_dispatch" },
          true,
        );

      const reviews = await Promise.all(
        [first, secondary].map(async (input) => {
          const identity = {
            request_id: input.request_id,
            profile: input.profile,
            provider: input.provider,
            input_sha256: input.input_sha256,
          };
          try {
            const response = await callReview(input, signal);
            const [content] = response.content;
            const result =
              content?.type === "text" && content.text
                ? JSON.parse(content.text)
                : undefined;
            if (
              response.content.length === 1 &&
              typeof result?.status === "string"
            )
              return {
                ...identity,
                has_review:
                  !response.isError &&
                  result.status === "completed" &&
                  typeof result.review?.summary === "string",
                result,
              };
          } catch {
            // A lost response cannot establish whether the request ran.
          }
          return {
            ...identity,
            has_review: false,
            result: {
              status: "unknown",
              result_replay_available: false,
              message:
                "Query review_status with this original request ID on the same backend.",
            },
          };
        }),
      );
      const returned = reviews.filter(({ has_review }) => has_review).length;
      let status = "incomplete";
      if (returned === 2) status = "completed";
      else if (returned === 1) status = "partial";
      else if (reviews.every(({ result }) => result.status === "completed"))
        status = "completed_without_review";
      return toolResult({ status, reviews });
    },
  );
}
