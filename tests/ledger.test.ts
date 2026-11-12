import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { Ledger, type Limits } from "../src/ledger.js";
function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0001_ledger.sql", "utf8"));
  function prepare(sql: string) {
    let args: unknown[] = [];
    return {
      bind(...values: unknown[]) {
        args = values;
        return this;
      },
      async first() {
        return db.prepare(sql).get(...(args as never[])) ?? null;
      },
      async run() {
        return db.prepare(sql).run(...(args as never[]));
      },
    };
  }
  return { ledger: new Ledger({ prepare } as unknown as D1Database), db };
}
const limits: Limits = {
  dailyMicrousd: 100,
  monthlyMicrousd: 150,
  requestMicrousd: 100,
  maxConcurrent: 3,
  dailyRequests: 10,
};
const date = new Date("2026-11-12T12:00:00Z");
describe("atomic ledger", () => {
  it("acquires once for simultaneous identical request", async () => {
    const { ledger } = setup();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        ledger.reserve("a", "id", "same", "hash", "p", 60, limits, date),
      ),
    );
    expect(results.filter((r) => r.status === "acquired")).toHaveLength(1);
    expect(results.filter((r) => r.status === "existing")).toHaveLength(7);
  });
  it("rejects changed input and sums global budgets across principals", async () => {
    const { ledger } = setup();
    await ledger.reserve("a", "one", "f", "h", "p", 60, limits, date);
    expect(
      (await ledger.reserve("a", "one", "changed", "h", "p", 60, limits, date))
        .status,
    ).toBe("conflict");
    expect(
      (await ledger.reserve("b", "two", "f", "h", "p", 60, limits, date))
        .status,
    ).toBe("limit_exceeded");
  });
  it("settles known usage but retains unknown reservation and concurrency", async () => {
    const { ledger } = setup();
    const r = await ledger.reserve("a", "one", "f", "h", "p", 60, limits, date);
    if (r.status !== "acquired") throw Error();
    await ledger.finish("a", "one", r.row.claim, "completed", 10, {
      usage: { input_tokens: 1 },
    });
    expect((await ledger.get("a", "one"))?.charged_microusd).toBe(10);
    const r2 = await ledger.reserve(
      "a",
      "two",
      "f",
      "h",
      "p",
      60,
      limits,
      date,
    );
    if (r2.status !== "acquired") throw Error();
    await ledger.finish("a", "two", r2.row.claim, "unknown", 0, {});
    expect((await ledger.get("a", "two"))?.charged_microusd).toBe(60);
    expect(
      (
        await ledger.reserve(
          "b",
          "three",
          "f",
          "h",
          "p",
          10,
          { ...limits, maxConcurrent: 1 },
          date,
        )
      ).status,
    ).toBe("limit_exceeded");
  });
  it("isolates status by principal and enforces month across UTC days", async () => {
    const { ledger } = setup();
    await ledger.reserve("a", "one", "f", "h", "p", 90, limits, date);
    expect(await ledger.get("b", "one")).toBeNull();
    expect(
      (
        await ledger.reserve(
          "a",
          "two",
          "f",
          "h",
          "p",
          90,
          limits,
          new Date("2026-11-13T00:00:00Z"),
        )
      ).status,
    ).toBe("limit_exceeded");
    expect(
      (
        await ledger.reserve(
          "a",
          "three",
          "f",
          "h",
          "p",
          90,
          limits,
          new Date("2026-12-01T00:00:00Z"),
        )
      ).status,
    ).toBe("acquired");
  });
  it("cannot settle someone else claim or overwrite a terminal state", async () => {
    const { ledger } = setup();
    const r = await ledger.reserve("a", "one", "f", "h", "p", 60, limits, date);
    if (r.status !== "acquired") throw Error();
    await ledger.finish("a", "one", "wrong", "completed", 0, {});
    expect((await ledger.get("a", "one"))?.state).toBe("reserved");
    await ledger.finish("a", "one", r.row.claim, "unknown", undefined, {});
    await ledger.finish("a", "one", r.row.claim, "completed", 0, {});
    expect((await ledger.get("a", "one"))?.state).toBe("unknown");
  });
});
