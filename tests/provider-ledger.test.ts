import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, chmod, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openLocalRuntime } from "../src/local.js";
import { inputHash, type ReviewInput } from "../src/contracts.js";
import { SettingsSchema } from "../src/client/settings.js";
import { loadToken } from "../src/client/secrets.js";
import { providerDiagnostic } from "../src/client/provider.js";
import * as reviewModule from "../src/review.js";
const roots: string[] = [];
const base = process.cwd().startsWith("/Volumes/Kingston NV/")
  ? "/Volumes/Kingston NV/tmp"
  : tmpdir();
async function directory() {
  const p = await mkdtemp(join(base, "codex-provider-ledger-"));
  await chmod(p, 0o700);
  roots.push(p);
  return p;
}
const settings = () =>
  SettingsSchema.parse({
    schemaVersion: 1,
    secretStore: "env",
    vaultwardenItem: "unused",
    mode: "local",
  });
async function input(
  id: string,
  profile = "claude-medium",
): Promise<ReviewInput> {
  const i: ReviewInput = {
    schema_version: 1,
    request_id: id,
    profile,
    input_sha256: "",
    task_kind: "code",
    requirements: "Synthetic",
    files: [
      { path: "a.ts", start_line: 1, content: "PRIVATE_PROVIDER_SOURCE" },
    ],
    diff: "",
  };
  i.input_sha256 = await inputHash(i);
  return i;
}
const payload = () => ({
  id: "msg_ledger",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  usage: { input_tokens: 100, output_tokens: 20 },
  content: [
    {
      type: "text",
      text: JSON.stringify({
        summary: "PRIVATE_PROVIDER_REVIEW",
        findings: [],
        additional_evidence: [],
      }),
    },
  ],
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
it("routes the frozen provider key, keeps old IDs after provider/profile changes, and stores no secrets", async () => {
  const dir = await directory();
  const key = "synthetic-anthropic-key-not-real-123456789";
  const keys = vi.fn(async (provider: string) => {
    expect(provider).toBe("anthropic");
    return key;
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(payload()), {
      headers: { "request-id": "req_fixture" },
    }),
  );
  let runtime = await openLocalRuntime(settings(), {
    directory: dir,
    loadApiKey: keys,
    fetcher,
  });
  const frozen = await input("same-id");
  const completed: any = await runtime.review(frozen);
  expect(completed).toMatchObject({
    status: "completed",
    requested_provider: "anthropic",
  });
  expect(keys).toHaveBeenCalledExactlyOnceWith("anthropic");
  expect(fetcher).toHaveBeenCalledOnce();
  const profile = runtime.config.profiles["astra-medium"]!;
  await runtime.profiles.set("claude-medium", profile, 0);
  await runtime.close();
  runtime = await openLocalRuntime(
    { ...settings(), provider: "openai" },
    {
      directory: dir,
      loadApiKey: async () => {
        throw Error("must not load key");
      },
      fetcher,
    },
  );
  try {
    const duplicate: any = await runtime.review(frozen);
    expect(duplicate).toMatchObject({
      status: "completed",
      requested_provider: "anthropic",
      result_replay_available: false,
    });
    expect(duplicate.review).toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    expect((await runtime.status(frozen.request_id)).requested_provider).toBe(
      "anthropic",
    );
  } finally {
    await runtime.close();
  }
  const bytes = await readFile(join(dir, "ledger.sqlite"));
  for (const privateValue of [
    key,
    "PRIVATE_PROVIDER_SOURCE",
    "PRIVATE_PROVIDER_REVIEW",
  ])
    expect(bytes.includes(Buffer.from(privateValue))).toBe(false);
});
it("unknown keeps a shared slot and full charge across providers and restart", async () => {
  const dir = await directory();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(Error("PRIVATE_ERROR"));
  let runtime = await openLocalRuntime(settings(), {
    directory: dir,
    loadApiKey: async () => "synthetic-provider-key-not-real-123456789",
    fetcher,
  });
  const frozen = await input("unknown-id");
  const first: any = await runtime.review(frozen);
  expect(first).toMatchObject({
    status: "unknown",
    requested_provider: "anthropic",
  });
  const before: any = await runtime.status(frozen.request_id);
  expect(before.budget_accounted_microusd).toBe(
    before.budget_reserved_microusd,
  );
  await runtime.close();
  runtime = await openLocalRuntime(
    { ...settings(), provider: "openai" },
    {
      directory: dir,
      loadApiKey: async () => "synthetic-other-key-not-real-123456789",
      fetcher,
    },
  );
  try {
    expect(
      await runtime.review(await input("other-provider", "luna-test")),
    ).toMatchObject({ status: "limit_exceeded" });
    expect(await runtime.review(frozen)).toMatchObject({
      status: "unknown",
      requested_provider: "anthropic",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(
      (await runtime.status(frozen.request_id)).budget_reserved_microusd,
    ).toBe(before.budget_reserved_microusd);
  } finally {
    await runtime.close();
  }
});
it("does not reserve or use another provider key when the frozen provider credential is missing", async () => {
  const dir = await directory();
  const fetcher = vi.fn<typeof fetch>();
  const keys = vi.fn(async () => {
    throw Error("key missing");
  });
  const runtime = await openLocalRuntime(settings(), {
    directory: dir,
    loadApiKey: keys,
    fetcher,
  });
  try {
    await expect(
      runtime.review(await input("missing-key")),
    ).rejects.toMatchObject({ message: "PROVIDER_KEY_UNAVAILABLE" });
    expect(await runtime.status("missing-key")).toEqual({
      status: "not_found",
    });
    expect(keys).toHaveBeenCalledExactlyOnceWith("anthropic");
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    await runtime.close();
  }
});
it("preserves provider identity in an unexpected service exception", async () => {
  const dir = await directory();
  vi.spyOn(reviewModule, "runReview").mockRejectedValueOnce(
    Error("PRIVATE_EXCEPTION"),
  );
  const runtime = await openLocalRuntime(settings(), {
    directory: dir,
    loadApiKey: async () => "synthetic-key-not-real-1234567890123",
  });
  try {
    const result: any = await runtime.review(await input("exception"));
    expect(result).toMatchObject({
      status: "unknown",
      requested_provider: "anthropic",
      unknown_reason: "review_execution_error",
    });
    expect(JSON.stringify(await runtime.status("exception"))).not.toContain(
      "PRIVATE_EXCEPTION",
    );
  } finally {
    await runtime.close();
  }
});
it("uses provider-specific env values without shared Anthropic fallback", async () => {
  vi.stubEnv("REBUT_OPENAI_API_KEY", "synthetic-openai-key-not-real-123456789");
  vi.stubEnv(
    "ANTHROPIC_API_KEY",
    "synthetic-shared-host-key-not-real-123456789",
  );
  vi.stubEnv("REBUT_ANTHROPIC_API_KEY", "");
  await expect(
    loadToken(settings(), "provider", "anthropic"),
  ).rejects.toThrow();
  expect(await loadToken(settings(), "provider", "openai")).toContain(
    "synthetic-openai",
  );
  vi.stubEnv(
    "REBUT_ANTHROPIC_API_KEY",
    "synthetic-dedicated-anthropic-not-real-123456789",
  );
  expect(await loadToken(settings(), "provider", "anthropic")).toContain(
    "synthetic-dedicated",
  );
});
it("performs only bounded model metadata GETs with the proper provider identity", async () => {
  const profile = { provider: "anthropic" as const, model: "claude-opus-5-5" };
  const key = "synthetic-key-not-real-1234567890123";
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ id: profile.model })));
  expect(await providerDiagnostic(profile, key, fetcher)).toMatchObject({
    provider: "anthropic",
    status: "metadata_reachable",
  });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "https://api.anthropic.com/v1/models/claude-opus-5-5",
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    method: "GET",
    redirect: "error",
    headers: { "x-api-key": key },
  });
  await expect(
    providerDiagnostic({ ...profile, model: ".." }, key, fetcher),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});
