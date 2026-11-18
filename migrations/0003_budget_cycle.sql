-- A one-time transition that preserves the currently funded calendar period.
CREATE TABLE monthly_budget_cycle (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 start_day INTEGER NOT NULL CHECK (start_day BETWEEN 2 AND 28),
 effective_at TEXT NOT NULL,
 bridge_month TEXT
);
ALTER TABLE requests ADD COLUMN monthly_cycle_day INTEGER;

-- Older processes omit the marker. Reject their new reservations after activation
-- is scheduled, including legacy writers that already have the database open.
CREATE TRIGGER requests_monthly_cycle_guard
BEFORE INSERT ON requests
WHEN EXISTS (SELECT 1 FROM monthly_budget_cycle WHERE id=1
             AND NEW.monthly_cycle_day IS NOT start_day)
BEGIN
 SELECT RAISE(ABORT, 'budget_schedule_changed');
END;
