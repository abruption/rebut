import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { ReviewInputSchema, inputHash } from "./contracts.js";
import { estimateReservation, runReview } from "./review.js";
import { Ledger } from "./ledger.js";
import { parseConfig } from "./config.js";
export interface Env {
  DB: D1Database;
  REBUT_CONFIG: string;
  AUTH_TOKENS: string;
  OPENAI_API_KEY: string;
}
const PrincipalSchema = z.record(
  z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  z.string().regex(/^[a-f0-9]{64}$/),
);
export async function sha256(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function authenticate(request: Request, env: Env) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 520)
    return null;
  const digest = await sha256(authorization.slice(7));
  // Stored values are SHA-256 digests of independently generated random 256-bit tokens.
  const principals = PrincipalSchema.parse(JSON.parse(env.AUTH_TOKENS));
  return (
    Object.entries(principals).find(([, hash]) => hash === digest)?.[0] ?? null
  );
}
function metadata(row: {
  state: string;
  input_sha256: string;
  metadata: string | null;
}) {
  return {
    status: row.state,
    input_sha256: row.input_sha256,
    result_replay_available: false,
    ...(row.metadata ? JSON.parse(row.metadata) : {}),
  };
}
export async function handleReview(raw: unknown, principal: string, env: Env) {
  const input = ReviewInputSchema.parse(raw),
    config = parseConfig(env.REBUT_CONFIG);
  if ((await inputHash(input)) !== input.input_sha256)
    return { status: "input_hash_mismatch" };
  const profile = config.profiles[input.profile];
  if (!profile) return { status: "profile_not_allowed" };
  const ledger = new Ledger(env.DB);
  const fingerprint = await sha256(
    JSON.stringify({
      input_sha256: input.input_sha256,
      profile: input.profile,
    }),
  );
  const reserved = await ledger.reserve(
    principal,
    input.request_id,
    fingerprint,
    input.input_sha256,
    input.profile,
    estimateReservation(input, profile),
    config.limits,
  );
  if (reserved.status === "existing") return metadata(reserved.row);
  if (reserved.status !== "acquired") return { status: reserved.status };
  let outcome;
  try {
    outcome = await runReview(input, profile, env.OPENAI_API_KEY);
  } catch {
    outcome = {
      status: "unknown" as const,
      requested_model: profile.model,
      price_version: profile.priceVersion,
    };
  }
  const { review, ...info } = outcome;
  await ledger.finish(
    principal,
    input.request_id,
    reserved.row.claim,
    outcome.status,
    outcome.estimated_cost_microusd,
    info,
  );
  return {
    ...info,
    review,
    input_sha256: input.input_sha256,
    result_replay_available: false,
  };
}
function toolResult(result: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp")
      return new Response("Not found", { status: 404 });
    try {
      if (
        !env.DB ||
        !env.REBUT_CONFIG ||
        !env.AUTH_TOKENS ||
        !env.OPENAI_API_KEY
      )
        return new Response("Service not configured", { status: 503 });
      const config = parseConfig(env.REBUT_CONFIG);
      if (url.hostname !== config.hostname)
        return new Response("Forbidden", { status: 403 });
      if (
        request.headers.has("origin") &&
        request.headers.get("origin") !== url.origin
      )
        return new Response("Forbidden", { status: 403 });
      const principal = await authenticate(request, env);
      if (!principal)
        return new Response("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": "Bearer" },
        });
      if (request.method !== "POST")
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "POST" },
        });
      if (
        !request.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/json")
      )
        return new Response("Unsupported media type", { status: 415 });
      // Stream limit protects requests with absent or dishonest Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return new Response("Invalid request", { status: 400 });
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 160000) {
          await reader.cancel();
          return new Response("Request too large", { status: 413 });
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const parsedBody = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      // No batches: each envelope receives a single principal-scoped operation.
      if (
        !parsedBody ||
        Array.isArray(parsedBody) ||
        typeof parsedBody !== "object"
      )
        return new Response("Invalid request", { status: 400 });
      const handler = createMcpHandler(
        () => {
          const server = new McpServer({ name: "rebut", version: "0.1.0" });
          server.registerTool(
            "review",
            {
              description:
                "Review explicitly supplied frozen material once. Unknown results must not be retried with a new request ID.",
              inputSchema: ReviewInputSchema,
            },
            async (input) => {
              try {
                return toolResult(await handleReview(input, principal, env));
              } catch {
                return {
                  isError: true,
                  ...toolResult({
                    status: "request_failed",
                    message:
                      "Request could not be completed. Query review_status with the same request_id before any further action.",
                  }),
                };
              }
            },
          );
          server.registerTool(
            "review_status",
            {
              description:
                "Read metadata only. Source and review bodies are not retained; no paid execution occurs.",
              inputSchema: z
                .object({
                  request_id: z
                    .string()
                    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/),
                })
                .strict(),
            },
            async ({ request_id }) => {
              const row = await new Ledger(env.DB).get(principal, request_id);
              return toolResult(row ? metadata(row) : { status: "not_found" });
            },
          );
          return server;
        },
        {
          responseMode: "json",
          corsOptions: false,
          allowedHostnames: [config.hostname],
          allowedOriginHostnames: [config.hostname],
        },
      );
      return await handler.fetch(request, { parsedBody });
    } catch {
      return new Response("Request failed", { status: 400 });
    }
  },
} satisfies ExportedHandler<Env>;
