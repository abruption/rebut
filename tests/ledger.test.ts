import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { Ledger, type Limits } from "../src/ledger.js";
function setup(beforeRun?: (sql: string) => Promise<void>) {
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
        if (beforeRun) await beforeRun(sql);
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

describe("monthly budget opt-in", () => {
  const at = (day: string) => new Date(day + "T00:00:00Z");
  const monthly = { ...limits, monthlyMicrousd: 100, maxConcurrent: 2 };
  const migration = readFileSync("migrations/0003_budget_cycle.sql", "utf8");
  const spend = (ledger: Ledger, id: string, day: string, amount = 80) =>
    ledger.reserve("a", id, "same", "hash", "p", amount, monthly, at(day));

  it("rejects a reservation that read the default just before activation", async () => {
    let activate: (() => Promise<unknown>) | undefined;
    const { ledger, db } = setup(async (sql) => {
      if (!sql.startsWith("INSERT INTO requests") || !activate) return;
      const switchCycle = activate;
      activate = undefined;
      await switchCycle();
    });
    db.exec(migration);
    activate = () => ledger.scheduleMonthlyCycle(15, at("2026-11-21"));

    expect(await spend(ledger, "racing-request", "2026-11-21")).toEqual({
      status: "budget_schedule_changed",
    });
    expect(await ledger.get("a", "racing-request")).toBeNull();
    expect(await ledger.budget(monthly, at("2026-11-21"))).toMatchObject({
      monthly_start_day: 15,
      monthly_accounted_microusd: 0,
      unresolved_slots: 0,
    });
    expect((await spend(ledger, "racing-request", "2026-11-21")).status).toBe(
      "acquired",
    );
    expect((await spend(ledger, "racing-request", "2026-11-21")).status).toBe(
      "existing",
    );
  });

  it.each([2, 15])(
    "extends an existing calendar period to the first eligible day %i",
    async (day) => {
      const { ledger, db } = setup();
      const request = await spend(ledger, "original", "2026-11-12");
      expect(request.status).toBe("acquired");
      db.exec(migration);
      const next = `2026-12-${String(day).padStart(2, "0")}`;
      expect(
        await ledger.scheduleMonthlyCycle(day, at("2026-11-13")),
      ).toMatchObject({
        status: "configured",
        effective_at: next + "T00:00:00.000Z",
      });
      expect(await ledger.budget(monthly, at("2026-12-01"))).toMatchObject({
        monthly_accounted_microusd: 80,
        unresolved_slots: 1,
        period_start: "2026-11-01T00:00:00.000Z",
        next_reset_at: next + "T00:00:00.000Z",
      });
      expect((await spend(ledger, "blocked", "2026-12-01", 21)).status).toBe(
        "limit_exceeded",
      );
      if (request.status !== "acquired")
        throw Error("fixture reservation failed");
      await ledger.finish("a", "original", request.row.claim, "unknown", 0, {});
      expect((await spend(ledger, "original", next)).status).toBe("existing");
      expect((await spend(ledger, "fresh", next)).status).toBe("acquired");
      expect(await ledger.budget(monthly, at(next))).toMatchObject({
        monthly_accounted_microusd: 80,
        unresolved_slots: 2,
        period_start: next + "T00:00:00.000Z",
      });
      expect((await spend(ledger, "slot", next, 1)).status).toBe(
        "limit_exceeded",
      );
      expect(await ledger.scheduleMonthlyCycle(1, at(next))).toMatchObject({
        status: "conflict",
        monthly_start_day: day,
      });
      expect((await ledger.get("a", "original"))?.charged_microusd).toBe(80);
      expect(
        db
          .prepare("SELECT month FROM requests WHERE request_id='original'")
          .get(),
      ).toEqual({ month: "2026-11" });
    },
  );

  it("immediately configures an empty ledger and detects a stale schedule request at a boundary", async () => {
    const { db, ledger } = setup();
    db.exec(migration);
    expect(
      await ledger.scheduleMonthlyCycle(15, at("2026-01-01")),
    ).toMatchObject({
      status: "configured",
      effective_at: "2025-12-15T00:00:00.000Z",
    });
    expect(await ledger.budget(monthly, at("2026-02-14"))).toMatchObject({
      period_start: "2026-01-15T00:00:00.000Z",
      next_reset_at: "2026-02-15T00:00:00.000Z",
    });
    expect(await ledger.budget(monthly, at("2026-02-15"))).toMatchObject({
      period_start: "2026-02-15T00:00:00.000Z",
      next_reset_at: "2026-03-15T00:00:00.000Z",
    });
    const stale = setup();
    stale.db.exec(migration);
    await spend(stale.ledger, "next-window", "2026-12-01");
    expect(
      await stale.ledger.scheduleMonthlyCycle(15, at("2026-11-30")),
    ).toMatchObject({
      status: "conflict",
      monthly_start_day: 1,
    });
  });

  it("blocks legacy inserts through the ledger fence while preserving settlement", async () => {
    const { db, ledger } = setup();
    const original = await spend(ledger, "original", "2026-11-12");
    db.exec(migration);
    await ledger.scheduleMonthlyCycle(15, at("2026-11-13"));
    // Matches the old writer, which omits monthly_cycle_day.
    expect(() =>
      db
        .prepare(
          "INSERT INTO requests(principal,request_id,fingerprint,input_sha256,profile,claim,created_at,day,month,state,reserved_microusd,charged_microusd,metadata) SELECT principal,'legacy',fingerprint,input_sha256,profile,claim,created_at,day,month,state,reserved_microusd,charged_microusd,metadata FROM requests WHERE request_id='original'",
        )
        .run(),
    ).toThrow(/budget_schedule_changed/);
    if (original.status !== "acquired")
      throw Error("fixture reservation failed");
    await ledger.finish(
      "a",
      "original",
      original.row.claim,
      "completed",
      25,
      {},
    );
    expect(await ledger.get("a", "original")).toMatchObject({
      state: "completed",
      charged_microusd: 25,
    });
  });
});
