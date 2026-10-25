-- Run with Wrangler D1 execute --file. Server receipt timestamps, UTC, last 7 days.
-- Counts are observed creations, NOT unique people. Include only own-content cohorts.
WITH cohort AS (
  SELECT creation_id, MAX(is_first) AS is_first
  FROM creation_events
  WHERE name = 'creation_started' AND source = 'own'
    AND received_at >= (unixepoch('now') - 7 * 86400) * 1000
  GROUP BY creation_id
), funnel AS (
  SELECT c.creation_id, c.is_first,
    MAX(e.name = 'generation_started') AS attempted,
    MAX(e.name = 'generation_completed') AS generated,
    MAX(e.name = 'note_ready') AS ready,
    MAX(e.name IN ('library_save_completed', 'export_completed', 'share_completed')) AS saved_or_exported,
    MAX(e.name = 'generation_cancelled') AS cancelled
  FROM cohort c JOIN creation_events e USING (creation_id)
  GROUP BY c.creation_id, c.is_first
)
SELECT is_first, COUNT(*) AS creations, SUM(attempted) AS attempted,
  SUM(generated) AS generated, SUM(ready) AS ready,
  SUM(saved_or_exported) AS saved_or_exported, SUM(cancelled) AS cancelled
FROM funnel GROUP BY is_first;

SELECT name, json_extract(payload, '$.code') AS error_code, COUNT(*) AS events
FROM creation_events
WHERE source = 'own' AND name LIKE '%failed'
  AND received_at >= (unixepoch('now') - 7 * 86400) * 1000
GROUP BY name, error_code ORDER BY events DESC;

WITH durations AS (
  SELECT json_extract(payload, '$.durationMs') AS ms,
    ROW_NUMBER() OVER (ORDER BY json_extract(payload, '$.durationMs')) AS rank,
    COUNT(*) OVER () AS total
  FROM creation_events
  WHERE source = 'own' AND name = 'generation_completed'
    AND json_extract(payload, '$.mode') = 'ai'
    AND received_at >= (unixepoch('now') - 7 * 86400) * 1000
)
SELECT COUNT(*) AS completed_ai_attempts,
  MAX(CASE WHEN rank = (total + 1) / 2 THEN ms END) AS median_ms,
  MAX(CASE WHEN rank = (total * 95 + 99) / 100 THEN ms END) AS p95_ms
FROM durations;
