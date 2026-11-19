// ============================================================
//  schema.js — טבלאות מארי מקרא (קידומת mm_) במסד D1 המשותף tfila
//  אותו מבנה כמו במסכת של שבת. נוצרות / מתעדכנות אוטומטית בבקשה הראשונה.
//  שאר הטבלאות במסד tfila לא נוגעים בהן.
// ============================================================

const MIGRATIONS = [
  {
    version: 1,
    name: 'users_logs_settings',
    sql: [
      // החיבורים של הגרסה הקודמת (מבנה אחר) – מוחלפים. כולם פשוט מתחברים מחדש
      `DROP TABLE IF EXISTS mm_sessions`,
      // משתמשים: שם ומייל; בתוכם סיסמה, כתובות IP והרשאות
      `CREATE TABLE IF NOT EXISTS mm_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_type TEXT NOT NULL DEFAULT 'user',
        username TEXT COLLATE NOCASE,
        email TEXT COLLATE NOCASE,
        password_hash TEXT,
        password_salt TEXT,
        legacy_sha256 TEXT,
        legacy_pbkdf2 TEXT,
        ip TEXT,
        display_name TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        permissions TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        last_used_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS mm_accounts_email ON mm_accounts(email) WHERE email IS NOT NULL AND email != ''`,
      `CREATE UNIQUE INDEX IF NOT EXISTS mm_accounts_password ON mm_accounts(password_hash) WHERE password_hash IS NOT NULL`,

      `CREATE TABLE IF NOT EXISTS mm_user_ips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        ip TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS mm_user_ips_ip ON mm_user_ips(ip)`,

      // חיבורים פעילים (עוגייה). נשמר רק גיבוב של הטוקן
      `CREATE TABLE IF NOT EXISTS mm_sessions (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL,
        ip TEXT,
        method TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,

      // יומן כניסות
      `CREATE TABLE IF NOT EXISTS mm_login_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        success INTEGER NOT NULL,
        method TEXT,
        username TEXT,
        account_id INTEGER,
        ip TEXT,
        user_agent TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS mm_login_log_ip ON mm_login_log(ip, created_at)`,

      // יומן פעולות – כל פעולה במערכת
      `CREATE TABLE IF NOT EXISTS mm_action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        account_id INTEGER,
        account_name TEXT,
        ip TEXT,
        kind TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        details TEXT,
        status TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS mm_action_log_time ON mm_action_log(created_at)`,

      // הגדרות המערכת: טוקן, מפתחות ופרטי מייל – נערכות בדף הניהול
      `CREATE TABLE IF NOT EXISTS mm_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
      )`,

      // יומן שינויי ציונים (הממשק החדש) – נשאר מהגרסה הקודמת
      `CREATE TABLE IF NOT EXISTS mm_grade_history (
        id TEXT PRIMARY KEY, username TEXT NOT NULL, at INTEGER NOT NULL, path TEXT NOT NULL,
        name TEXT, phone TEXT, school TEXT, old_value TEXT, new_value TEXT,
        old_line TEXT NOT NULL, new_line TEXT NOT NULL, note TEXT, undone_at INTEGER
      )`,
      `CREATE INDEX IF NOT EXISTS mm_grade_history_path ON mm_grade_history(username, path, at)`,
    ],
  },
  {
    // "אחר כך" בהצעה ליצור סיסמה – נשמר בחשבון; המנהל יכול לאפס כדי שההצעה תופיע שוב
    version: 3,
    name: 'password_prompt_dismissed',
    sql: [
      `ALTER TABLE mm_accounts ADD COLUMN password_prompt_dismissed TEXT`,
    ],
  },
];

const tableExists = async (env, name) =>
  !!(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first());

const israelTime = (ms) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(new Date(ms || Date.now()));

// העברה חד-פעמית מהגרסה הקודמת (mm_config / mm_access / mm_audit):
// הטוקן → הגדרות; סיסמת המאסטר → משתמש מנהל; כל גישה → משתמש עם אותן הרשאות.
// הסיסמאות הקיימות ממשיכות לעבוד (legacy_pbkdf2) ומומרות בכניסה הראשונה.
async function importPrevious(env) {
  const now = israelTime();
  const stmts = [];
  if (await tableExists(env, 'mm_config')) {
    const { results } = await env.DB.prepare("SELECT key, value FROM mm_config WHERE key IN ('token', 'master_hash', 'paths')").all();
    const c = Object.fromEntries(results.map((r) => [r.key, r.value]));
    if (c.token) {
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO mm_settings (key, value, updated_at) VALUES ('yemot_token', ?, ?)").bind(c.token, now));
    }
    if (c.master_hash) {
      stmts.push(env.DB.prepare(
        "INSERT INTO mm_accounts (display_name, legacy_pbkdf2, is_admin, permissions, active, created_at) VALUES ('מנהל ראשי', ?, 1, '[]', 1, ?)",
      ).bind(c.master_hash, now));
    }
  }
  if (await tableExists(env, 'mm_access')) {
    const { results } = await env.DB.prepare('SELECT * FROM mm_access ORDER BY created_at').all();
    for (const a of results) {
      let perms = [];
      try { perms = JSON.parse(a.perms || '[]'); } catch { perms = []; }
      perms.push('new_site');
      await env.DB.prepare(
        'INSERT INTO mm_accounts (display_name, legacy_pbkdf2, is_admin, permissions, active, created_at) VALUES (?, ?, 0, ?, ?, ?)',
      ).bind(a.label, a.kind === 'password' ? a.secret_hash : null, JSON.stringify([...new Set(perms)]), a.active ? 1 : 0, now).run();
      const id = (await env.DB.prepare('SELECT last_insert_rowid() AS id').first()).id;
      for (const ip of String(a.ips || '').split(/[\s,]+/).filter(Boolean)) {
        if (ip.includes('/')) continue; // טווחים לא נתמכים במבנה החדש
        stmts.push(env.DB.prepare('INSERT OR IGNORE INTO mm_user_ips (account_id, ip, created_at) VALUES (?, ?, ?)').bind(id, ip, now));
      }
    }
  }
  if (await tableExists(env, 'mm_audit')) {
    const { results } = await env.DB.prepare('SELECT * FROM mm_audit ORDER BY at').all();
    for (const r of results) {
      stmts.push(env.DB.prepare(
        "INSERT INTO mm_action_log (created_at, account_name, ip, kind, action, target, details, status) VALUES (?, ?, ?, 'import', ?, ?, ?, 'ok')",
      ).bind(israelTime(r.at), r.username, r.ip, r.action, r.target, r.detail ? JSON.stringify({ פרטים: r.detail }) : null));
    }
  }
  stmts.push(env.DB.prepare('DROP TABLE IF EXISTS mm_config'));
  stmts.push(env.DB.prepare('DROP TABLE IF EXISTS mm_access'));
  stmts.push(env.DB.prepare('DROP TABLE IF EXISTS mm_audit'));
  await env.DB.batch(stmts);
}

let ready = null;

async function run(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS mm_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  ).run();
  const { results } = await env.DB.prepare('SELECT version FROM mm_schema_migrations').all();
  const done = new Set(results.map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await env.DB.batch([
      ...m.sql.map((s) => env.DB.prepare(s)),
      env.DB.prepare('INSERT INTO mm_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').bind(
        m.version, m.name, new Date().toISOString(),
      ),
    ]);
  }
  if (!done.has(2)) {
    // הסימון קודם: אם שתי בקשות מגיעות יחד, רק אחת מבצעת את ההעברה
    let mine = true;
    try {
      await env.DB.prepare('INSERT INTO mm_schema_migrations (version, name, applied_at) VALUES (2, ?, ?)').bind('import_previous_version', new Date().toISOString()).run();
    } catch { mine = false; }
    if (mine) await importPrevious(env);
  }
}

export function ensureSchema(env) {
  if (!ready) ready = run(env).catch((e) => { ready = null; throw e; });
  return ready;
}
