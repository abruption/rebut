import {
  handleReview,
  pendingMetadata,
  statusMetadata,
  sha256,
  ProviderKeyUnavailable,
  type ReviewEnvironment,
} from "./service.js";
export { handleReview, sha256 } from "./service.js";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { ReviewInputSchema } from "./contracts.js";
import { Ledger } from "./ledger.js";
import { validMonthlyStartDay } from "./budget-cycle.js";
import { parseConfig } from "./config.js";
import { profileApi } from "./profile-api.js";
export interface Env extends ReviewEnvironment {
  AUTH_TOKENS: string;
  ADMIN_TOKEN_SHA256?: string;
}
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const PrincipalSchema = z.record(
  z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  DigestSchema,
);
const AuthConfigSchema = z
  .object({
    principals: PrincipalSchema,
    adminDigest: DigestSchema.optional(),
  })
  .superRefine(({ principals, adminDigest }, ctx) => {
    const ordinaryDigests = Object.values(principals);
    if (new Set(ordinaryDigests).size !== ordinaryDigests.length)
      ctx.addIssue({
        code: "custom",
        message: "Principal token digests must be unique",
      });
    if (adminDigest && ordinaryDigests.includes(adminDigest))
      ctx.addIssue({
        code: "custom",
        message: "Administrator token digest must be separate",
      });
  });
type AuthConfig = z.infer<typeof AuthConfigSchema>;
function parseAuthConfig(env: Env): AuthConfig {
  return AuthConfigSchema.parse({
    principals: JSON.parse(env.AUTH_TOKENS),
    adminDigest: env.ADMIN_TOKEN_SHA256 === "" ? undefined : env.ADMIN_TOKEN_SHA256,
  });
}
async function authenticate(
  request: Request,
  principals: AuthConfig["principals"],
) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 520)
    return null;
  const digest = await sha256(authorization.slice(7));
  // Stored values are SHA-256 digests of independently generated random 256-bit tokens.
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
    const budgetStartDay = /^\/admin\/budget\/start-day\/([0-9]{1,2})$/.exec(
      url.pathname,
    );
    const budgetRoute =
      url.pathname === "/admin/budget" || budgetStartDay !== null;
    if (url.pathname !== "/mcp" && !profileRoute && !budgetRoute)
      return new Response("Not found", { status: 404 });
    try {
      if (!env.DB || !env.REBUT_CONFIG || !env.AUTH_TOKENS)
        return new Response("Service not configured", { status: 503 });
      let authConfig: AuthConfig, config: ReturnType<typeof parseConfig>;
      try {
        authConfig = parseAuthConfig(env);
        config = parseConfig(env.REBUT_CONFIG, env.REBUT_BUDGET_LIMITS);
      } catch {
        return new Response("Service not configured", { status: 503 });
      }
      if (url.hostname !== config.hostname)
        return new Response("Forbidden", { status: 403 });
      if (
        request.headers.has("origin") &&
        request.headers.get("origin") !== url.origin
      )
        return new Response("Forbidden", { status: 403 });
      if (profileRoute || budgetRoute) {
        const auth = request.headers.get("authorization");
        const adminDigest = authConfig.adminDigest;
        const isAdmin = !!(
          adminDigest &&
          auth?.startsWith("Bearer ") &&
          auth.length <= 520 &&
          (await sha256(auth.slice(7))) === adminDigest
        );
        if (budgetRoute) {
          const reply = (body: object, status = 200) =>
            Response.json(body, {
              status,
              headers: { "Cache-Control": "no-store" },
            });
          if (!isAdmin) return reply({ status: "unauthorized" }, 401);
          const ledger = new Ledger(env.DB);
          try {
            if (request.method === "GET" && !budgetStartDay)
              return reply({
                ...(await ledger.budget(config.limits)),
                daily_limit_microusd: config.limits.dailyMicrousd,
              });
            if (request.method !== "PUT" || !budgetStartDay)
              return reply({ status: "method_not_allowed" }, 405);
            const day = Number(budgetStartDay[1]);
            if (!validMonthlyStartDay(day))
              return reply({ status: "invalid_monthly_start_day" }, 400);
            const result = await ledger.scheduleMonthlyCycle(day);
            return reply(result, result.status === "conflict" ? 409 : 200);
          } catch {
            return reply({ status: "budget_storage_unavailable" }, 503);
          }
        }
        const reader =
          url.pathname === "/profiles"
            ? await authenticate(request, authConfig.principals)
            : null;
        return await profileApi(request, config, env.DB, isAdmin, !!reader);
      }
      const principal = await authenticate(request, authConfig.principals);
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
          const server = new McpServer({ name: "rebut", version: "0.6.1" });
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
              return toolResult(
                row ? statusMetadata(row) : { status: "not_found" },
              );
            },
          );
          server.registerTool(
            "review_pending",
            {
              description:
                "List up to 100 reserved or unknown requests for the authenticated principal without charging for a review.",
              inputSchema: z.strictObject({}),
            },
            async () => {
              try {
                return toolResult(
                  await pendingMetadata(new Ledger(env.DB), principal),
                );
              } catch {
                return {
                  isError: true,
                  ...toolResult({ status: "status_unavailable" }),
                };
              }
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
