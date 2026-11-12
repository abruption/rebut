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
export class Ledger {
  constructor(private db: D1Database) {}
  async get(principal: string, id: string): Promise<LedgerRow | null> {
    return this.db
      .prepare("SELECT * FROM requests WHERE principal=? AND request_id=?")
      .bind(principal, id)
      .first<LedgerRow>();
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
  ) {
    const claim = crypto.randomUUID(),
      date = now.toISOString(),
      day = date.slice(0, 10),
      month = date.slice(0, 7);
    // One SQLite write statement: check aggregate budgets and insert under the same write lock.
    // Limits are deployment-wide, so adding principals cannot multiply the allowed spend.
    await this.db
      .prepare(
        `INSERT INTO requests
   (principal,request_id,fingerprint,input_sha256,profile,claim,created_at,day,month,state,reserved_microusd,charged_microusd)
   SELECT ?,?,?,?,?,?,?,?,?,'reserved',?,?
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
    const row = await this.get(principal, id);
    if (!row) return { status: "limit_exceeded" as const };
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
