import { z } from "zod";
import { ReviewSchema, type Profile, type ReviewInput } from "./contracts.js";

export const ANTHROPIC_VERSION = "2026-10-21";
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const counter = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
const schemaKeys = new Set([
  "type",
  "properties",
  "items",
  "required",
  "enum",
  "additionalProperties",
  "description",
]);
export function anthropicSchema(node: unknown): Record<string, unknown> {
  if (
    !record(node) ||
    "$ref" in node ||
    "$defs" in node ||
    "definitions" in node
  )
    throw Error("UNSUPPORTED_REVIEW_SCHEMA");
  if (
    typeof node.type !== "string" ||
    ![
      "object",
      "array",
      "string",
      "integer",
      "number",
      "boolean",
      "null",
    ].includes(node.type)
  )
    throw Error("UNSUPPORTED_REVIEW_SCHEMA");
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!schemaKeys.has(key)) continue;
    if (key === "properties") {
      if (!record(value)) throw Error("UNSUPPORTED_REVIEW_SCHEMA");
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          anthropicSchema(child),
        ]),
      );
    } else if (key === "items") result[key] = anthropicSchema(value);
    else result[key] = value;
  }
  if (
    result.type === "object" &&
    (!record(result.properties) ||
      result.additionalProperties !== false ||
      !Array.isArray(result.required))
  )
    throw Error("UNSUPPORTED_REVIEW_SCHEMA");
  if (result.type === "array" && !record(result.items))
    throw Error("UNSUPPORTED_REVIEW_SCHEMA");
  return result;
}
export function buildAnthropicBody(
  input: ReviewInput,
  profile: Profile,
  instructions: string,
) {
  if (
    profile.reasoning !== undefined &&
    !["low", "medium", "high", "xhigh", "max"].includes(profile.reasoning)
  )
    throw Error("UNSUPPORTED_ANTHROPIC_EFFORT");
  return {
    model: profile.model,
    max_tokens: profile.maxOutputTokens,
    service_tier: "standard_only",
    inference_geo: "global",
    system:
      instructions +
      " Use a nonempty summary and nonempty finding text, positive integer line/end_line values within supplied evidence, at most 100 findings and 40 additional_evidence entries. End lines must not precede start lines.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          task_kind: input.task_kind,
          requirements: input.requirements,
          files: input.files,
          diff: input.diff,
        }),
      },
    ],
    output_config: {
      ...(profile.reasoning !== undefined ? { effort: profile.reasoning } : {}),
      format: {
        type: "json_schema",
        schema: anthropicSchema(
          z.toJSONSchema(ReviewSchema, { target: "draft-7" }),
        ),
      },
    },
  };
}
const errorCodes = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "request_too_large",
  "rate_limit_error",
  "api_error",
  "overloaded_error",
  "billing_error",
]);
export const anthropicErrorCode = (value: unknown): string | undefined =>
  typeof value === "string" && errorCodes.has(value) ? value : undefined;

/** Convert only protocol fields; thinking bodies and provider diagnostics never leave this adapter. */
export function normalizeAnthropicResponse(
  raw: unknown,
  profile: Profile,
): Record<string, unknown> {
  if (!record(raw)) return { __anthropic_shape_invalid: true };
  const base = { id: raw.id, model: raw.model };
  if (
    raw.type !== "message" ||
    raw.role !== "assistant" ||
    !Array.isArray(raw.content)
  )
    return { ...base, __anthropic_shape_invalid: true };
  const usage = record(raw.usage) ? raw.usage : {};
  const usageKeys = new Set([
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "cache_creation",
    "inference_geo",
    "output_tokens_details",
    "server_tool_use",
    "service_tier",
    "speed",
  ]);
  const read = usage.cache_read_input_tokens ?? 0;
  const creation = usage.cache_creation_input_tokens ?? 0;
  const details = usage.output_tokens_details;
  const thinking = record(details) ? details.thinking_tokens : undefined;
  const reported = thinking !== undefined && thinking !== null;
  const input =
    counter(usage.input_tokens) && counter(read)
      ? usage.input_tokens + read
      : NaN;
  const output = usage.output_tokens;
  const valid =
    Object.keys(usage).every((key) => usageKeys.has(key)) &&
    counter(usage.input_tokens) &&
    counter(read) &&
    counter(creation) &&
    creation === 0 &&
    counter(input) &&
    counter(output) &&
    output <= profile.maxOutputTokens &&
    Number.isSafeInteger(input + output) &&
    (details == null ||
      (record(details) &&
        Object.keys(details).every((key) => key === "thinking_tokens") &&
        (!reported || (counter(thinking) && thinking <= output)))) &&
    (usage.cache_creation == null ||
      (record(usage.cache_creation) &&
        Object.values(usage.cache_creation).every((v) => (v ?? 0) === 0))) &&
    (usage.server_tool_use == null ||
      (record(usage.server_tool_use) &&
        Object.values(usage.server_tool_use).every((v) => v === 0))) &&
    (usage.service_tier == null || usage.service_tier === "standard") &&
    (usage.inference_geo == null || usage.inference_geo === "global") &&
    (usage.speed == null || usage.speed === "standard");
  const stop = raw.stop_reason;
  const status =
    stop === "end_turn" || stop === "refusal"
      ? "completed"
      : stop === "max_tokens" || stop === "model_context_window_exceeded"
        ? "incomplete"
        : "unhandled";
  const content =
    stop === "refusal"
      ? [{ type: "refusal" }]
      : raw.content.flatMap((block) => {
          if (!record(block)) return [{ type: "unsupported_content" }];
          if (block.type === "thinking" || block.type === "redacted_thinking")
            return [];
          if (block.type === "text" && typeof block.text === "string")
            return [{ type: "output_text", text: block.text }];
          return [{ type: "unsupported_content" }];
        });
  return {
    ...base,
    status,
    __anthropic_usage_valid: valid,
    __anthropic_reasoning_reported: reported,
    usage: valid
      ? {
          input_tokens: input,
          output_tokens: output,
          total_tokens: input + (output as number),
          input_tokens_details: { cached_tokens: read },
          output_tokens_details: { reasoning_tokens: reported ? thinking : 0 },
        }
      : undefined,
    output: [
      { type: "message", role: "assistant", status: "completed", content },
    ],
  };
}
