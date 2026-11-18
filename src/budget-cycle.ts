export interface MonthlyCycle {
  start_day: number;
  effective_at: string;
  bridge_month: string | null;
}

function boundary(now: Date, day: number, monthOffset = 0) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day),
  ).toISOString();
}

export function monthlyBudgetPeriod(now: Date, cycle: MonthlyCycle | null) {
  const at = now.toISOString();
  const day = cycle?.start_day ?? 1;
  if (cycle?.bridge_month && at < cycle.effective_at) {
    // A caller may have sampled the clock just before the bridge month began.
    if (at.slice(0, 7) < cycle.bridge_month)
      return monthlyBudgetPeriod(now, null);
    return {
      key: cycle.bridge_month,
      start: cycle.bridge_month + "-01T00:00:00.000Z",
      end: cycle.effective_at,
    };
  }
  const offset = at < boundary(now, day) ? -1 : 0;
  const start = boundary(now, day, offset);
  return {
    key: start.slice(0, day === 1 ? 7 : 10),
    start,
    end: boundary(now, day, offset + 1),
  };
}

export function validMonthlyStartDay(day: unknown): day is number {
  return (
    typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 28
  );
}

export function monthlyTransition(now: Date, day: number) {
  return {
    currentMonth: now.toISOString().slice(0, 7),
    nextCalendarBoundary: boundary(now, 1, 1),
    effectiveForExistingLedger: boundary(now, day, 1),
    effectiveForEmptyLedger: monthlyBudgetPeriod(now, {
      start_day: day,
      effective_at: "",
      bridge_month: null,
    }).start,
  };
}
