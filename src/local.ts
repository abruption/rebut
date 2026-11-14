import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { createNodeHttpTransport } from "./client/http.js";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { ReviewInputSchema, type Provider } from "./contracts.js";
import { parseConfig } from "./config.js";
import { handleReview, metadata, ProviderKeyUnavailable } from "./service.js";
import { Ledger, type LedgerRow } from "./ledger.js";
import { ProfileRegistry } from "./profiles.js";
import { resolveProfile } from "./client/profiles.js";
import { settingsPath, type Settings } from "./client/settings.js";
import { loadToken } from "./client/secrets.js";

const PRINCIPAL = "local";
export const DEFAULT_LOCAL_LIMITS = Object.freeze({
  dailyMicrousd: 6_660_000,
  monthlyMicrousd: 200_000_000,
  requestMicrousd: 6_660_000,
  maxConcurrent: 1,
  dailyRequests: 100,
});
export function localDirectory(): string {
  return process.env.REBUT_CONFIG_DIR
    ? join(dirname(settingsPath()), "local")
    : join(homedir(), ".local", "share", "rebut", "local");
}
export async function localConfig(settings: Settings) {
  const defaults = JSON.parse(
    await readFile(new URL("../config.example.json", import.meta.url), "utf8"),
  );
  return parseConfig(
    JSON.stringify({
      ...defaults,
      hostname: "localhost",
      limits: settings.localLimits ?? DEFAULT_LOCAL_LIMITS,
    }),
  );
}
async function privatePath(path: string, directory: boolean) {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    (!directory && stat.nlink !== 1)
  )
    throw Error("LOCAL_STORAGE_UNSAFE");
  if (
    process.platform !== "win32" &&
    ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
  )
    throw Error("LOCAL_STORAGE_UNSAFE");
}
function adapter(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let args: SQLInputValue[] = [];
      return {
        bind(...values: SQLInputValue[]) {
          args = values;
          return this;
        },
        async first<T>() {
          return (database.prepare(sql).get(...args) ?? null) as T | null;
        },
        async all<T>() {
          return {
            success: true,
            results: database.prepare(sql).all(...args) as T[],
          };
        },
        async run() {
          database.prepare(sql).run(...args);
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}
export async function openLocalRuntime(
  settings: Settings,
  options: {
    directory?: string;
    fetcher?: typeof fetch;
    loadApiKey?: (provider: Provider) => Promise<string>;
  } = {},
) {
  const config = await localConfig(settings);
  // Read package assets before taking SQLite's write lock: no async I/O while
  // another process could block the event loop waiting for that lock.
  const migrations = await Promise.all(
    ["0001_ledger.sql", "0002_profiles.sql"].map((name) =>
      readFile(new URL("../migrations/" + name, import.meta.url), "utf8"),
    ),
  );
  const directory = resolve(options.directory ?? localDirectory());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await privatePath(directory, true);
  const path = join(directory, "ledger.sqlite");
  try {
    const file = await open(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await file.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await privatePath(path, false);
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path);
  let initialized = false;
  try {
    database.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;");
    const version = Number(
      database.prepare("PRAGMA user_version").get()?.user_version,
    );
    if (!Number.isInteger(version) || version < 0 || version > 2)
      throw Error("LOCAL_SCHEMA_UNSUPPORTED");
    if (version < 1) database.exec(migrations[0]!);
    if (version < 2) database.exec(migrations[1]!);
    if (version < 2) database.exec("PRAGMA user_version=2;");
    database.exec("COMMIT;");
    initialized = true;
  } finally {
    if (!initialized) {
      try {
        database.exec("ROLLBACK");
      } catch {}
      database.close();
    }
  }
  const db = adapter(database);
  const env = { DB: db, REBUT_CONFIG: JSON.stringify(config) };
  const profiles = new ProfileRegistry(db, config.profiles);
  const shutdown = new AbortController();
  const http = createNodeHttpTransport();
  const providerFetch = options.fetcher ?? http.fetch;
  const active = new Set<Promise<object>>();
  let closing: Promise<void> | undefined;
  return {
    path,
    config,
    profiles,
    async review(raw: unknown, signal?: AbortSignal) {
      if (shutdown.signal.aborted) throw Error("LOCAL_RUNTIME_CLOSED");
      const work = handleReview(raw, PRINCIPAL, env, {
        fetcher: providerFetch,
        loadApiKey:
          options.loadApiKey ??
          ((provider) => loadToken(settings, "provider", provider)),
        signal: AbortSignal.any([shutdown.signal, ...(signal ? [signal] : [])]),
      });
      active.add(work);
      try {
        return await work;
      } finally {
        active.delete(work);
      }
    },
    async pending() {
      const result = await db
        .prepare(
          "SELECT * FROM requests WHERE principal=? AND state IN ('reserved','unknown') ORDER BY created_at DESC, request_id ASC LIMIT 101",
        )
        .bind(PRINCIPAL)
        .all<LedgerRow & { created_at: string }>();
      if (!result.success) throw Error("LOCAL_STORAGE_UNAVAILABLE");
      return {
        requests: result.results.slice(0, 100).map((row) => ({
          ...metadata(row),
          request_id: row.request_id,
          created_at: row.created_at,
          profile: row.profile,
          budget_reserved_microusd: row.reserved_microusd,
          budget_accounted_microusd: row.charged_microusd,
        })),
        has_more: result.results.length > 100,
      };
    },
    async status(id: string) {
      const row = await new Ledger(db).get(PRINCIPAL, id);
      return row
        ? {
            ...metadata(row),
            budget_reserved_microusd: row.reserved_microusd,
            budget_accounted_microusd: row.charged_microusd,
          }
        : { status: "not_found" };
    },
    close() {
      return (closing ??= (async () => {
        shutdown.abort();
        await Promise.allSettled([...active]);
        try {
          await http.close();
        } finally {
          database.close();
        }
      })());
    },
  };
}
export type LocalRuntime = Awaited<ReturnType<typeof openLocalRuntime>>;
const toolResult = (value: object) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({ backend: "local", ...value }),
    },
  ],
});
export async function localMcpServer(
  runtime: LocalRuntime,
  settings: Settings,
) {
  const records = await runtime.profiles.list();
  const hasPreference = !!(
    settings.defaultModel ||
    settings.defaultReasoning ||
    settings.defaultProfile
  );
  let preferred: string | undefined,
    unavailable = false;
  try {
    preferred = resolveProfile(records, {
      profile: settings.defaultProfile,
      provider: settings.provider,
      model:
        settings.defaultModel || settings.defaultReasoning
          ? (settings.defaultModel ??
            records.find(
              (r) =>
                r.id ===
                  (settings.provider === "anthropic"
                    ? "claude-medium"
                    : "astra-medium") && r.enabled,
            )?.profile?.model)
          : undefined,
      reasoning: settings.defaultReasoning,
    });
  } catch {
    unavailable = hasPreference;
  }
  const server = new McpServer({ name: "rebut-mcp", version: "0.3.0" });
  server.registerTool(
    "review",
    {
      description: `Explicit opt-in provider review. Local per-device ledger; budgets are not shared with another machine or Worker. Keep the original request_id and backend after uncertainty; never replay another backend's uncertain request here. ${preferred ? "Preferred profile: " + preferred : unavailable ? "Configured profile is unavailable." : "Select an enabled profile explicitly."}`,
      inputSchema: ReviewInputSchema,
    },
    async (input, extra) => {
      // Preferences are collection/description hints. The explicit frozen
      // request profile and existing-ID metadata remain authoritative.
      try {
        return toolResult(await runtime.review(input, extra.mcpReq.signal));
      } catch (error) {
        if (error instanceof ProviderKeyUnavailable)
          return {
            isError: true,
            ...toolResult({
              status: "provider_key_unavailable",
              message:
                "Check local credentials with rebut doctor and query the original ID before any further paid invocation.",
            }),
          };
        return {
          isError: true,
          ...toolResult({
            status: "request_failed",
            message:
              "Query review_status with the same request_id before any further paid invocation.",
          }),
        };
      }
    },
  );
  server.registerTool(
    "review_status",
    {
      description:
        "Read local metadata only; no paid execution and no review-body replay.",
      inputSchema: z
        .object({
          request_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/),
        })
        .strict(),
    },
    async ({ request_id }) => {
      try {
        return toolResult(await runtime.status(request_id));
      } catch {
        return {
          isError: true,
          ...toolResult({ status: "status_unavailable" }),
        };
      }
    },
  );
  return server;
}
export async function serveLocalStdio(settings: Settings) {
  const runtime = await openLocalRuntime(settings);
  let server: McpServer;
  try {
    server = await localMcpServer(runtime, settings);
  } catch (error) {
    await runtime.close();
    throw error;
  }
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      try {
        await runtime.close();
        await server.close();
      } finally {
        finish();
      }
    })());
  const onSignal = () => {
    void close();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  server.server.onclose = onSignal;
  try {
    await server.connect(new StdioServerTransport());
    await finished;
  } finally {
    await close();
  }
}
