import {
  ReviewInputSchema,
  inputHash,
  profileProvider,
  inputProvider,
  type Provider,
} from "./contracts.js";
import { parseConfig } from "./config.js";
import { Ledger, type LedgerRow } from "./ledger.js";
import { ProfileRegistry } from "./profiles.js";
import { buildReviewBody, estimateReservation, runReview } from "./review.js";
export class ProviderKeyUnavailable extends Error {
  constructor() {
    super("PROVIDER_KEY_UNAVAILABLE");
  }
}
export interface ReviewEnvironment {
  DB: D1Database;
  REBUT_CONFIG: string;
  REBUT_BUDGET_LIMITS?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}
export interface ReviewExecutionOptions {
  loadApiKey?: (provider: Provider) => Promise<string>;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}
export async function sha256(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function metadata(row: {
  state: string;
  input_sha256: string;
  metadata: string | null;
}) {
  return {
    ...(row.metadata ? JSON.parse(row.metadata) : {}),
    status: row.state,
    input_sha256: row.input_sha256,
    result_replay_available: false,
  };
}

export function statusMetadata(row: LedgerRow) {
  return {
    ...metadata(row),
    budget_reserved_microusd: row.reserved_microusd,
    budget_accounted_microusd: row.charged_microusd,
  };
}

export async function pendingMetadata(ledger: Ledger, principal: string) {
  const rows = await ledger.pending(principal);
  return {
    requests: rows.slice(0, 100).map((row) => ({
      ...statusMetadata(row),
      request_id: row.request_id,
      created_at: row.created_at,
      profile: row.profile,
    })),
    has_more: rows.length > 100,
  };
}
export async function handleReview(
  raw: unknown,
  principal: string,
  env: ReviewEnvironment,
  options: ReviewExecutionOptions = {},
) {
  const input = ReviewInputSchema.parse(raw),
    config = parseConfig(env.REBUT_CONFIG, env.REBUT_BUDGET_LIMITS);
  if ((await inputHash(input)) !== input.input_sha256)
    return { status: "input_hash_mismatch" };
  const ledger = new Ledger(env.DB);
  const fingerprint = await sha256(
    JSON.stringify({
      input_sha256: input.input_sha256,
      profile: input.profile,
      ...(input.schema_version === 2 ? { provider: input.provider } : {}),
    }),
  );
  const existing = await ledger.get(principal, input.request_id);
  if (existing)
    return existing.fingerprint === fingerprint
      ? metadata(existing)
      : { status: "conflict" };
  const selected = await new ProfileRegistry(env.DB, config.profiles).resolve(
    input.profile,
  );
  if (!selected) return { status: "profile_not_allowed" };
  const profile = selected.profile;
  const provider = profileProvider(profile);
  if (inputProvider(input) !== provider)
    return {
      status: "provider_mismatch",
      expected_provider: inputProvider(input),
      profile_provider: provider,
    };
  const body = JSON.stringify(buildReviewBody(input, profile));
  const snapshot = {
    requested_provider: provider,
    bundle_schema_version: input.schema_version,
    ...(input.result_format ? { output_schema_version: 2 } : {}),
    requested_model: profile.model,
    requested_reasoning: profile.reasoning,
    profile_revision: selected.revision,
    price_version: profile.priceVersion,
  };
  if (options.signal?.aborted) throw new Error("LOCAL_REVIEW_ABORTED");
  let apiKey: string | undefined;
  try {
    apiKey = options.loadApiKey
      ? await options.loadApiKey(provider)
      : provider === "anthropic"
        ? env.ANTHROPIC_API_KEY
        : env.OPENAI_API_KEY;
  } catch {
    throw new ProviderKeyUnavailable();
  }
  if (!apiKey) throw new ProviderKeyUnavailable();
  if (options.signal?.aborted) throw new Error("LOCAL_REVIEW_ABORTED");
  const reserved = await ledger.reserve(
    principal,
    input.request_id,
    fingerprint,
    input.input_sha256,
    input.profile,
    estimateReservation(input, profile, body),
    config.limits,
    new Date(),
    snapshot,
  );
  if (reserved.status === "existing") return metadata(reserved.row);
  if (reserved.status !== "acquired") return { status: reserved.status };
  let outcome;
  const started = Date.now();
  try {
    outcome = await runReview(
      input,
      profile,
      apiKey,
      options.fetcher,
      options.signal,
      body,
    );
  } catch {
    outcome = {
      status: "unknown" as const,
      unknown_reason: options.signal?.aborted
        ? ("execution_aborted" as const)
        : ("review_execution_error" as const),
      provider_elapsed_ms: Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.max(0, Date.now() - started),
      ),
      requested_model: profile.model,
      price_version: profile.priceVersion,
    };
  }
  const { review, ...outcomeInfo } = outcome;
  const info = {
    ...outcomeInfo,
    requested_provider: provider,
    bundle_schema_version: input.schema_version,
    ...(input.result_format ? { output_schema_version: 2 } : {}),
    requested_reasoning: profile.reasoning,
    profile_revision: selected.revision,
  };
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
