-- Snapshot contains aggregate report and configured mail addresses, never note content.
-- Keep delivery keys to prevent a sent week from being regenerated.
CREATE TABLE IF NOT EXISTS weekly_report_deliveries (
  period_end INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  accepted_at INTEGER,
  provider_id TEXT
);
