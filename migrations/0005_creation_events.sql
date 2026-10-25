-- No note content, filename, URL, IP or persistent visitor ID.
CREATE TABLE creation_events (
  event_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  creation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  is_first INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX creation_events_received ON creation_events(received_at);
CREATE INDEX creation_events_creation ON creation_events(creation_id);
