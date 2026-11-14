import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listProfiles,
  profileCommand,
  resolveProfile,
  safeProfileError,
  type ProfileRecord,
} from "../src/client/profiles.js";

const profile = {
  model: "gpt-6-astra",
  reasoning: "medium",
  maxOutputTokens: 4096,
  inputMicrousdPerMillion: 1_000_000,
  outputMicrousdPerMillion: 2_000_000,
  priceVersion: "synthetic-v1",
};
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

async function fixture() {
  const records = new Map<string, ProfileRecord>([
    [
      "astra-medium",
      { id: "astra-medium", revision: 1, enabled: true, profile },
    ],
  ]);
  const requests: Array<{
    path: string;
    method: string;
    authorization?: string;
    body?: Record<string, unknown>;
  }> = [];
  let race = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : undefined;
    const path = request.url!;
    requests.push({
      path,
      method: request.method!,
      authorization: request.headers.authorization,
      body,
    });
    const send = (status: number, value: object) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    const token = request.headers.authorization;
    if (
      token !== "Bearer synthetic-review" &&
      token !== "Bearer synthetic-admin"
    )
      return send(401, { private: "token should not appear in errors" });
    if (path === "/profiles" && request.method === "GET")
      return send(200, { profiles: [...records.values()] });
    if (
      !path.startsWith("/admin/profiles/") ||
      !["PUT", "DELETE"].includes(request.method!)
    )
      return send(404, {});
    if (token !== "Bearer synthetic-admin")
      return send(403, { private: "admin secret" });
    const id = decodeURIComponent(path.slice("/admin/profiles/".length));
    const previous = records.get(id);
    if (race || body.expected_revision !== (previous?.revision ?? 0))
      return send(409, { status: "conflict", private: "do not print body" });
    const record: ProfileRecord = {
      id,
      revision: (previous?.revision ?? 0) + 1,
      enabled: request.method === "PUT",
      ...(request.method === "PUT" ? { profile: body.profile } : {}),
    };
    records.set(id, record);
    return send(200, { status: "updated", record });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing synthetic server address");
  const endpoint = `http://127.0.0.1:${address.port}/mcp`;
  const deps = {
    endpoint,
    loadReviewToken: vi.fn(async () => "synthetic-review"),
    loadAdminToken: vi.fn(async () => "synthetic-admin"),
  };
  return {
    endpoint,
    deps,
    records,
    requests,
    race: () => {
      race = true;
    },
  };
}

const setArgs = (id = "future.medium", price = "1.234567") => [
  "set",
  id,
  "--model",
  "gpt-99-future",
  "--reasoning",
  "future_effort",
  "--max-output-tokens",
  "8192",
  "--input-usd-per-million",
  price,
  "--output-usd-per-million",
  "2.000001",
  "--price-version",
  "explicit-price-v2",
];

describe("remote profile client", () => {
  it("lists and resolves revision-zero seed profiles and CAS replaces them at expected revision zero", async () => {
    const f = await fixture();
    f.records.set("astra-medium", {
      id: "astra-medium",
      revision: 0,
      enabled: true,
      profile,
    });
    const records = await listProfiles({
      endpoint: f.endpoint,
      loadToken: f.deps.loadReviewToken,
    });
    expect(records[0]?.revision).toBe(0);
    expect(resolveProfile(records, {})).toBe("astra-medium");
    await profileCommand(setArgs("astra-medium"), f.deps);
    expect(f.requests[2]?.body?.expected_revision).toBe(0);
    expect(f.records.get("astra-medium")?.revision).toBe(1);
  });
  it("exposes only fixed safe diagnostics to the CLI", () => {
    expect(
      safeProfileError(
        new Error("Profile authentication or authorization failed."),
      ),
    ).toBe("Profile authentication or authorization failed.");
    expect(
      safeProfileError(new Error("private source/token upstream failure")),
    ).toBeUndefined();
    expect(
      safeProfileError({
        message: "Profile authentication or authorization failed.",
      }),
    ).toBeUndefined();
    expect(safeProfileError("private")).toBeUndefined();
  });
  it("lists using reviewer authentication without loading admin credentials", async () => {
    const f = await fixture();
    expect(await profileCommand(["list"], f.deps)).toEqual({
      profiles: [...f.records.values()],
    });
    expect(f.deps.loadReviewToken).toHaveBeenCalledTimes(1);
    expect(f.deps.loadAdminToken).not.toHaveBeenCalled();
    expect(f.requests.map((request) => request.path)).toEqual(["/profiles"]);
  });
  it("creates future models with exact explicit prices and uses admin authentication for snapshot and CAS", async () => {
    const f = await fixture();
    const output = await profileCommand(setArgs(), f.deps);
    expect(output).toEqual({
      status: "updated",
      record: {
        id: "future.medium",
        revision: 1,
        enabled: true,
        profile: {
          ...profile,
          model: "gpt-99-future",
          reasoning: "future_effort",
          maxOutputTokens: 8192,
          inputMicrousdPerMillion: 1234567,
          outputMicrousdPerMillion: 2000001,
          priceVersion: "explicit-price-v2",
        },
      },
    });
    expect(f.requests.map((request) => [request.method, request.path])).toEqual(
      [
        ["GET", "/profiles"],
        ["PUT", "/admin/profiles/future.medium"],
      ],
    );
    expect(
      f.requests.every(
        (request) => request.authorization === "Bearer synthetic-admin",
      ),
    ).toBe(true);
    expect(f.requests[1]?.body?.expected_revision).toBe(0);
    expect(f.deps.loadReviewToken).not.toHaveBeenCalled();
    expect(JSON.stringify(output)).not.toContain("synthetic-admin");
  });
  it("reads revision for removal and supports explicit provider/revision without a snapshot", async () => {
    const f = await fixture();
    expect(await profileCommand(["remove", "astra-medium"], f.deps)).toEqual({
      status: "updated",
      record: { id: "astra-medium", revision: 2, enabled: false },
    });
    expect(f.requests[1]?.body).toEqual({ expected_revision: 1 });
    await profileCommand(
      [
        ...setArgs("astra-medium"),
        "--if-revision",
        "2",
        "--provider",
        "openai",
      ],
      f.deps,
    );
    expect(f.requests.map((request) => request.method)).toEqual([
      "GET",
      "DELETE",
      "PUT",
    ]);
    expect(f.requests[2]?.body?.expected_revision).toBe(2);
  });
  it("surfaces a CAS race safely and never retries the write", async () => {
    const f = await fixture();
    f.race();
    await expect(profileCommand(setArgs(), f.deps)).rejects.toThrow(
      "revision conflict",
    );
    expect(f.requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
  });
  it("does not accept reviewer credentials for administration or disclose token/error bodies", async () => {
    const f = await fixture();
    const stderr = vi.spyOn(process.stderr, "write");
    await expect(
      profileCommand(["remove", "astra-medium", "--if-revision", "1"], {
        ...f.deps,
        loadAdminToken: f.deps.loadReviewToken,
      }),
    ).rejects.toThrow("authentication or authorization");
    await expect(
      listProfiles({
        endpoint: f.endpoint,
        loadToken: async () => "synthetic-wrong",
      }),
    ).rejects.toThrow("authentication or authorization");
    expect(f.requests).toHaveLength(2);
    expect(stderr).not.toHaveBeenCalled();
  });
  it.each([
    "0",
    "-1",
    "0.0000001",
    "1e3",
    "NaN",
    "1000000.000001",
    "1.1234567",
  ])(
    "rejects invalid price %s before any HTTP or credential lookup",
    async (price) => {
      const deps = {
        endpoint: "https://synthetic.invalid/mcp",
        loadReviewToken: vi.fn(async () => "fake"),
        loadAdminToken: vi.fn(async () => "fake"),
      };
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await expect(
        profileCommand(setArgs("future", price), deps),
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
      expect(deps.loadAdminToken).not.toHaveBeenCalled();
    },
  );
  it.each(["0.000001", "1000000"])(
    "accepts exact price boundary %s",
    async (price) => {
      const f = await fixture();
      await profileCommand(
        [...setArgs("boundary", price), "--if-revision", "0"],
        f.deps,
      );
      expect(f.records.get("boundary")?.profile?.inputMicrousdPerMillion).toBe(
        price === "0.000001" ? 1 : 1_000_000_000_000,
      );
    },
  );
  it.each([
    ["set", "invalid/id"],
    ["remove", "safe", "--if-revision", "-1"],
    ["remove", "safe", "--if-revision", "9007199254740992"],
    ["remove", "safe", "--unknown", "1"],
    ["remove", "safe", "--if-revision", "1", "--if-revision", "1"],
    setArgs().filter(
      (_, index, args) =>
        index !== args.indexOf("--price-version") &&
        index !== args.indexOf("--price-version") + 1,
    ),
  ])(
    "rejects malformed or incomplete command flags",
    async (...args: string[]) => {
      const f = await fixture();
      await expect(profileCommand(args, f.deps)).rejects.toThrow();
      expect(f.requests).toHaveLength(0);
    },
  );
  it.each([
    {},
    { profiles: [{ id: "safe", revision: 1, enabled: true }] },
    { profiles: [{ id: "safe", revision: -1, enabled: false }] },
    { profiles: [{ id: "../bad", revision: 1, enabled: false }] },
    {
      profiles: [
        {
          id: "safe",
          revision: 1,
          enabled: true,
          profile: { ...profile, maxOutputTokens: 16385 },
        },
      ],
    },
    {
      profiles: [
        { id: "safe", revision: 1, enabled: false },
        { id: "safe", revision: 2, enabled: false },
      ],
    },
  ])(
    "rejects malformed profile responses without disclosing payloads",
    async (value) => {
      const fetcher = vi.fn<typeof fetch>(async () => Response.json(value));
      vi.stubGlobal("fetch", fetcher);
      await expect(
        listProfiles({
          endpoint: "https://synthetic.invalid/mcp",
          loadToken: async () => "fake",
        }),
      ).rejects.toThrow("Invalid profile service response");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([302, 401, 403, 409, 503])(
    "does not retry HTTP %s or disclose private bodies",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response("private token body", {
            status,
            headers: { Location: "https://elsewhere.invalid/profiles" },
          }),
      );
      vi.stubGlobal("fetch", fetcher);
      const error = await listProfiles({
        endpoint: "https://synthetic.invalid/mcp",
        loadToken: async () => "fake",
      }).catch((error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("private");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
    },
  );
  it("bounds streamed response bytes and malformed JSON", async () => {
    for (const body of ["x".repeat(65537), "not-json"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body)),
      );
      await expect(
        listProfiles({
          endpoint: "https://synthetic.invalid/mcp",
          loadToken: async () => "fake",
        }),
      ).rejects.toThrow("Profile request failed");
    }
  });
  it("times out stalled fetch and body reads after fifteen seconds", async () => {
    vi.useFakeTimers();
    for (const fetcher of [
      vi.fn<typeof fetch>(() => new Promise(() => {})),
      vi.fn<typeof fetch>(
        async () => new Response(new ReadableStream({ start() {} })),
      ),
    ]) {
      vi.stubGlobal("fetch", fetcher);
      const failed = expect(
        listProfiles({
          endpoint: "https://synthetic.invalid/mcp",
          loadToken: async () => "fake",
        }),
      ).rejects.toThrow("Profile request failed");
      await vi.advanceTimersByTimeAsync(15000);
      await failed;
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});

describe("profile resolution", () => {
  const records: ProfileRecord[] = [
    { id: "astra-medium", revision: 1, enabled: true, profile },
    {
      id: "future.high",
      revision: 2,
      enabled: true,
      profile: { ...profile, model: "future-model", reasoning: "high" },
    },
    { id: "disabled", revision: 3, enabled: false, profile },
  ];
  it("uses the installed default, model+default-medium, and explicit profile override", () => {
    expect(resolveProfile(records, {})).toBe("astra-medium");
    expect(resolveProfile(records, { model: "gpt-6-astra" })).toBe(
      "astra-medium",
    );
    expect(
      resolveProfile(records, { model: "future-model", reasoning: "high" }),
    ).toBe("future.high");
    expect(
      resolveProfile(records, {
        profile: "future.high",
        model: "other",
        reasoning: "none",
      }),
    ).toBe("future.high");
  });
  it("rejects disabled, missing, ambiguous and unavailable-default selections", () => {
    expect(() => resolveProfile(records, { profile: "disabled" })).toThrow();
    expect(() => resolveProfile(records, { model: "missing" })).toThrow();
    expect(() =>
      resolveProfile([...records, { ...records[0]!, id: "same-model" }], {
        model: "gpt-6-astra",
      }),
    ).toThrow("exactly one");
    expect(() => resolveProfile(records.slice(1), {})).toThrow("Default");
  });
});

it("does not inherit a disabled record's retained provider on local or remote mutation", async () => {
  const previous: ProfileRecord = {
    id: "disabled-retained",
    revision: 2,
    enabled: false,
    profile: { ...profile, provider: "anthropic", model: "claude-opus-5-5" },
  };
  const localSet = vi.fn(
    async (
      id: string,
      value: import("../src/contracts.js").Profile,
      revision: number,
    ) => ({
      status: "updated" as const,
      record: { id, revision: revision + 1, enabled: true, profile: value },
    }),
  );
  const local = {
    list: async () => [previous],
    set: localSet,
  } as unknown as import("../src/profiles.js").ProfileRegistry;
  await profileCommand(setArgs(previous.id), { registry: local });
  expect(localSet.mock.calls[0]?.[1].provider).toBeUndefined();
  const f = await fixture();
  f.records.set(previous.id, previous);
  await profileCommand(setArgs(previous.id), f.deps);
  expect(f.records.get(previous.id)?.profile?.provider).toBeUndefined();
});
