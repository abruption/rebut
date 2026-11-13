import { z } from "zod";
import { ProfileSchema, type Config } from "./config.js";
import { ProfileRegistry } from "./profiles.js";
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
export async function profileApi(
  request: Request,
  config: Config,
  db: D1Database,
  isAdmin: boolean,
  canRead: boolean,
): Promise<Response> {
  const url = new URL(request.url),
    registry = new ProfileRegistry(db, config.profiles);
  const reply = (body: object, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (url.pathname === "/profiles") {
    if (!canRead && !isAdmin) return reply({ status: "unauthorized" }, 401);
    if (request.method !== "GET")
      return reply({ status: "method_not_allowed" }, 405);
    try {
      return reply({ profiles: await registry.list() });
    } catch {
      return reply({ status: "profile_storage_unavailable" }, 503);
    }
  }
  if (!isAdmin) return reply({ status: "unauthorized" }, 401);
  if (request.method !== "PUT" && request.method !== "DELETE")
    return reply({ status: "method_not_allowed" }, 405);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return reply({ status: "invalid_content_type" }, 415);
  let id: string;
  try {
    id = Id.parse(
      decodeURIComponent(url.pathname.slice("/admin/profiles/".length)),
    );
  } catch {
    return reply({ status: "invalid_profile_id" }, 400);
  }
  const reader = request.body?.getReader();
  if (!reader) return reply({ status: "invalid_request" }, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16000) {
      await reader.cancel();
      return reply({ status: "request_too_large" }, 413);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
  } catch {
    return reply({ status: "invalid_request" }, 400);
  }
  const revision = z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1);
  try {
    const result =
      request.method === "PUT"
        ? await (async () => {
            const input = z
              .object({ expected_revision: revision, profile: ProfileSchema })
              .strict()
              .parse(body);
            return registry.set(id, input.profile, input.expected_revision);
          })()
        : await (async () => {
            const input = z
              .object({ expected_revision: revision })
              .strict()
              .parse(body);
            return registry.remove(id, input.expected_revision);
          })();
    return reply(result, result.status === "conflict" ? 409 : 200);
  } catch (error) {
    return reply(
      {
        status:
          error instanceof z.ZodError
            ? "invalid_profile"
            : "profile_storage_unavailable",
      },
      error instanceof z.ZodError ? 400 : 503,
    );
  }
}
