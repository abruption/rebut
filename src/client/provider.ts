import { boundedJson, compatibleModel } from "../review.js";
import { profileProvider, type Profile } from "../contracts.js";
import { ANTHROPIC_VERSION } from "../anthropic.js";
import { createNodeHttpTransport } from "./http.js";

const certificateErrorCodes = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** Explicit metadata-only diagnostic. Never calls a generation endpoint or changes a ledger. */
export async function providerDiagnostic(
  profile: Pick<Profile, "model" | "provider">,
  apiKey: string,
  fetcher?: typeof fetch,
) {
  const provider = profileProvider(profile);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(profile.model))
    throw Error("INVALID_MODEL_IDENTIFIER");
  const http = fetcher ? undefined : createNodeHttpTransport();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await (fetcher ?? http!.fetch)(
          `${provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com"}/v1/models/${encodeURIComponent(profile.model)}`,
          {
            method: "GET",
            redirect: "error",
            signal: controller.signal,
            headers:
              provider === "anthropic"
                ? {
                    "x-api-key": apiKey,
                    "anthropic-version": ANTHROPIC_VERSION,
                  }
                : { Authorization: `Bearer ${apiKey}` },
          },
        );
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          return {
            provider,
            model: profile.model,
            status: "metadata_unavailable",
            upstream_status: response.status,
          };
        }
        const value = await boundedJson(response, controller.signal);
        if (
          typeof value !== "object" ||
          !value ||
          !compatibleModel(
            (value as { id?: string }).id,
            profile.model,
            provider,
          )
        )
          throw Error("INVALID_MODEL_METADATA");
        return { provider, model: profile.model, status: "metadata_reachable" };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error("PROVIDER_METADATA_TIMEOUT"));
        }, 15_000);
      }),
    ]);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      cause instanceof Error &&
      "code" in cause &&
      typeof cause.code === "string" &&
      certificateErrorCodes.has(cause.code)
    )
      return {
        provider,
        model: profile.model,
        status: "metadata_unavailable",
        reason: "tls_certificate_error",
        tls_error_code: cause.code,
      };
    return { provider, model: profile.model, status: "metadata_unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    await http?.close();
  }
}
