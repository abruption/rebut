import {
  monthlyBudgetPeriod,
  monthlyTransition,
  validMonthlyStartDay,
  type MonthlyCycle,
} from "./budget-cycle.js";

export interface Limits {
  dailyMicrousd: number;
  monthlyMicrousd: number;
  requestMicrousd: number;
  maxConcurrent: number;
  dailyRequests: number;
}
export interface LedgerRow {
  principal: string;
  request_id: string;
  fingerprint: string;
  input_sha256: string;
  profile: string;
  claim: string;
  state: string;
  reserved_microusd: number;
  charged_microusd: number;
  metadata: string | null;
}
export function monthlyCycleInsert(day: number, now: Date) {
  const t = monthlyTransition(now, day);
  // Reject a stale transition if a request has already opened the next month.
  const sql = `INSERT INTO monthly_budget_cycle(id, start_day, effective_at, bridge_month)
    SELECT 1, ?, CASE WHEN EXISTS (SELECT 1 FROM requests) THEN ? ELSE ? END,
                 CASE WHEN EXISTS (SELECT 1 FROM requests) THEN ? ELSE NULL END
    WHERE NOT EXISTS (SELECT 1 FROM requests WHERE day >= ?)
    ON CONFLICT(id) DO NOTHING`;
  const args = [
    day,
    t.effectiveForExistingLedger,
    t.effectiveForEmptyLedger,
    t.currentMonth,
    t.nextCalendarBoundary.slice(0, 10),
  ];
  return { sql, args };
}
export class Ledger {
  constructor(private db: D1Database) {}
  async get(principal: string, id: string): Promise<LedgerRow | null> {
    return this.db
      .prepare("SELECT * FROM requests WHERE principal=? AND request_id=?")
      .bind(principal, id)
      .first<LedgerRow>();
  }
  async monthlyCycle(): Promise<MonthlyCycle | null> {
    // Unmigrated Workers keep the calendar-month path until an operator enables a cycle.
    const table = await this.db
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='monthly_budget_cycle'",
      )
      .first();
    if (!table) return null;
    return this.db
      .prepare(
        "SELECT start_day, effective_at, bridge_month FROM monthly_budget_cycle WHERE id=1",
      )
      .first<MonthlyCycle>();
  }
  async scheduleMonthlyCycle(day: number, now = new Date()) {
    if (!validMonthlyStartDay(day)) throw Error("INVALID_MONTHLY_START_DAY");
    if (day !== 1) {
      const { sql, args } = monthlyCycleInsert(day, now);
      await this.db
        .prepare(sql)
        .bind(...args)
        .run();
    }
    return this.monthlyCycleSetting(day);
  }
  async monthlyCycleSetting(day: number) {
    const cycle = await this.monthlyCycle();
    return {
      status:
        (cycle?.start_day ?? 1) === day
          ? ("configured" as const)
          : ("conflict" as const),
      monthly_start_day: cycle?.start_day ?? 1,
      effective_at: cycle?.effective_at ?? null,
    };
  }
  async budget(limits: Limits, now = new Date()) {
    const cycle = await this.monthlyCycle();
    const period = monthlyBudgetPeriod(now, cycle);
    const totals = await this.db
      .prepare(
        `SELECT
         COALESCE((SELECT SUM(charged_microusd) FROM requests WHERE month=?),0) AS accounted,
         (SELECT COUNT(*) FROM requests WHERE state IN ('reserved','unknown')) AS unresolved`,
      )
      .bind(period.key)
      .first<{ accounted: number; unresolved: number }>();
    if (!totals) throw Error("BUDGET_STATUS_UNAVAILABLE");
    return {
      monthly_start_day: cycle?.start_day ?? 1,
      effective_at: cycle?.effective_at ?? null,
      period_start: period.start,
      next_reset_at: period.end,
      monthly_accounted_microusd: totals.accounted,
      monthly_limit_microusd: limits.monthlyMicrousd,
      unresolved_slots: totals.unresolved,
      max_concurrent: limits.maxConcurrent,
    };
  }
  async reserve(
    principal: string,
    id: string,
    fingerprint: string,
    hash: string,
    profile: string,
    amount: number,
    limits: Limits,
    now = new Date(),
    initialMetadata?: Record<string, unknown>,
  ) {
    const cycle = await this.monthlyCycle();
    const claim = crypto.randomUUID(),
      date = now.toISOString(),
      day = date.slice(0, 10),
      month = monthlyBudgetPeriod(now, cycle).key;
    const cycleColumn = cycle ? ",monthly_cycle_day" : "";
    const cycleValue = cycle ? ",?" : "";
    // One SQLite write statement: check aggregate budgets and insert under the same write lock.
    // Limits are deployment-wide, so adding principals cannot multiply the allowed spend.
    let scheduleChanged = false;
    try {
      await this.db
        .prepare(
          `INSERT INTO requests
   (principal,request_id,fingerprint,input_sha256,profile,claim,created_at,day,month,state,reserved_microusd,charged_microusd,metadata${cycleColumn})
   SELECT ?,?,?,?,?,?,?,?,?,'reserved',?,?,?${cycleValue}
   WHERE ? <= ?
   AND COALESCE((SELECT SUM(charged_microusd) FROM requests WHERE day=?),0)+? <= ?
   AND COALESCE((SELECT SUM(charged_microusd) FROM requests WHERE month=?),0)+? <= ?
   AND (SELECT COUNT(*) FROM requests WHERE state IN ('reserved','unknown')) < ?
   AND (SELECT COUNT(*) FROM requests WHERE day=?) < ?
   ON CONFLICT(principal,request_id) DO NOTHING`,
        )
        .bind(
          principal,
          id,
          fingerprint,
          hash,
          profile,
          claim,
          date,
          day,
          month,
          amount,
          amount,
          initialMetadata ? JSON.stringify(initialMetadata) : null,
          ...(cycle ? [cycle.start_day] : []),
          amount,
          limits.requestMicrousd,
          day,
          amount,
          limits.dailyMicrousd,
          month,
          amount,
          limits.monthlyMicrousd,
          limits.maxConcurrent,
          day,
          limits.dailyRequests,
        )
        .run();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("budget_schedule_changed")
      )
        throw error;
      scheduleChanged = true;
    }
    const row = await this.get(principal, id);
    if (!row)
      return {
        status: scheduleChanged
          ? ("budget_schedule_changed" as const)
          : ("limit_exceeded" as const),
      };
    if (row.fingerprint !== fingerprint) return { status: "conflict" as const };
    if (row.claim !== claim) return { status: "existing" as const, row };
    return { status: "acquired" as const, row };
  }
  async finish(
    principal: string,
    id: string,
    claim: string,
    state: string,
    cost: number | undefined,
    metadata: object,
  ) {
    // Missing usage keeps the full reservation. Never release uncertain billed execution.
    await this.db
      .prepare(
        `UPDATE requests SET state=?,charged_microusd=COALESCE(?,reserved_microusd),metadata=?
   WHERE principal=? AND request_id=? AND claim=? AND state='reserved'`,
      )
      .bind(
        state,
        state === "unknown" ? null : (cost ?? null),
        JSON.stringify(metadata),
        principal,
        id,
        claim,
      )
      .run();
  }
}
