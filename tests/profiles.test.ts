import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Profile } from "../src/contracts.js";
import { ProfileRegistry } from "../src/profiles.js";

const profile: Profile = {
  model: "gpt-6-astra",
  reasoning: "medium",
  maxOutputTokens: 2000,
  inputMicrousdPerMillion: 100,
  outputMicrousdPerMillion: 200,
  priceVersion: "test-prices",
};
const databases: DatabaseSync[] = [];
function setup(
  seeds: Record<string, Profile> = { default: profile },
  migrate = true,
) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  if (migrate) db.exec(readFileSync("migrations/0002_profiles.sql", "utf8"));
  const d1 = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          args = values;
          return this;
        },
        async first() {
          return db.prepare(sql).get(...(args as never[])) ?? null;
        },
        async all() {
          return {
            success: true,
            results: db.prepare(sql).all(...(args as never[])),
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, registry: new ProfileRegistry(d1, seeds), d1 };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("dynamic profile registry", () => {
  it("resolves fallback seeds at revision zero and lists deterministically without prototype IDs", async () => {
    const { registry } = setup({
      z: profile,
      constructor: profile,
      A: profile,
    });
    expect(await registry.resolve("unknown")).toBeNull();
    expect(await registry.resolve("toString")).toBeNull();
    expect(await registry.resolve("constructor")).toEqual({
      profile,
      revision: 0,
    });
    expect((await registry.list()).map((row) => row.id)).toEqual([
      "A",
      "constructor",
      "z",
    ]);
    const resolved = await registry.resolve("A");
    resolved!.profile.model = "mutated";
    expect((await registry.resolve("A"))!.profile.model).toBe(profile.model);
  });

  it("creates a new model, updates revisions, and rejects stale writes without retrying", async () => {
    const { registry } = setup();
    const newer = { ...profile, model: "future-model", reasoning: "high" };
    expect(await registry.resolve("new.model-1")).toBeNull();
    expect(await registry.set("new.model-1", newer, 0)).toEqual({
      status: "updated",
      record: { id: "new.model-1", revision: 1, enabled: true, profile: newer },
    });
    expect(await registry.resolve("new.model-1")).toEqual({
      profile: newer,
      revision: 1,
    });
    expect(await registry.set("new.model-1", profile, 0)).toEqual({
      status: "conflict",
    });
    expect((await registry.set("new.model-1", profile, 1)).status).toBe(
      "updated",
    );
    expect(await registry.resolve("new.model-1")).toEqual({
      profile,
      revision: 2,
    });
    expect(await registry.remove("new.model-1", 1)).toEqual({
      status: "conflict",
    });
  });

  it("persists seed overrides and tombstones without falling back, and allows explicit reenable", async () => {
    const { registry, d1 } = setup();
    const override = { ...profile, reasoning: "high" };
    await registry.set("default", override, 0);
    expect(await registry.resolve("default")).toEqual({
      profile: override,
      revision: 1,
    });
    expect(await registry.remove("default", 1)).toEqual({
      status: "updated",
      record: { id: "default", revision: 2, enabled: false },
    });
    const restarted = new ProfileRegistry(d1, { default: profile });
    expect(await restarted.resolve("default")).toBeNull();
    expect(await restarted.list()).toEqual([
      { id: "default", revision: 2, enabled: false },
    ]);
    expect(await restarted.set("default", profile, 0)).toEqual({
      status: "conflict",
    });
    expect((await restarted.set("default", profile, 2)).status).toBe("updated");
    expect((await restarted.resolve("default"))!.revision).toBe(3);
    expect(await restarted.remove("unknown", 0)).toEqual({
      status: "conflict",
    });
  });

  it("can tombstone a seed directly at revision zero", async () => {
    const { registry } = setup();
    expect(await registry.remove("default", 0)).toEqual({
      status: "updated",
      record: { id: "default", revision: 1, enabled: false },
    });
    expect(await registry.resolve("default")).toBeNull();
  });

  it("allows only one simultaneous writer for initial and subsequent revisions", async () => {
    const { registry } = setup();
    const initial = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        registry.set("race", { ...profile, model: `model-${i}` }, 0),
      ),
    );
    expect(
      initial.filter((result) => result.status === "updated"),
    ).toHaveLength(1);
    expect(
      initial.filter((result) => result.status === "conflict"),
    ).toHaveLength(7);
    const updates = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        i % 2 ? registry.remove("race", 1) : registry.set("race", profile, 1),
      ),
    );
    expect(
      updates.filter((result) => result.status === "updated"),
    ).toHaveLength(1);
    expect(
      updates.filter((result) => result.status === "conflict"),
    ).toHaveLength(7);
    expect(
      (await registry.list()).find((row) => row.id === "race")!.revision,
    ).toBe(2);
  });

  it("rejects unsafe IDs, revisions, and profile values before mutation", async () => {
    const { registry, db } = setup();
    for (const id of ["", "_bad", "a/b", "x".repeat(65)]) {
      await expect(registry.resolve(id)).rejects.toMatchObject({
        code: "INVALID_PROFILE_ID",
      });
      await expect(registry.set(id, profile, 0)).rejects.toMatchObject({
        code: "INVALID_PROFILE_ID",
      });
    }
    for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      await expect(registry.remove("default", revision)).rejects.toMatchObject({
        code: "INVALID_REVISION",
      });
    await expect(
      registry.set("default", { ...profile, model: "secret invalid model" }, 0),
    ).rejects.toMatchObject({ code: "INVALID_PROFILE" });
    await expect(
      registry.set(
        "default",
        { ...profile, token: "private-value" } as Profile,
        0,
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROFILE" });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM review_profiles").get()!.n,
    ).toBe(0);
  });

  it("fails closed for malformed JSON and invalid stored schemas, including before overwrites", async () => {
    for (const value of [
      "{broken",
      JSON.stringify({ ...profile, model: "bad model" }),
      JSON.stringify({ ...profile, token: "private-value" }),
    ]) {
      const { registry, db } = setup();
      db.prepare("INSERT INTO review_profiles VALUES (?, 1, ?, ?)").run(
        "default",
        value,
        "2026-11-13T00:00:00Z",
      );
      await expect(registry.resolve("default")).rejects.toMatchObject({
        code: "CORRUPT_PROFILE",
      });
      await expect(registry.list()).rejects.toMatchObject({
        code: "CORRUPT_PROFILE",
      });
      await expect(registry.set("default", profile, 1)).rejects.toMatchObject({
        code: "CORRUPT_PROFILE",
      });
      await expect(registry.remove("default", 1)).rejects.toMatchObject({
        code: "CORRUPT_PROFILE",
      });
    }
  });

  it("fails closed on unavailable storage instead of returning seeds", async () => {
    const { registry } = setup(undefined, false);
    await expect(registry.resolve("default")).rejects.toMatchObject({
      code: "PROFILE_STORAGE",
    });
    await expect(registry.list()).rejects.toMatchObject({
      code: "PROFILE_STORAGE",
    });
    await expect(registry.set("default", profile, 0)).rejects.toMatchObject({
      code: "PROFILE_STORAGE",
    });
    await expect(registry.remove("default", 0)).rejects.toMatchObject({
      code: "PROFILE_STORAGE",
    });
  });
});
