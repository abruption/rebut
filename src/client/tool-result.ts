import {
  ExtendedReviewSchema,
  ReviewSchema,
  type ReviewInput,
} from "../contracts.js";

export function toolPayload(result: {
  content?: unknown;
  isError?: boolean;
}): Record<string, unknown> | undefined {
  if (
    result.isError ||
    !Array.isArray(result.content) ||
    result.content.length !== 1
  )
    return;
  const item = result.content[0];
  if (item?.type !== "text" || typeof item.text !== "string") return;
  try {
    const payload: unknown = JSON.parse(item.text);
    if (payload && typeof payload === "object" && !Array.isArray(payload))
      return payload as Record<string, unknown>;
  } catch {
    // A successful transport can still return text that is not JSON.
  }
}

export function hasCompletedReview(
  result: Parameters<typeof toolPayload>[0],
  input: ReviewInput,
): boolean {
  const payload = toolPayload(result);
  if (
    payload?.status !== "completed" ||
    payload.input_sha256 !== input.input_sha256
  )
    return false;
  if (!input.result_format)
    return ReviewSchema.safeParse(payload.review).success;
  const parsed = ExtendedReviewSchema.safeParse(payload.review);
  if (!parsed.success) return false;
  const ids = input.result_format.criterion_ids;
  const coverage = parsed.data.requirement_coverage;
  return (
    coverage.length === ids.length &&
    coverage.every((row, index) => row.criterion_ref === ids[index])
  );
}
