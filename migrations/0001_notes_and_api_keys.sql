-- 发布的笔记与 API 密钥。只保存整理后的笔记结构与外观，不保存原文。

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,      -- SHA-256(密钥) 的十六进制，明文密钥不落库
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,                -- 22 位 base64url（128 位随机数），不可枚举
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'unlisted')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  language TEXT NOT NULL,
  template TEXT NOT NULL,
  layout TEXT NOT NULL,
  note_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  stickers_json TEXT NOT NULL,
  doodle_json TEXT,                   -- AI 生成的主插图（已校验的图元），可为空
  image_status TEXT NOT NULL CHECK (image_status IN ('pending', 'ready', 'failed', 'disabled')),
  image_key TEXT,
  image_width INTEGER,
  image_height INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX notes_gallery ON notes (visibility, created_at DESC, id DESC);
CREATE INDEX notes_by_key ON notes (api_key_id, created_at DESC, id DESC);

CREATE TABLE idempotency_keys (
  api_key_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  note_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (api_key_id, idempotency_key)
);
