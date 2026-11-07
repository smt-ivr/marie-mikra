// Server side of the new interface (runs in the Cloudflare Worker).
//
// Model:
//   - First connection: nothing configured yet -> register with the API token and
//     choose a MASTER password. The token is stored here and never sent to browsers.
//   - Sign-in: with a password only. The master password gives full access plus the
//     admin panel. The admin panel lets the master create extra passwords and allowed
//     IP addresses, each limited to chosen areas (permissions).
//   - Every API call goes through /srv/yemot/<Endpoint>; the server checks the
//     caller's permissions for that endpoint/path and attaches the token.
//
// Data lives in the "tfila" D1 database, in tables prefixed with mm_ only.

const API_DEFAULT = 'https://www.call2all.co.il/ym/api';
const SESSION_DAYS = 30;
const LOCK_AFTER = 8;
const LOCK_WINDOW = 15 * 60 * 1000;
const PBKDF2_ITER = 100000;

export const PERMS = [
  'tests_view', 'tests_edit', 'points_view', 'points_edit', 'students_view', 'students_edit',
  'times_view', 'times_edit', 'tzintuk_view', 'tzintuk_edit', 'logs_view',
];

const DEFAULT_PATHS = {
  activeTestPath: 'ivr2:/1/1/1/ExaminationAmericanLogOK.ymgr',
  previousTestsPath: 'ivr2:/מבחנים-קודמים',
};
const IMPORT_SOURCES = ['ivr2:/מבחנים-קודמים', 'ivr2:/מבחנים-קודמים-תשפה'];

const ALLOWED = new Set([
  'GetTextFile', 'UploadTextFile', 'GetIVR2Dir', 'RenderYMGRFile', 'FileAction', 'UpdateExtension',
  'DownloadFile', 'GetIncomingCalls', 'GetCustomerData', 'MFASession',
  'GetTasks', 'GetTasksData', 'UpdateTask', 'GetTasksLogs', 'TzintukimListManagement', 'RunTzintuk',
]);

// ---------------------------------------------------------------- helpers

const now = () => Date.now();
const enc = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
const fail = (status, message, extra = {}) => json({ ok: false, message, ...extra }, status);

function b64(buf) {
  let s = '';
  new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}
function unb64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64(a).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(text) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}
async function verifyPassword(password, stored) {
  const [, , salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const again = await hashPassword(password, salt);
  return timingSafeEqual(again.split('$')[3], hash);
}

function cookieValue(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
const COOKIE = 'mm_session';
const sessionCookie = (value, base, maxAge) => `${COOKIE}=${value}; Path=${base || '/'}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const clientIp = (request) => request.headers.get('cf-connecting-ip') || '';

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) { try { return await request.json(); } catch { return {}; } }
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const fd = await request.formData();
    const o = {};
    for (const [k, v] of fd.entries()) o[k] = typeof v === 'string' ? v : '';
    return o;
  }
  return {};
}

// IPv4 / IPv6 exact match, plus IPv4 CIDR (e.g. 1.2.3.0/24)
function ipv4ToInt(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !(Number.isInteger(x) && x >= 0 && x <= 255))) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function ipMatches(ip, rule) {
  rule = String(rule || '').trim();
  if (!rule || !ip) return false;
  if (rule.includes('/')) {
    const [net, bitsStr] = rule.split('/');
    const bits = Number(bitsStr);
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(net);
    if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }
  return ip.toLowerCase() === rule.toLowerCase();
}
const ipList = (s) => String(s || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
function validIpRule(rule) {
  if (rule.includes('/')) { const [n, b] = rule.split('/'); return ipv4ToInt(n) !== null && Number(b) >= 0 && Number(b) <= 32; }
  return ipv4ToInt(rule) !== null || (/^[0-9a-f:]+$/i.test(rule) && rule.includes(':'));
}

// ---------------------------------------------------------------- schema & config

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS mm_config (key TEXT PRIMARY KEY, value TEXT)'),
    db.prepare('CREATE TABLE IF NOT EXISTS mm_access (id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, secret_hash TEXT, ips TEXT, perms TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_used_at INTEGER)'),
    db.prepare('CREATE TABLE IF NOT EXISTS mm_sessions (id_hash TEXT PRIMARY KEY, principal TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER, ip TEXT, user_agent TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS mm_sessions_principal ON mm_sessions(principal)'),
    db.prepare('CREATE TABLE IF NOT EXISTS mm_grade_history (id TEXT PRIMARY KEY, username TEXT NOT NULL, at INTEGER NOT NULL, path TEXT NOT NULL, name TEXT, phone TEXT, school TEXT, old_value TEXT, new_value TEXT, old_line TEXT NOT NULL, new_line TEXT NOT NULL, note TEXT, undone_at INTEGER)'),
    db.prepare('CREATE INDEX IF NOT EXISTS mm_grade_history_path ON mm_grade_history(username, path, at)'),
    db.prepare('CREATE TABLE IF NOT EXISTS mm_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, at INTEGER NOT NULL, ip TEXT, action TEXT NOT NULL, target TEXT, detail TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS mm_audit_user_at ON mm_audit(username, at)'),
  ]);
  schemaReady = true;
}

async function getConfig(db) {
  const { results } = await db.prepare("SELECT key, value FROM mm_config WHERE key NOT LIKE 'fail:%'").all();
  const c = Object.fromEntries(results.map((r) => [r.key, r.value]));
  let paths = DEFAULT_PATHS;
  try { if (c.paths) paths = { ...DEFAULT_PATHS, ...JSON.parse(c.paths) }; } catch { /* keep defaults */ }
  return { token: c.token || null, masterHash: c.master_hash || null, paths, configured: !!(c.token && c.master_hash) };
}
const setConfig = (db, key, value) => db.prepare('INSERT INTO mm_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);

// ---------------------------------------------------------------- API calls

const apiBase = (env) => (env.YEMOT_API || API_DEFAULT).replace(/\/+$/, '');

async function callApi(env, endpoint, params, method = 'GET') {
  const url = `${apiBase(env)}/${endpoint}`;
  const clean = {};
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) clean[k] = String(v); });
  if (method === 'POST') {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(clean) });
  }
  return fetch(`${url}?${new URLSearchParams(clean)}`, { headers: { accept: 'application/json' } });
}
async function apiJson(env, endpoint, params) {
  try {
    const res = await callApi(env, endpoint, params);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { responseStatus: 'ERROR', offline: true, message: `תשובה לא תקינה מהמערכת (${res.status})` }; }
  } catch {
    return { responseStatus: 'ERROR', offline: true, message: 'אין תקשורת עם המערכת.' };
  }
}

/** Connection state of a token: ok | mfa | expired | error */
async function connectionStatus(env, token) {
  if (!token) return { status: 'expired', message: 'לא הוגדר טוקן.' };
  const isPass = await apiJson(env, 'MFASession', { token, action: 'isPass' });
  if (isPass.responseStatus !== 'OK') {
    return isPass.offline ? { status: 'error', message: isPass.message } : { status: 'expired', message: 'הטוקן אינו תקף או שפג תוקפו.' };
  }
  if (isPass.isPass) return { status: 'ok', message: 'מחובר' };
  const t = await apiJson(env, 'MFASession', { token, action: 'try' });
  if (t.responseStatus === 'OK' && t.isPass) return { status: 'ok', message: 'מחובר' };
  return { status: 'mfa', message: 'נדרש אימות דו-שלבי.' };
}

// ---------------------------------------------------------------- principals & sessions

function principalFromAccess(a, via) {
  let perms = [];
  try { perms = JSON.parse(a.perms || '[]'); } catch { perms = []; }
  return { id: a.id, label: a.label, master: false, perms: perms.filter((p) => PERMS.includes(p)), via };
}
const MASTER = { id: 'master', label: 'מנהל ראשי', master: true, perms: [...PERMS], via: 'password' };

function can(principal, perm) {
  if (!principal) return false;
  if (principal.master) return true;
  if (principal.perms.includes(perm)) return true;
  if (perm.endsWith('_view')) return principal.perms.includes(perm.replace('_view', '_edit'));
  return false;
}

/** Who is making this request: session cookie first, then an allowed IP. */
async function getPrincipal(request, env) {
  const db = env.MM_DB;
  const raw = cookieValue(request, COOKIE);
  if (raw) {
    const idHash = await sha256(raw);
    const s = await db.prepare('SELECT * FROM mm_sessions WHERE id_hash = ?').bind(idHash).first();
    if (s && s.expires_at > now()) {
      let p = null;
      if (s.principal === 'master') p = { ...MASTER };
      else {
        const a = await db.prepare('SELECT * FROM mm_access WHERE id = ? AND active = 1').bind(s.principal).first();
        if (a && (!a.ips || ipList(a.ips).some((r) => ipMatches(clientIp(request), r)))) p = principalFromAccess(a, 'password');
      }
      if (p) {
        if (!s.last_seen_at || now() - s.last_seen_at > 10 * 60 * 1000) {
          await db.prepare('UPDATE mm_sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').bind(now(), now() + SESSION_DAYS * 86400000, idHash).run();
        }
        p.sessionHash = idHash;
        return p;
      }
    }
  }
  const ip = clientIp(request);
  if (ip) {
    const { results } = await db.prepare("SELECT * FROM mm_access WHERE kind = 'ip' AND active = 1").all();
    const a = results.find((r) => ipList(r.ips).some((rule) => ipMatches(ip, rule)));
    if (a) return principalFromAccess(a, 'ip');
  }
  return null;
}

async function createSession(request, env, principalId, base) {
  const raw = randomToken();
  await env.MM_DB.prepare('INSERT INTO mm_sessions (id_hash, principal, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256(raw), principalId, now(), now() + SESSION_DAYS * 86400000, now(), clientIp(request), (request.headers.get('user-agent') || '').slice(0, 200)).run();
  await env.MM_DB.prepare('DELETE FROM mm_sessions WHERE expires_at < ?').bind(now()).run();
  return sessionCookie(raw, base, SESSION_DAYS * 86400);
}

async function audit(env, principal, request, action, target, detail) {
  try {
    await env.MM_DB.prepare('INSERT INTO mm_audit (username, at, ip, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(principal ? principal.label : null, now(), clientIp(request), action, target ? String(target).slice(0, 500) : null, detail ? String(detail).slice(0, 1000) : null).run();
  } catch { /* never block on logging */ }
}

function passwordProblem(p) {
  if (!p || String(p).length < 6) return 'הסיסמה חייבת להכיל לפחות 6 תווים.';
  if (String(p).length > 200) return 'הסיסמה ארוכה מדי.';
  return null;
}

// Failed sign-in counter per IP (stored in mm_config as fail:<ip>)
async function lockState(db, ip) {
  const row = await db.prepare('SELECT value FROM mm_config WHERE key = ?').bind(`fail:${ip}`).first();
  let st = { count: 0, since: 0 };
  try { if (row) st = JSON.parse(row.value); } catch { /* ignore */ }
  if (now() - st.since > LOCK_WINDOW) st = { count: 0, since: now() };
  return st;
}

// ---------------------------------------------------------------- permission check for API calls

function norm(p) {
  return (String(p || '').replace(/^ivr2:\/?/i, '/').replace(/\/+$/, '') || '/').replace(/\/{2,}/g, '/');
}
const parentOf = (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i > 0 ? n.slice(0, i) : '/'; };
const within = (p, base) => { const a = norm(p); const b = norm(base); return a === b || a.startsWith(`${b}/`); };

function areaOf(path, cfg) {
  if (!path) return null;
  const p = norm(path);
  if (p.includes('..')) return null;
  if (within(p, '/1/1') || within(p, parentOf(cfg.paths.activeTestPath)) || within(p, cfg.paths.previousTestsPath)
      || IMPORT_SOURCES.some((s) => within(p, s))) return 'tests';
  if (within(p, '/Points')) return 'points';
  if (within(p, '/EnterID')) return 'students';
  if (p === '/ext.ini') return 'times';
  if (within(p, '/Log')) return 'logs';
  return null;
}

/** Returns null when allowed, or an error message. */
function checkApiPermission(principal, endpoint, params, cfg) {
  if (principal.master) return null;
  if (['GetIncomingCalls', 'GetCustomerData', 'MFASession'].includes(endpoint)) return null;
  const deny = 'אין לכם הרשאה לפעולה זו.';
  if (['GetTasks', 'GetTasksData', 'GetTasksLogs'].includes(endpoint)) return can(principal, 'tzintuk_view') ? null : deny;
  if (endpoint === 'TzintukimListManagement') return can(principal, /^get/i.test(params.action || '') ? 'tzintuk_view' : 'tzintuk_edit') ? null : deny;
  if (['UpdateTask', 'RunTzintuk'].includes(endpoint)) return can(principal, 'tzintuk_edit') ? null : deny;

  const need = (path, mode) => {
    const area = areaOf(path, cfg);
    return area ? can(principal, `${area}_${mode}`) : false;
  };
  switch (endpoint) {
    case 'GetTextFile': return need(params.what, 'view') ? null : deny;
    case 'RenderYMGRFile': return need(params.wath, 'view') ? null : deny;
    case 'GetIVR2Dir': return need(params.path, 'view') ? null : deny;
    case 'DownloadFile': return need(params.path, 'view') ? null : deny;
    case 'UploadTextFile': return need(params.what, 'edit') ? null : deny;
    case 'UpdateExtension': return need(params.path, 'edit') ? null : deny;
    case 'FileAction': return need(params.what, 'edit') && need(params.target, 'edit') ? null : deny;
    default: return deny;
  }
}

function describeWrite(endpoint, p) {
  switch (endpoint) {
    case 'UploadTextFile': return { target: p.what, detail: `${String(p.contents || '').length} תווים` };
    case 'FileAction': return { target: p.what, detail: `${p.action} → ${p.target || ''}` };
    case 'UpdateExtension': return { target: p.path, detail: Object.keys(p).filter((k) => k !== 'path').map((k) => `${k}=${p[k]}`).join(', ') };
    case 'RunTzintuk': return { target: p.phones, detail: `TimeOut=${p.TzintukTimeOut || ''}` };
    case 'UpdateTask': return { target: `Task ${p.TaskId}`, detail: `active=${p.active ?? ''}` };
    case 'TzintukimListManagement': return { target: `List ${p.TzintukimList || ''}`, detail: p.action };
    default: return { target: '', detail: '' };
  }
}
const isWrite = (endpoint, p) => ['UploadTextFile', 'FileAction', 'UpdateExtension', 'UpdateTask', 'RunTzintuk'].includes(endpoint)
  || (endpoint === 'TzintukimListManagement' && !/^get/i.test(p.action || ''));

// ---------------------------------------------------------------- routes

const publicPrincipal = (p) => ({ label: p.label, master: p.master, perms: p.master ? [...PERMS] : p.perms, via: p.via });

async function routeAuth(action, request, env, ctx, base) {
  const db = env.MM_DB;
  const cfg = await getConfig(db);

  if (action === 'status' && request.method === 'GET') {
    if (!cfg.configured) return json({ ok: true, configured: false });
    const p = await getPrincipal(request, env);
    if (!p) return json({ ok: true, configured: true, loggedIn: false });
    const connection = await connectionStatus(env, cfg.token);
    return json({ ok: true, configured: true, loggedIn: true, principal: publicPrincipal(p), paths: cfg.paths, connection });
  }
  if (request.method !== 'POST') return fail(405, 'Method not allowed');
  const body = await readBody(request);

  if (action === 'setup') {
    if (cfg.configured) return fail(409, 'המערכת כבר הוגדרה. יש להתחבר עם הסיסמה.');
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    if (!token) return fail(400, 'יש להזין טוקן.');
    const problem = passwordProblem(password);
    if (problem) return fail(400, problem);
    const st = await connectionStatus(env, token);
    if (st.status === 'expired' || st.status === 'error') return fail(400, `הטוקן לא התקבל: ${st.message}`);
    await db.batch([
      setConfig(db, 'token', token),
      setConfig(db, 'master_hash', await hashPassword(password)),
      setConfig(db, 'created_at', String(now())),
    ]);
    const cookie = await createSession(request, env, 'master', base);
    ctx.waitUntil(audit(env, MASTER, request, 'setup'));
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }

  if (action === 'login') {
    if (!cfg.configured) return fail(409, 'המערכת עדיין לא הוגדרה.');
    const ip = clientIp(request);
    const lock = await lockState(db, ip);
    if (lock.count >= LOCK_AFTER) {
      const mins = Math.ceil((LOCK_WINDOW - (now() - lock.since)) / 60000);
      return fail(429, `יותר מדי ניסיונות שגויים. נסו שוב בעוד ${mins} דקות.`);
    }
    const password = String(body.password || '');
    let principal = null;
    if (await verifyPassword(password, cfg.masterHash)) principal = { ...MASTER };
    else {
      const { results } = await db.prepare("SELECT * FROM mm_access WHERE kind = 'password' AND active = 1").all();
      for (const a of results) {
        if (await verifyPassword(password, a.secret_hash)) {
          if (a.ips && !ipList(a.ips).some((r) => ipMatches(ip, r))) {
            ctx.waitUntil(audit(env, { label: a.label }, request, 'login-blocked-ip'));
            return fail(403, 'סיסמה זו אינה מורשית מהמיקום הנוכחי.');
          }
          principal = principalFromAccess(a, 'password');
          await db.prepare('UPDATE mm_access SET last_used_at = ? WHERE id = ?').bind(now(), a.id).run();
          break;
        }
      }
    }
    if (!principal) {
      await setConfig(db, `fail:${ip}`, JSON.stringify({ count: lock.count + 1, since: lock.since })).run();
      ctx.waitUntil(audit(env, null, request, 'login-failed'));
      return fail(401, 'סיסמה שגויה.');
    }
    await db.prepare('DELETE FROM mm_config WHERE key = ?').bind(`fail:${ip}`).run();
    const cookie = await createSession(request, env, principal.id, base);
    ctx.waitUntil(audit(env, principal, request, 'login'));
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }

  if (action === 'logout') {
    const raw = cookieValue(request, COOKIE);
    if (raw) await db.prepare('DELETE FROM mm_sessions WHERE id_hash = ?').bind(await sha256(raw)).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', base, 0) });
  }
  return fail(404, 'Not found');
}

function cleanPerms(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((p) => PERMS.includes(p)))];
}
function accessView(a) {
  let perms = [];
  try { perms = cleanPerms(JSON.parse(a.perms || '[]')); } catch { perms = []; }
  return { id: a.id, kind: a.kind, label: a.label, ips: a.ips || '', perms, active: !!a.active, createdAt: a.created_at, lastUsedAt: a.last_used_at };
}

async function routeAdmin(rest, request, env, ctx, base) {
  const db = env.MM_DB;
  const p = await getPrincipal(request, env);
  if (!p) return fail(401, 'יש להתחבר מחדש.', { auth: true });
  if (!p.master) return fail(403, 'רק מנהל ראשי (סיסמת מאסטר) יכול להיכנס לניהול.');
  const cfg = await getConfig(db);

  if (rest === '/state' && request.method === 'GET') {
    const { results } = await db.prepare('SELECT * FROM mm_access ORDER BY created_at').all();
    const connection = await connectionStatus(env, cfg.token);
    const tok = cfg.token || '';
    return json({
      ok: true, access: results.map(accessView), paths: cfg.paths, perms: PERMS, connection,
      tokenPreview: tok ? `${tok.slice(0, 3)}…${tok.slice(-4)}` : '', yourIp: clientIp(request),
    });
  }
  if (request.method !== 'POST') return fail(405, 'Method not allowed');
  const body = await readBody(request);

  if (rest === '/token') {
    const token = String(body.token || '').trim();
    if (!token) return fail(400, 'יש להזין טוקן.');
    const st = await connectionStatus(env, token);
    if (st.status === 'expired' || st.status === 'error') return fail(400, `הטוקן לא התקבל: ${st.message}`);
    await setConfig(db, 'token', token).run();
    ctx.waitUntil(audit(env, p, request, 'token-replaced'));
    return json({ ok: true, connection: st });
  }
  if (rest === '/master') {
    if (!(await verifyPassword(String(body.current || ''), cfg.masterHash))) return fail(400, 'סיסמת המאסטר הנוכחית שגויה.');
    const problem = passwordProblem(body.next);
    if (problem) return fail(400, problem);
    await db.batch([
      setConfig(db, 'master_hash', await hashPassword(String(body.next))),
      db.prepare("DELETE FROM mm_sessions WHERE principal = 'master' AND id_hash != ?").bind(p.sessionHash || ''),
    ]);
    ctx.waitUntil(audit(env, p, request, 'master-changed'));
    return json({ ok: true });
  }
  if (rest === '/paths') {
    const paths = {
      activeTestPath: String(body.activeTestPath || '').trim() || DEFAULT_PATHS.activeTestPath,
      previousTestsPath: String(body.previousTestsPath || '').trim() || DEFAULT_PATHS.previousTestsPath,
    };
    await setConfig(db, 'paths', JSON.stringify(paths)).run();
    ctx.waitUntil(audit(env, p, request, 'paths-changed', null, JSON.stringify(paths)));
    return json({ ok: true, paths });
  }
  if (rest === '/logout-all') {
    await db.prepare('DELETE FROM mm_sessions').run();
    ctx.waitUntil(audit(env, p, request, 'logout-all'));
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', base, 0) });
  }

  // ---- access entries (passwords / IP addresses)
  const validate = async (b, existing) => {
    const kind = existing ? existing.kind : b.kind;
    if (!['password', 'ip'].includes(kind)) return { error: 'סוג גישה לא תקין.' };
    const label = String(b.label ?? existing?.label ?? '').trim().slice(0, 80);
    if (!label) return { error: 'יש לתת שם לגישה.' };
    const ips = b.ips !== undefined ? ipList(b.ips).join(', ') : (existing?.ips || '');
    const bad = ipList(ips).find((r) => !validIpRule(r));
    if (bad) return { error: `כתובת IP לא תקינה: ${bad}` };
    if (kind === 'ip' && !ips) return { error: 'יש להזין לפחות כתובת IP אחת.' };
    let existingPerms = [];
    try { existingPerms = JSON.parse(existing?.perms || '[]'); } catch { existingPerms = []; }
    const perms = b.perms !== undefined ? cleanPerms(b.perms) : cleanPerms(existingPerms);
    if (!perms.length) return { error: 'יש לבחור לפחות הרשאה אחת.' };
    let secretHash = existing?.secret_hash || null;
    if (kind === 'password' && (b.password || !existing)) {
      const problem = passwordProblem(b.password);
      if (problem) return { error: problem };
      if (await verifyPassword(String(b.password), cfg.masterHash)) return { error: 'הסיסמה זהה לסיסמת המאסטר. בחרו סיסמה אחרת.' };
      const { results } = await db.prepare("SELECT id, secret_hash FROM mm_access WHERE kind = 'password'").all();
      for (const r of results) {
        if (r.id !== existing?.id && await verifyPassword(String(b.password), r.secret_hash)) return { error: 'סיסמה זו כבר בשימוש בגישה אחרת.' };
      }
      secretHash = await hashPassword(String(b.password));
    }
    return { kind, label, ips, perms, secretHash, active: b.active !== undefined ? (b.active ? 1 : 0) : (existing ? existing.active : 1) };
  };

  if (rest === '/access') {
    const v = await validate(body, null);
    if (v.error) return fail(400, v.error);
    const id = randomToken(9);
    await db.prepare('INSERT INTO mm_access (id, kind, label, secret_hash, ips, perms, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, v.kind, v.label, v.secretHash, v.ips || null, JSON.stringify(v.perms), v.active, now()).run();
    ctx.waitUntil(audit(env, p, request, 'access-created', v.label, `${v.kind}; ${v.perms.join(',')}${v.ips ? `; ${v.ips}` : ''}`));
    return json({ ok: true, id });
  }
  const m = rest.match(/^\/access\/([\w-]+)(\/delete)?$/);
  if (m) {
    const existing = await db.prepare('SELECT * FROM mm_access WHERE id = ?').bind(m[1]).first();
    if (!existing) return fail(404, 'הגישה לא נמצאה.');
    if (m[2]) {
      await db.batch([
        db.prepare('DELETE FROM mm_access WHERE id = ?').bind(m[1]),
        db.prepare('DELETE FROM mm_sessions WHERE principal = ?').bind(m[1]),
      ]);
      ctx.waitUntil(audit(env, p, request, 'access-deleted', existing.label));
      return json({ ok: true });
    }
    const v = await validate(body, existing);
    if (v.error) return fail(400, v.error);
    const stmts = [db.prepare('UPDATE mm_access SET label = ?, secret_hash = ?, ips = ?, perms = ?, active = ? WHERE id = ?')
      .bind(v.label, v.secretHash, v.ips || null, JSON.stringify(v.perms), v.active, m[1])];
    if (!v.active || body.password) stmts.push(db.prepare('DELETE FROM mm_sessions WHERE principal = ?').bind(m[1]));
    await db.batch(stmts);
    ctx.waitUntil(audit(env, p, request, 'access-updated', v.label, `${v.active ? 'פעיל' : 'מושבת'}; ${v.perms.join(',')}`));
    return json({ ok: true });
  }
  return fail(404, 'Not found');
}

async function routeHistory(rest, request, env) {
  const p = await getPrincipal(request, env);
  if (!p) return fail(401, 'יש להתחבר מחדש.', { auth: true });
  const db = env.MM_DB;
  const url = new URL(request.url);
  if (rest === '' && request.method === 'GET') {
    if (!can(p, 'tests_view')) return fail(403, 'אין הרשאה.');
    const { results } = await db.prepare('SELECT * FROM mm_grade_history WHERE path = ? ORDER BY at DESC LIMIT 300').bind(url.searchParams.get('path') || '').all();
    return json({ ok: true, items: results });
  }
  if (!can(p, 'tests_edit')) return fail(403, 'אין הרשאה לעריכת ציונים.');
  if (rest === '' && request.method === 'POST') {
    const b = await readBody(request);
    if (!b.path || typeof b.oldLine !== 'string' || typeof b.newLine !== 'string') return fail(400, 'נתונים חסרים');
    const id = randomToken(12);
    await db.prepare(`INSERT INTO mm_grade_history (id, username, at, path, name, phone, school, old_value, new_value, old_line, new_line, note)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, p.label, now(), String(b.path), b.name || null, b.phone || null, b.school || null, b.from ?? null, b.to ?? null,
        b.oldLine, b.newLine, b.note ? String(b.note).slice(0, 300) : null).run();
    return json({ ok: true, id });
  }
  const m = rest.match(/^\/([\w-]+)\/undone$/);
  if (m && request.method === 'POST') {
    await db.prepare('UPDATE mm_grade_history SET undone_at = ? WHERE id = ?').bind(now(), m[1]).run();
    return json({ ok: true });
  }
  return fail(404, 'Not found');
}

async function routeAudit(request, env) {
  const p = await getPrincipal(request, env);
  if (!p) return fail(401, 'יש להתחבר מחדש.', { auth: true });
  if (!p.master) return fail(403, 'רק מנהל ראשי יכול לצפות ביומן.');
  const { results } = await env.MM_DB.prepare('SELECT username, at, ip, action, target, detail FROM mm_audit ORDER BY at DESC LIMIT 300').all();
  return json({ ok: true, items: results });
}

async function routeApi(endpoint, request, env, ctx) {
  if (!ALLOWED.has(endpoint)) return fail(404, 'פעולה לא מורשית');
  const p = await getPrincipal(request, env);
  if (!p) return fail(401, 'יש להתחבר מחדש.', { auth: true });
  const cfg = await getConfig(env.MM_DB);
  if (!cfg.token) return fail(409, 'לא הוגדר טוקן. מנהל ראשי צריך להזין טוקן בניהול.', { relink: true });

  const url = new URL(request.url);
  let params;
  let method = 'GET';
  if (request.method === 'POST') { params = await readBody(request); method = 'POST'; } else params = Object.fromEntries(url.searchParams);
  delete params.token;

  const denied = checkApiPermission(p, endpoint, params, cfg);
  if (denied) return fail(403, denied, { forbidden: true });

  let res;
  try { res = await callApi(env, endpoint, { ...params, token: cfg.token }, method); } catch { return fail(502, 'אין תקשורת עם המערכת.'); }

  const type = res.headers.get('content-type') || '';
  if (endpoint === 'DownloadFile' && !type.includes('json')) {
    const headers = new Headers();
    ['content-type', 'content-length', 'content-disposition', 'accept-ranges'].forEach((h) => { const v = res.headers.get(h); if (v) headers.set(h, v); });
    headers.set('cache-control', 'private, max-age=300');
    return new Response(res.body, { status: res.status, headers });
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not json */ }

  if (data && data.responseStatus && data.responseStatus !== 'OK'
      && /token|IS_NOT_LOGGED|not logged|session/i.test(`${data.message} ${data.responseStatus}`) && !/MFA/i.test(data.message || '')) {
    return fail(409, p.master ? 'הטוקן אינו תקף או שפג תוקפו. יש להזין טוקן חדש בניהול.' : 'החיבור למערכת פג. פנו למנהל הראשי.', { relink: true });
  }
  if (isWrite(endpoint, params)) {
    const d = describeWrite(endpoint, params);
    const okFlag = data ? (data.responseStatus === 'OK' || data.success === true) : false;
    ctx.waitUntil(audit(env, p, request, `${endpoint}${okFlag ? '' : ' (נכשל)'}`, d.target, d.detail));
  }
  return new Response(text, { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Entry point for /srv/* (path without the /srv prefix). */
export async function handleServer(request, env, ctx, path, base) {
  if (!env.MM_DB) return fail(500, 'מסד הנתונים לא מחובר לשרת (MM_DB).');
  const isDownload = path === '/yemot/DownloadFile' && request.method === 'GET';
  if (!isDownload && request.headers.get('x-mm-client') !== '1') return fail(403, 'בקשה לא מורשית');
  try {
    await ensureSchema(env.MM_DB);
    if (path.startsWith('/auth/')) return await routeAuth(path.slice(6), request, env, ctx, base);
    if (path.startsWith('/admin/')) return await routeAdmin(path.slice(6), request, env, ctx, base);
    if (path === '/history' || path.startsWith('/history/')) return await routeHistory(path.slice(8), request, env);
    if (path === '/audit') return await routeAudit(request, env);
    if (path.startsWith('/yemot/')) return await routeApi(path.slice(7), request, env, ctx);
    return fail(404, 'Not found');
  } catch (e) {
    console.error(e);
    return fail(500, 'שגיאת שרת. נסו שוב בעוד רגע.');
  }
}
