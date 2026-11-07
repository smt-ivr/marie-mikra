-- Tables for the new Marie Mikra interface, inside the existing "tfila" D1 database.
-- Every table is prefixed with mm_ so nothing else in that database is touched.
-- Safe to run more than once (the server also creates them automatically).

-- Installation settings: token, master password hash, file paths, failed-login counters.
CREATE TABLE IF NOT EXISTS mm_config (
  key    TEXT PRIMARY KEY,   -- token | master_hash | paths | created_at | fail:<ip>
  value  TEXT
);

-- Extra access created by the master: passwords or allowed IP addresses, each with permissions.
CREATE TABLE IF NOT EXISTS mm_access (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,      -- password | ip
  label         TEXT NOT NULL,
  secret_hash   TEXT,               -- PBKDF2 hash (kind = password)
  ips           TEXT,               -- comma separated IPs / IPv4 CIDR ranges
  perms         TEXT NOT NULL,      -- JSON array, e.g. ["tests_view","points_edit"]
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);

-- Signed-in browsers (cookie stored only as a SHA-256 hash).
CREATE TABLE IF NOT EXISTS mm_sessions (
  id_hash      TEXT PRIMARY KEY,
  principal    TEXT NOT NULL,       -- 'master' or mm_access.id
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS mm_sessions_principal ON mm_sessions(principal);

CREATE TABLE IF NOT EXISTS mm_grade_history (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, at INTEGER NOT NULL, path TEXT NOT NULL,
  name TEXT, phone TEXT, school TEXT, old_value TEXT, new_value TEXT,
  old_line TEXT NOT NULL, new_line TEXT NOT NULL, note TEXT, undone_at INTEGER
);
CREATE INDEX IF NOT EXISTS mm_grade_history_path ON mm_grade_history(username, path, at);

CREATE TABLE IF NOT EXISTS mm_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, at INTEGER NOT NULL, ip TEXT,
  action TEXT NOT NULL, target TEXT, detail TEXT
);
CREATE INDEX IF NOT EXISTS mm_audit_user_at ON mm_audit(username, at);
