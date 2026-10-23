-- Existing keys already refer to committed notes. Keep them completed, including missing-note tombstones.
ALTER TABLE idempotency_keys ADD COLUMN state TEXT NOT NULL DEFAULT 'completed' CHECK (state IN ('pending', 'completed'));
ALTER TABLE idempotency_keys ADD COLUMN owner_token TEXT;
ALTER TABLE idempotency_keys ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
