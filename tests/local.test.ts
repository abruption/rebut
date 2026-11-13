import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  chmod,
  readFile,
  stat,
  symlink,
  writeFile,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  openLocalRuntime,
  DEFAULT_LOCAL_LIMITS,
  localMcpServer,
  type LocalRuntime,
} from "../src/local.js";
import {
  SettingsSchema,
  executionMode,
  readSettings,
} from "../src/client/settings.js";
import { inputHash } from "../src/contracts.js";
import { loadToken } from "../src/client/secrets.js";
import * as reviewModule from "../src/review.js";
import { profileCommand } from "../src/client/profiles.js";
const base = process.cwd().startsWith("/Volumes/Kingston NV/")
  ? "/Volumes/Kingston NV/tmp"
  : tmpdir();
const settings = () =>
  SettingsSchema.parse({
    schemaVersion: 1,
    mode: "local",
    secretStore: "env",
    vaultwardenItem: "unused",
  });
const key = "synthetic-local-key-not-real-123456789";
const source = "PRIVATE_SOURCE_DO_NOT_STORE";
const privateReview = "PRIVATE_REVIEW_DO_NOT_STORE";
async function input(id = "local-request") {
  const value = {
    schema_version: 1 as const,
    request_id: id,
    profile: "luna-test",
    task_kind: "code" as const,
    requirements: "Synthetic only",
    files: [{ path: "sample.ts", start_line: 1, content: source }],
    diff: "",
    input_sha256: "",
  };
  value.input_sha256 = await inputHash(value);
  return value;
}
function successfulFetch() {
  return vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          id: "resp_local_fixture",
          model: "gpt-6-luna",
          status: "completed",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 5 },
          },
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              phase: "final_answer",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    summary: privateReview,
                    findings: [],
                    additional_evidence: [],
                  }),
                },
              ],
            },
          ],
        }),
        { headers: { "x-request-id": "req_local_fixture" } },
      ),
  );
}
async function fixture(run: (directory: string) => Promise<void>) {
  const root = await mkdtemp(join(base, "codex-local-rebut-"));
  await chmod(root, 0o700);
  try {
    await run(join(root, "data"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function row(path: string, id: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare("SELECT * FROM requests WHERE request_id=?")
      .get(id) as any;
  } finally {
    db.close();
  }
}
async function entered(f: ReturnType<typeof successfulFetch>) {
  await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1), {
    timeout: 2000,
    interval: 10,
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("defaults new settings to local but preserves endpoint-only Worker configurations", async () =>
  fixture(async (directory) => {
    vi.stubEnv("REBUT_CONFIG_DIR", directory);
    expect(executionMode(await readSettings())).toBe("local");
    const old = SettingsSchema.parse({
      schemaVersion: 1,
      secretStore: "env",
      vaultwardenItem: "old",
      endpoint: "https://worker.invalid/mcp",
    });
    expect(executionMode(old)).toBe("worker");
    expect(executionMode({ ...old, mode: "local" })).toBe("local");
  }));
it("keeps OpenAI API credentials separate from Worker access and admin tokens", async () => {
  vi.stubEnv("REBUT_OPENAI_API_KEY", key);
  vi.stubEnv("REBUT_TOKEN", "synthetic-bearer-not-a-real-token-123456");
  vi.stubEnv("REBUT_ADMIN_TOKEN", "synthetic-admin-not-a-real-token-123456");
  expect(await loadToken(settings(), "provider")).toBe(key);
  expect(await loadToken(settings(), "review")).not.toBe(key);
  expect(await loadToken(settings(), "admin")).not.toBe(key);
});
it("persists only metadata and replays an existing request without loading a key or provider", async () =>
  fixture(async (directory) => {
    const f = successfulFetch();
    let runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: async () => key,
    });
    const bundle = await input();
    const outcome = await runtime.review(bundle);
    expect(outcome).toMatchObject({
      status: "completed",
      actual_model: "gpt-6-luna",
    });
    expect(f).toHaveBeenCalledTimes(1);
    const path = runtime.path;
    await runtime.close();
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const bytes = await readFile(path);
    for (const secret of [key, source, privateReview])
      expect(bytes.includes(Buffer.from(secret))).toBe(false);
    const missing = vi.fn(async () => {
      throw Error("KEYCHAIN_UNAVAILABLE");
    });
    runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: missing,
    });
    try {
      const replay = await runtime.review(bundle);
      expect(replay).toMatchObject({
        status: "completed",
        result_replay_available: false,
      });
      expect(replay).not.toHaveProperty("review");
      expect(missing).not.toHaveBeenCalled();
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.close();
    }
  }));
it("deduplicates simultaneous requests from separate SQLite connections", async () =>
  fixture(async (directory) => {
    let complete!: () => void;
    const gate = new Promise<void>((r) => {
      complete = r;
    });
    const response = successfulFetch();
    const f = vi.fn<typeof fetch>().mockImplementation(async (...args) => {
      await gate;
      return response(...args);
    });
    const a = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: async () => key,
    });
    const b = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: async () => key,
    });
    try {
      const bundle = await input();
      const pending = a.review(bundle);
      await entered(f);
      expect(await b.review(bundle)).toMatchObject({
        status: "reserved",
        result_replay_available: false,
      });
      complete();
      expect(await pending).toMatchObject({ status: "completed" });
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      complete();
      await Promise.all([a.close(), b.close()]);
    }
  }));
it("retains unknown reservation and concurrency across restart without another paid attempt", async () =>
  fixture(async (directory) => {
    const f = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private transport error"));
    let runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: async () => key,
    });
    const bundle = await input();
    expect(await runtime.review(bundle)).toMatchObject({
      status: "unknown",
      unknown_reason: "provider_transport_error",
    });
    const path = runtime.path;
    await runtime.close();
    const stored = row(path, bundle.request_id);
    expect(stored.state).toBe("unknown");
    expect(stored.charged_microusd).toBe(stored.reserved_microusd);
    expect(stored.metadata).not.toContain("private transport error");
    runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: async () => key,
    });
    try {
      expect(await runtime.status(bundle.request_id)).toMatchObject({
        status: "unknown",
      });
      expect(await runtime.review(bundle)).toMatchObject({ status: "unknown" });
      expect(
        await runtime.review({ ...bundle, request_id: "new-request" }),
      ).toMatchObject({ status: "limit_exceeded" });
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.close();
    }
  }));
it("cancels an in-flight local runtime into durable unknown before closing its database", async () =>
  fixture(async (directory) => {
    const f = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: async () => key,
    });
    const bundle = await input();
    const pending = runtime.review(bundle);
    await entered(f);
    const closing = runtime.close();
    expect(await pending).toMatchObject({
      status: "unknown",
      unknown_reason: "execution_aborted",
    });
    await closing;
    const stored = row(runtime.path, bundle.request_id);
    expect(stored.state).toBe("unknown");
    expect(stored.charged_microusd).toBe(stored.reserved_microusd);
    expect(f).toHaveBeenCalledTimes(1);
  }));
it("does not reserve or invoke the provider when a local API key is missing", async () =>
  fixture(async (directory) => {
    const f = successfulFetch();
    const runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: async () => {
        throw Error("KEYCHAIN_UNAVAILABLE");
      },
    });
    const bundle = await input();
    try {
      await expect(runtime.review(bundle)).rejects.toThrow(
        "PROVIDER_KEY_UNAVAILABLE",
      );
      expect(await runtime.status(bundle.request_id)).toEqual({
        status: "not_found",
      });
      expect(f).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  }));
it("uses local profile revision checks without remote credentials", async () =>
  fixture(async (directory) => {
    const runtime = await openLocalRuntime(settings(), {
      directory,
      loadApiKey: async () => {
        throw Error("must not load");
      },
    });
    try {
      const args = [
        "set",
        "local-custom",
        "--model",
        "future-model",
        "--reasoning",
        "medium",
        "--max-output-tokens",
        "1000",
        "--input-usd-per-million",
        "1",
        "--output-usd-per-million",
        "2",
        "--price-version",
        "fixture",
        "--if-revision",
        "0",
      ];
      expect(
        await profileCommand(args, { registry: runtime.profiles }),
      ).toMatchObject({ status: "updated", record: { revision: 1 } });
      await expect(
        profileCommand(args, { registry: runtime.profiles }),
      ).rejects.toThrow("revision conflict");
      expect(
        await profileCommand(["remove", "local-custom", "--if-revision", "1"], {
          registry: runtime.profiles,
        }),
      ).toMatchObject({
        status: "updated",
        record: { revision: 2, enabled: false },
      });
    } finally {
      await runtime.close();
    }
  }));
it("serves genuine local MCP tools and metadata without a provider key", async () =>
  fixture(async (directory) => {
    const missing = vi.fn(async () => {
      throw Error("no key");
    });
    const runtime = await openLocalRuntime(settings(), {
      directory,
      loadApiKey: missing,
    });
    const server = await localMcpServer(runtime, settings());
    const client = new Client({ name: "local-host", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(a), server.connect(b)]);
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
        "review",
        "review_status",
      ]);
      const status = await client.callTool({
        name: "review_status",
        arguments: { request_id: "missing" },
      });
      expect(JSON.parse((status.content as any)[0].text)).toEqual({
        backend: "local",
        status: "not_found",
      });
      expect(missing).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await runtime.close();
      await server.close();
    }
  }));
it("refuses symlinked databases, linked databases and non-private directories before execution", async () =>
  fixture(async (directory) => {
    await mkdir(directory, { mode: 0o700 });
    const target = join(directory, "other.sqlite");
    await writeFile(target, "", { mode: 0o600 });
    const path = join(directory, "ledger.sqlite");
    await symlink(target, path);
    await expect(openLocalRuntime(settings(), { directory })).rejects.toThrow(
      "LOCAL_STORAGE_UNSAFE",
    );
    await rm(path);
    await link(target, path);
    await expect(openLocalRuntime(settings(), { directory })).rejects.toThrow(
      "LOCAL_STORAGE_UNSAFE",
    );
    await rm(path);
    await rm(target);
    await chmod(directory, 0o755);
    await expect(openLocalRuntime(settings(), { directory })).rejects.toThrow(
      "LOCAL_STORAGE_UNSAFE",
    );
  }));

it("propagates an MCP caller cancellation into a recorded unknown outcome", async () =>
  fixture(async (directory) => {
    const f = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: async () => key,
    });
    const server = await localMcpServer(runtime, settings());
    const client = new Client({ name: "cancel-host", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const controller = new AbortController();
    try {
      await Promise.all([client.connect(a), server.connect(b)]);
      const bundle = await input("cancel-through-mcp");
      const pending = client
        .callTool(
          { name: "review", arguments: bundle },
          { signal: controller.signal },
        )
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await entered(f);
      controller.abort();
      expect(await pending).toHaveProperty("error");
      await vi.waitFor(
        async () =>
          expect(await runtime.status(bundle.request_id)).toMatchObject({
            status: "unknown",
            unknown_reason: "execution_aborted",
          }),
        { timeout: 2000, interval: 10 },
      );
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await runtime.close();
      await server.close();
    }
  }));
it("allows an explicit enabled profile when the implicit default was removed", async () =>
  fixture(async (directory) => {
    const f = successfulFetch();
    const runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: f,
      loadApiKey: async () => key,
    });
    await runtime.profiles.remove("astra-medium", 0);
    const server = await localMcpServer(runtime, settings());
    const client = new Client({ name: "explicit-host", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(a), server.connect(b)]);
      const outcome = await client.callTool({
        name: "review",
        arguments: await input("explicit-luna"),
      });
      expect(JSON.parse((outcome.content as any)[0].text)).toMatchObject({
        backend: "local",
        status: "completed",
        actual_model: "gpt-6-luna",
      });
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await runtime.close();
      await server.close();
    }
  }));

it("uses a general OpenAI environment key only after explicit selection", async () => {
  vi.stubEnv("REBUT_OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", key);
  await expect(loadToken(settings(), "provider")).rejects.toThrow(
    "TOKEN_INVALID",
  );
  expect(
    await loadToken({ ...settings(), apiKeyEnv: "OPENAI_API_KEY" }, "provider"),
  ).toBe(key);
});
it("recovers a newly enabled preferred profile and preserves old IDs after removal", async () =>
  fixture(async (directory) => {
    const f = successfulFetch();
    const configured = { ...settings(), defaultProfile: "dynamic-local" };
    const runtime = await openLocalRuntime(configured, {
      directory,
      fetcher: f,
      loadApiKey: async () => key,
    });
    const server = await localMcpServer(runtime, configured);
    const client = new Client({ name: "dynamic-host", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(a), server.connect(b)]);
      const bundle = {
        ...(await input("dynamic-local-review")),
        profile: "dynamic-local",
      };
      const call = async (value: typeof bundle) =>
        JSON.parse(
          (
            (await client.callTool({ name: "review", arguments: value }))
              .content as any
          )[0].text,
        );
      expect(await call(bundle)).toMatchObject({
        status: "profile_not_allowed",
      });
      expect(f).not.toHaveBeenCalled();
      const seed = await runtime.profiles.resolve("luna-test");
      await runtime.profiles.set("dynamic-local", seed!.profile, 0);
      expect(await call(bundle)).toMatchObject({
        status: "completed",
        actual_model: "gpt-6-luna",
      });
      await runtime.profiles.remove("dynamic-local", 1);
      expect(await call(bundle)).toMatchObject({
        status: "completed",
        result_replay_available: false,
      });
      expect(
        await call({ ...bundle, request_id: "new-disabled" }),
      ).toMatchObject({ status: "profile_not_allowed" });
      expect(f).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await runtime.close();
      await server.close();
    }
  }));
it("does not change a newer ledger's schema or journal mode", async () =>
  fixture(async (directory) => {
    await mkdir(directory, { mode: 0o700 });
    const path = join(directory, "ledger.sqlite");
    const db = new DatabaseSync(path);
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA user_version=3; CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES ('preserve');",
    );
    db.close();
    await chmod(path, 0o600);
    await expect(openLocalRuntime(settings(), { directory })).rejects.toThrow(
      "LOCAL_SCHEMA_UNSUPPORTED",
    );
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
      expect(check.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe(
        "wal",
      );
      expect(check.prepare("SELECT value FROM future_data").get()?.value).toBe(
        "preserve",
      );
    } finally {
      check.close();
    }
  }));

it("reports provider-key failure before acquisition with no reservation or paid call", async () =>
  fixture(async (directory) => {
    const runtime = await openLocalRuntime(settings(), {
      directory,
      loadApiKey: async () => {
        throw Error("private keychain failure");
      },
    });
    const server = await localMcpServer(runtime, settings());
    const client = new Client({ name: "missing-key-host", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(a), server.connect(b)]);
      const bundle = await input("no-provider-key");
      const outcome = await client.callTool({
        name: "review",
        arguments: bundle,
      });
      expect(JSON.parse((outcome.content as any)[0].text)).toMatchObject({
        backend: "local",
        status: "provider_key_unavailable",
      });
      expect(await runtime.status(bundle.request_id)).toEqual({
        status: "not_found",
      });
    } finally {
      await client.close();
      await runtime.close();
      await server.close();
    }
  }));
it("retains bounded diagnostics if the provider execution boundary throws unexpectedly", async () =>
  fixture(async (directory) => {
    const spy = vi
      .spyOn(reviewModule, "runReview")
      .mockRejectedValue(new Error("private boundary error"));
    const runtime = await openLocalRuntime(settings(), {
      directory,
      loadApiKey: async () => key,
    });
    const bundle = await input("boundary-error");
    try {
      expect(await runtime.review(bundle)).toMatchObject({
        status: "unknown",
        unknown_reason: "review_execution_error",
      });
      const stored = row(runtime.path, bundle.request_id);
      expect(stored.charged_microusd).toBe(stored.reserved_microusd);
      expect(stored.metadata).not.toContain("private boundary error");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.close();
    }
  }));

it("adds operator-selected capacity while keeping the old uncertainty fully accounted", async () =>
  fixture(async (directory) => {
    const failed = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("synthetic failure"));
    let runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: failed,
      loadApiKey: async () => key,
    });
    const original = await input("uncertain-original");
    await runtime.review(original);
    const limits = runtime.config.limits;
    const before = row(runtime.path, original.request_id);
    await runtime.close();
    const success = successfulFetch();
    runtime = await openLocalRuntime(
      { ...settings(), localLimits: { ...limits, maxConcurrent: 2 } },
      { directory, fetcher: success, loadApiKey: async () => key },
    );
    try {
      const next = {
        ...(await input("intentional-new-review")),
        requirements: "A different intentional review",
      };
      next.input_sha256 = await inputHash(next);
      expect(await runtime.review(next)).toMatchObject({ status: "completed" });
      expect(await runtime.review(original)).toMatchObject({
        status: "unknown",
      });
      const after = row(runtime.path, original.request_id);
      expect(after).toEqual(before);
      expect(success).toHaveBeenCalledTimes(1);
      expect(await runtime.status(original.request_id)).toMatchObject({
        budget_reserved_microusd: before.reserved_microusd,
        budget_accounted_microusd: before.charged_microusd,
      });
    } finally {
      await runtime.close();
    }
  }));

it("lists uncertain IDs and accounting without keys or new provider calls", async () =>
  fixture(async (directory) => {
    const failed = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("synthetic network error"));
    let runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: failed,
      loadApiKey: async () => key,
    });
    const original = await input("find-this-uncertain-id");
    await runtime.review(original);
    await runtime.close();
    const missing = vi.fn(async () => {
      throw Error("no key");
    });
    runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: failed,
      loadApiKey: missing,
    });
    try {
      const result = await runtime.pending();
      expect(result.has_more).toBe(false);
      expect(result.requests).toHaveLength(1);
      expect(result.requests[0]).toMatchObject({
        request_id: original.request_id,
        status: "unknown",
        profile: "luna-test",
        unknown_reason: "provider_transport_error",
      });
      expect(result.requests[0]!.budget_accounted_microusd).toBe(
        result.requests[0]!.budget_reserved_microusd,
      );
      expect(missing).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.close();
    }
  }));
it("pins the independent local default ceilings", () => {
  expect(DEFAULT_LOCAL_LIMITS).toEqual({
    dailyMicrousd: 6660000,
    monthlyMicrousd: 200000000,
    requestMicrousd: 6660000,
    maxConcurrent: 1,
    dailyRequests: 100,
  });
});

it("uses authoritative ledger state and identity after an operator settlement", async () =>
  fixture(async (directory) => {
    const runtime = await openLocalRuntime(settings(), {
      directory,
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("synthetic")),
      loadApiKey: async () => key,
    });
    const bundle = await input("operator-settlement");
    await runtime.review(bundle);
    const db = new DatabaseSync(runtime.path);
    try {
      db.prepare(
        "UPDATE requests SET state='incomplete', metadata=json_set(metadata,'$.input_sha256','stale-metadata','$.result_replay_available',1) WHERE principal='local' AND request_id=?",
      ).run(bundle.request_id);
    } finally {
      db.close();
    }
    try {
      expect(await runtime.status(bundle.request_id)).toMatchObject({
        status: "incomplete",
        input_sha256: bundle.input_sha256,
        result_replay_available: false,
      });
      expect((await runtime.pending()).requests).toEqual([]);
    } finally {
      await runtime.close();
    }
  }));
