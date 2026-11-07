-- Tables for the new Marie Mikra interface, inside the existing "tfila" D1 database.
-- Every table is prefixed with mm_ so nothing else in that database is touched.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS mm_accounts (
  username          TEXT PRIMARY KEY,          -- Yemot system number
  password_hash     TEXT NOT NULL,             -- interface password (PBKDF2)
  yemot_password    TEXT,                      -- Yemot password, for automatic token renewal (encrypted when MM_SECRET is set)
  yemot_token       TEXT,                      -- current Yemot API token (never sent to the browser)
  token_updated_at  INTEGER,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  failed_since      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mm_sessions (
  id_hash      TEXT PRIMARY KEY,               -- SHA-256 of the session cookie
  username     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS mm_sessions_username ON mm_sessions(username);

CREATE TABLE IF NOT EXISTS mm_grade_history (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  at         INTEGER NOT NULL,
  path       TEXT NOT NULL,
  name       TEXT,
  phone      TEXT,
  school     TEXT,
  old_value  TEXT,
  new_value  TEXT,
  old_line   TEXT NOT NULL,
  new_line   TEXT NOT NULL,
  note       TEXT,
  undone_at  INTEGER
);
CREATE INDEX IF NOT EXISTS mm_grade_history_path ON mm_grade_history(username, path, at);

CREATE TABLE IF NOT EXISTS mm_audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT,
  at        INTEGER NOT NULL,
  ip        TEXT,
  action    TEXT NOT NULL,
  target    TEXT,
  detail    TEXT
);
CREATE INDEX IF NOT EXISTS mm_audit_user_at ON mm_audit(username, at);
