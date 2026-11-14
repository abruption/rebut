import {
  handleReview,
  metadata,
  sha256,
  ProviderKeyUnavailable,
} from "./service.js";
export { handleReview, sha256 } from "./service.js";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { ReviewInputSchema } from "./contracts.js";
import { Ledger } from "./ledger.js";
import { parseConfig } from "./config.js";
import { profileApi } from "./profile-api.js";
export interface Env {
  DB: D1Database;
  REBUT_CONFIG: string;
  AUTH_TOKENS: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ADMIN_TOKEN_SHA256?: string;
}
const PrincipalSchema = z.record(
  z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  z.string().regex(/^[a-f0-9]{64}$/),
);
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
    const profileRoute =
      url.pathname === "/profiles" ||
      /^\/admin\/profiles\/[^/]+$/.test(url.pathname);
    if (url.pathname !== "/mcp" && !profileRoute)
      return new Response("Not found", { status: 404 });
    try {
      if (!env.DB || !env.REBUT_CONFIG || !env.AUTH_TOKENS)
        return new Response("Service not configured", { status: 503 });
      const config = parseConfig(env.REBUT_CONFIG);
      if (url.hostname !== config.hostname)
        return new Response("Forbidden", { status: 403 });
      if (
        request.headers.has("origin") &&
        request.headers.get("origin") !== url.origin
      )
        return new Response("Forbidden", { status: 403 });
      if (profileRoute) {
        const auth = request.headers.get("authorization");
        const adminDigest = env.ADMIN_TOKEN_SHA256;
        const isAdmin = !!(
          adminDigest &&
          /^[a-f0-9]{64}$/.test(adminDigest) &&
          auth?.startsWith("Bearer ") &&
          auth.length <= 520 &&
          (await sha256(auth.slice(7))) === adminDigest
        );
        const reader =
          url.pathname === "/profiles"
            ? await authenticate(request, env)
            : null;
        return await profileApi(request, config, env.DB, isAdmin, !!reader);
      }
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
          const server = new McpServer({ name: "rebut", version: "0.3.0" });
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
              } catch (error) {
                if (error instanceof ProviderKeyUnavailable)
                  return {
                    isError: true,
                    ...toolResult({
                      status: "provider_key_unavailable",
                      message:
                        "Configure the selected profile provider key on the Worker; query the original request ID before any paid invocation.",
                    }),
                  };
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
