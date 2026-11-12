import { z } from "zod";

export const MAX_INPUT_BYTES = 128_000;
export const safePath = (path: string): boolean =>
  path.length > 0 &&
  path.length <= 512 &&
  !/^[\/\\]|^[A-Za-z]:|[\\\x00-\x1f\x7f]/.test(path) &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const PathSchema = z.string().refine(safePath, "Expected a safe relative path");
const SafeId = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
export const ReviewInputSchema = z
  .strictObject({
    schema_version: z.literal(1),
    request_id: SafeId.max(80),
    profile: SafeId.max(64),
    input_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    task_kind: z.enum(["code", "design", "text"]),
    requirements: z.string().max(16_000),
    files: z
      .array(
        z.strictObject({
          path: PathSchema,
          start_line: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          content: z.string(),
        }),
      )
      .max(40),
    diff: z.string().max(100_000),
  })
  .superRefine((value, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      MAX_INPUT_BYTES
    )
      ctx.addIssue({ code: "custom", message: "Input exceeds byte limit" });
    if (
      new Set(value.files.map((file) => file.path)).size !== value.files.length
    )
      ctx.addIssue({ code: "custom", message: "File paths must be unique" });
    if (!value.diff.trim() && !value.files.some((file) => file.content.trim()))
      ctx.addIssue({ code: "custom", message: "Source content is required" });
    for (const file of value.files) {
      if (
        !Number.isSafeInteger(
          file.start_line + file.content.split("\n").length - 1,
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Source line range exceeds safe integers",
        });
    }
  });
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

export async function inputHash(
  input: Pick<
    ReviewInput,
    "schema_version" | "task_kind" | "requirements" | "files" | "diff"
  >,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      schema_version: input.schema_version,
      task_kind: input.task_kind,
      requirements: input.requirements,
      files: input.files.map(({ path, start_line, content }) => ({
        path,
        start_line,
        content,
      })),
      diff: input.diff,
    }),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export interface Profile {
  model: string;
  reasoning?: string;
  maxOutputTokens: number;
  inputMicrousdPerMillion: number;
  outputMicrousdPerMillion: number;
  priceVersion: string;
}

export const ReviewSchema = z.strictObject({
  summary: z.string().min(1).max(16_000),
  additional_evidence: z.array(z.string().max(8000)).max(40),
  findings: z
    .array(
      z.strictObject({
        severity: z.enum(["critical", "high", "medium", "low"]),
        title: z.string().min(1).max(1000),
        explanation: z.string().min(1).max(16_000),
        path: PathSchema,
        line: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        end_line: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        counterexample: z.string().min(1).max(16_000),
        remediation: z.string().min(1).max(16_000),
      }),
    )
    .max(100),
});
export type Review = z.infer<typeof ReviewSchema>;
export interface ReviewUsage {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
}
export interface ReviewOutcome {
  status: "completed" | "refused" | "incomplete" | "invalid_output" | "unknown";
  review?: Review;
  response_id?: string;
  api_request_id?: string;
  requested_model: string;
  actual_model?: string;
  usage?: ReviewUsage;
  estimated_cost_microusd?: number;
  price_version: string;
  upstream_status?: number;
  upstream_error_code?: string;
}
