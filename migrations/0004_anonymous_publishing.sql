-- Anonymous agent publishing. Notes published without an API key belong to this reserved owner; its key_hash is not
-- a SHA-256 digest, so no Bearer token can authenticate as it.
INSERT OR IGNORE INTO api_keys (id, name, key_hash, created_at) VALUES ('anonymous', '匿名发布（保留，不能用于认证）', 'reserved:anonymous', 0);
-- One-way hash of the publishing client, used for daily quotas and to scope retries. Null for key-authenticated notes.
ALTER TABLE notes ADD COLUMN client_hash TEXT;
-- SHA-256 of the token returned to an anonymous publisher; it authorizes deleting that note.
ALTER TABLE notes ADD COLUMN manage_token_hash TEXT;
