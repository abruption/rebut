import { z } from "zod";
import { ProfileSchema } from "../config.js";
import type { Profile } from "../contracts.js";
import { validateEndpoint, type RemoteOptions } from "./connection.js";

export interface ProfileRecord {
  id: string;
  revision: number;
  enabled: boolean;
  profile?: Profile;
}

const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
const RecordSchema = z
  .strictObject({
    id: Id,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    enabled: z.boolean(),
    profile: ProfileSchema.optional(),
  })
  .refine((record) => !record.enabled || record.profile !== undefined);
const ListSchema = z
  .strictObject({ profiles: z.array(RecordSchema) })
  .refine(
    ({ profiles }) =>
      new Set(profiles.map((record) => record.id)).size === profiles.length,
  );
const FAILURE = "Profile request failed; no automatic retry was made.";
const SAFE_ERRORS = new Set([
  FAILURE,
  "Profile revision conflict; read current profiles before making another change.",
  "Profile authentication or authorization failed.",
  "Profile service unavailable; check migration and service status.",
  "Invalid profile service response.",
  "Requested profile is unavailable or disabled.",
  "Model and reasoning must match exactly one enabled profile; select an explicit profile.",
  "Default astra-medium profile is unavailable; select a profile.",
  "Expected a whole number.",
  "Expected a bounded whole number.",
  "Price requires positive decimal USD with at most six fractional digits.",
  "Price exceeds the supported range.",
  "Expected profiles list, set ID, or remove ID.",
  "Invalid profile command flags.",
  "Missing required profile flag.",
  "Invalid profile configuration.",
  "Invalid profile service response; inspect current profiles before making another change.",
]);

/** Returns only fixed local diagnostics, never arbitrary upstream error text. */
export function safeProfileError(error: unknown): string | undefined {
  return error instanceof Error && SAFE_ERRORS.has(error.message)
    ? error.message
    : undefined;
}
const LIMIT = 65_536;

async function request(
  options: RemoteOptions,
  path: string,
  method = "GET",
  body?: object,
): Promise<unknown> {
  const endpoint = validateEndpoint(options.endpoint);
  const url = new URL(path, endpoint.origin);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const token = await options.loadToken();
        if (controller.signal.aborted) throw new Error(FAILURE);
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 409)
            throw new Error(
              "Profile revision conflict; read current profiles before making another change.",
            );
          if (response.status === 401 || response.status === 403)
            throw new Error("Profile authentication or authorization failed.");
          if (response.status === 503)
            throw new Error(
              "Profile service unavailable; check migration and service status.",
            );
          throw new Error(FAILURE);
        }
        const declared = response.headers.get("content-length");
        if (declared && (!/^\d+$/.test(declared) || Number(declared) > LIMIT))
          throw new Error(FAILURE);
        if (!response.body) throw new Error(FAILURE);
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > LIMIT) throw new Error(FAILURE);
          chunks.push(chunk.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        try {
          return JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
        } catch {
          throw new Error(FAILURE);
        }
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(FAILURE));
        }, 15_000);
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      [
        FAILURE,
        "Profile revision conflict; read current profiles before making another change.",
        "Profile authentication or authorization failed.",
        "Profile service unavailable; check migration and service status.",
      ].includes(message)
    )
      throw new Error(message);
    throw new Error(FAILURE);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

export async function listProfiles(
  options: RemoteOptions,
): Promise<ProfileRecord[]> {
  const parsed = ListSchema.safeParse(await request(options, "/profiles"));
  if (!parsed.success) throw new Error("Invalid profile service response.");
  return parsed.data.profiles;
}

export function resolveProfile(
  records: ProfileRecord[],
  prefs: { profile?: string; model?: string; reasoning?: string },
): string {
  const enabled = records.filter((record) => record.enabled && record.profile);
  if (prefs.profile !== undefined) {
    if (!enabled.some((record) => record.id === prefs.profile))
      throw new Error("Requested profile is unavailable or disabled.");
    return prefs.profile;
  }
  if (prefs.model !== undefined || prefs.reasoning !== undefined) {
    const matches = enabled.filter(
      (record) =>
        record.profile?.model === prefs.model &&
        record.profile?.reasoning === (prefs.reasoning ?? "medium"),
    );
    if (matches.length !== 1)
      throw new Error(
        "Model and reasoning must match exactly one enabled profile; select an explicit profile.",
      );
    return matches[0]!.id;
  }
  if (!enabled.some((record) => record.id === "astra-medium"))
    throw new Error(
      "Default astra-medium profile is unavailable; select a profile.",
    );
  return "astra-medium";
}

function integer(value: string, allowZero = false): number {
  if (!/^\d+$/.test(value)) throw new Error("Expected a whole number.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1))
    throw new Error("Expected a bounded whole number.");
  return parsed;
}

export function price(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match || match[1]!.length > 13)
    throw new Error(
      "Price requires positive decimal USD with at most six fractional digits.",
    );
  const micro =
    BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (micro <= 0n || micro > 1_000_000_000_000n)
    throw new Error("Price exceeds the supported range.");
  return Number(micro);
}

export type ProfileCommandDependencies =
  | { registry: import("../profiles.js").ProfileRegistry }
  | {
      endpoint: string;
      loadReviewToken: () => Promise<string>;
      loadAdminToken: () => Promise<string>;
    };

export async function profileCommand(
  args: string[],
  deps: ProfileCommandDependencies,
): Promise<object> {
  const [command, id, ...rest] = args;
  if (command === "list" && args.length === 1)
    return {
      profiles:
        "registry" in deps
          ? await deps.registry.list()
          : await listProfiles({
              endpoint: deps.endpoint,
              loadToken: deps.loadReviewToken,
            }),
    };
  if ((command !== "set" && command !== "remove") || !Id.safeParse(id).success)
    throw new Error("Expected profiles list, set ID, or remove ID.");
  const allowed = new Set(
    command === "remove"
      ? ["--if-revision"]
      : [
          "--model",
          "--reasoning",
          "--max-output-tokens",
          "--input-usd-per-million",
          "--output-usd-per-million",
          "--price-version",
          "--if-revision",
        ],
  );
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]!;
    const value = rest[i + 1];
    if (
      !allowed.has(key) ||
      flags.has(key) ||
      value === undefined ||
      value.startsWith("--")
    )
      throw new Error("Invalid profile command flags.");
    flags.set(key, value);
  }
  const required = (key: string): string => {
    const value = flags.get(key);
    if (value === undefined) throw new Error("Missing required profile flag.");
    return value;
  };
  let profile: Profile | undefined;
  if (command === "set") {
    const parsed = ProfileSchema.safeParse({
      model: required("--model"),
      reasoning: required("--reasoning"),
      maxOutputTokens: integer(required("--max-output-tokens")),
      inputMicrousdPerMillion: price(required("--input-usd-per-million")),
      outputMicrousdPerMillion: price(required("--output-usd-per-million")),
      priceVersion: required("--price-version"),
    });
    if (!parsed.success) throw new Error("Invalid profile configuration.");
    profile = parsed.data;
  }
  const explicit = flags.get("--if-revision");
  let revision = explicit === undefined ? undefined : integer(explicit, true);
  if ("registry" in deps) {
    revision ??=
      (await deps.registry.list()).find((record) => record.id === id)
        ?.revision ?? 0;
    const result = await (command === "set"
      ? deps.registry.set(id!, profile!, revision)
      : deps.registry.remove(id!, revision));
    if (result.status === "conflict")
      throw new Error(
        "Profile revision conflict; read current profiles before making another change.",
      );
    return result;
  }
  const options = { endpoint: deps.endpoint, loadToken: deps.loadAdminToken };
  if (revision === undefined)
    revision =
      (await listProfiles(options)).find((record) => record.id === id)
        ?.revision ?? 0;
  const payload = await request(
    options,
    `/admin/profiles/${encodeURIComponent(id!)}`,
    command === "set" ? "PUT" : "DELETE",
    { expected_revision: revision, ...(profile ? { profile } : {}) },
  );
  const parsed = z
    .strictObject({
      status: z.literal("updated"),
      record: RecordSchema.refine((record) => record.revision > 0),
    })
    .safeParse(payload);
  if (!parsed.success || parsed.data.record.id !== id)
    throw new Error(
      "Invalid profile service response; inspect current profiles before making another change.",
    );
  return parsed.data;
}
