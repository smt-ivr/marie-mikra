// Server side of the new interface (runs in the Cloudflare Worker).
//
// The browser never talks to Yemot directly and never sees the Yemot token:
//   - it signs in here with the system number + an interface password,
//   - gets an HttpOnly session cookie,
//   - and every Yemot call goes through /srv/yemot/<Endpoint>, where the
//     server attaches the stored token (renewing it automatically).
//
// Data lives in the "tfila" D1 database, in tables prefixed with mm_ only.

const YEMOT_DEFAULT = 'https://www.call2all.co.il/ym/api';
const SESSION_DAYS = 30;
const LOCK_AFTER = 8;               // failed logins
const LOCK_WINDOW = 15 * 60 * 1000; // ms
const PBKDF2_ITER = 100000;

// Yemot endpoints the interface is allowed to use through the proxy.
const ALLOWED = new Set([
  'GetTextFile', 'UploadTextFile', 'GetIVR2Dir', 'RenderYMGRFile', 'FileAction', 'UpdateExtension',
  'DownloadFile', 'GetIncomingCalls', 'GetCustomerData', 'MFASession',
  'GetTasks', 'GetTasksData', 'UpdateTask', 'GetTasksLogs', 'TzintukimListManagement', 'RunTzintuk',
]);
const WRITE_ENDPOINTS = new Set(['UploadTextFile', 'FileAction', 'UpdateExtension', 'UpdateTask', 'RunTzintuk']);

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

// Yemot password at rest: AES-GCM with MM_SECRET when that Worker secret exists.
async function secretKey(env) {
  if (!env.MM_SECRET) return null;
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(env.MM_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function sealSecret(env, text) {
  const key = await secretKey(env);
  if (!key) return `plain:${text}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return `enc1:${b64(iv)}:${b64(ct)}`;
}
async function openSecret(env, stored) {
  if (!stored) return null;
  if (stored.startsWith('plain:')) return stored.slice(6);
  if (stored.startsWith('enc1:')) {
    const key = await secretKey(env);
    if (!key) return null;
    const [, iv, ct] = stored.split(':');
    try {
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct)));
    } catch {
      return null;
    }
  }
  return null;
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
function sessionCookie(value, base, maxAge) {
  return `${COOKIE}=${value}; Path=${base || '/'}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
const clientIp = (request) => request.headers.get('cf-connecting-ip') || '';

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try { return await request.json(); } catch { return {}; }
  }
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const fd = await request.formData();
    const o = {};
    for (const [k, v] of fd.entries()) o[k] = typeof v === 'string' ? v : '';
    return o;
  }
  return {};
}

// ---------------------------------------------------------------- schema

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS mm_accounts (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, yemot_password TEXT, yemot_token TEXT, token_updated_at INTEGER, failed_count INTEGER NOT NULL DEFAULT 0, failed_since INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS mm_sessions (id_hash TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER, ip TEXT, user_agent TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS mm_sessions_username ON mm_sessions(username)'),
    db.prepare('CREATE TABLE IF NOT EXISTS mm_grade_history (id TEXT PRIMARY KEY, username TEXT NOT NULL, at INTEGER NOT NULL, path TEXT NOT NULL, name TEXT, phone TEXT, school TEXT, old_value TEXT, new_value TEXT, old_line TEXT NOT NULL, new_line TEXT NOT NULL, note TEXT, undone_at INTEGER)'),
    db.prepare('CREATE INDEX IF NOT EXISTS mm_grade_history_path ON mm_grade_history(username, path, at)'),
    db.prepare('CREATE TABLE IF NOT EXISTS mm_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, at INTEGER NOT NULL, ip TEXT, action TEXT NOT NULL, target TEXT, detail TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS mm_audit_user_at ON mm_audit(username, at)'),
  ]);
  schemaReady = true;
}

// ---------------------------------------------------------------- Yemot

function yemotBase(env) {
  return (env.YEMOT_API || YEMOT_DEFAULT).replace(/\/+$/, '');
}

async function callYemot(env, endpoint, params, method = 'GET') {
  const url = `${yemotBase(env)}/${endpoint}`;
  const clean = {};
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) clean[k] = String(v); });
  if (method === 'POST') {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(clean) });
  }
  return fetch(`${url}?${new URLSearchParams(clean)}`, { headers: { accept: 'application/json' } });
}

async function yemotJson(env, endpoint, params, method) {
  const res = await callYemot(env, endpoint, params, method);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { responseStatus: 'ERROR', message: `תשובה לא תקינה מימות (${res.status})` }; }
}

function looksLikeTokenProblem(data) {
  const m = `${data?.message || ''} ${data?.responseStatus || ''}`;
  return data && data.responseStatus && data.responseStatus !== 'OK' && /token|IS_NOT_LOGGED|not logged|session/i.test(m) && !/MFA/i.test(m);
}

async function yemotLogin(env, username, password) {
  const data = await yemotJson(env, 'Login', { username, password });
  if (data.responseStatus === 'OK' && data.token) return data.token;
  const err = new Error(data.message || 'מספר מערכת או סיסמה שגויים בימות המשיח.');
  err.yemot = true;
  throw err;
}

/** Log in to Yemot again with the stored password and save the new token. */
const renewing = new Map(); // username -> in-flight renewal (requests arriving together share one login)
function renewToken(env, account, staleToken) {
  const key = account.username;
  if (!renewing.has(key)) {
    renewing.set(key, doRenewToken(env, account, staleToken).finally(() => renewing.delete(key)));
  }
  return renewing.get(key).then((t) => { if (t) account.yemot_token = t; return t; });
}
async function doRenewToken(env, account, staleToken) {
  // Another request may have renewed it a moment ago: use that token instead of logging in again.
  if (staleToken) {
    const row = await env.MM_DB.prepare('SELECT yemot_token FROM mm_accounts WHERE username = ?').bind(account.username).first();
    if (row?.yemot_token && row.yemot_token !== staleToken) { account.yemot_token = row.yemot_token; return row.yemot_token; }
  }
  const pw = await openSecret(env, account.yemot_password);
  if (!pw) return null;
  try {
    const token = await yemotLogin(env, account.username, pw);
    await env.MM_DB.prepare('UPDATE mm_accounts SET yemot_token = ?, token_updated_at = ?, updated_at = ? WHERE username = ?')
      .bind(token, now(), now(), account.username).run();
    account.yemot_token = token;
    return token;
  } catch {
    return null;
  }
}

/** Yemot connection status for an account: ok | mfa | relink | error. */
async function yemotStatus(env, account) {
  const reasons = {
    IS_CUSTOMER_AUTH_TOKEN: 'משתמש עם טוקן קבוע', INIT_WHITELIST_IPS: 'כתובת IP ברשימה לבנה',
    INIT_MASTER_LOGIN_WHITELIST_IPS: 'התחברות מאסטר', HAVE_ACTIVE_TRUST_TOKEN: 'מכשיר מוכר',
    INHERITED_FROM_ORIGINAL_SESSION: 'ירושה מסשן קודם', MFA_PASSED: 'בוצע אימות דו-שלבי', SPECIAL_VALID_TOKEN: 'טוקן עם פטור מיוחד',
  };
  let token = account.yemot_token || await renewToken(env, account);
  if (!token) return { status: 'relink', message: 'נדרשת סיסמת ימות המשיח כדי לחדש את החיבור.' };
  let isPass = await yemotJson(env, 'MFASession', { token, action: 'isPass' });
  if (isPass.responseStatus !== 'OK') {
    token = await renewToken(env, account, token);
    if (!token) return { status: 'relink', message: 'החיבור לימות פג, ונדרשת סיסמת ימות המשיח כדי לחדש אותו.' };
    isPass = await yemotJson(env, 'MFASession', { token, action: 'isPass' });
    if (isPass.responseStatus !== 'OK') return { status: 'error', message: isPass.message || 'שגיאה בחיבור לימות המשיח.' };
  }
  if (isPass.isPass) return { status: 'ok', message: reasons[isPass.passReason] || 'מחובר' };
  const tryRes = await yemotJson(env, 'MFASession', { token, action: 'try' });
  if (tryRes.responseStatus === 'OK' && tryRes.isPass) return { status: 'ok', message: reasons[tryRes.passReason] || 'מחובר' };
  return { status: 'mfa', message: 'ימות המשיח דורש אימות דו-שלבי.' };
}

// ---------------------------------------------------------------- sessions

async function getSession(request, env) {
  const raw = cookieValue(request, COOKIE);
  if (!raw) return null;
  const idHash = await sha256(raw);
  const row = await env.MM_DB.prepare(
    'SELECT s.id_hash, s.expires_at, s.last_seen_at, a.* FROM mm_sessions s JOIN mm_accounts a ON a.username = s.username WHERE s.id_hash = ?',
  ).bind(idHash).first();
  if (!row) return null;
  if (row.expires_at < now()) {
    await env.MM_DB.prepare('DELETE FROM mm_sessions WHERE id_hash = ?').bind(idHash).run();
    return null;
  }
  if (!row.last_seen_at || now() - row.last_seen_at > 10 * 60 * 1000) {
    await env.MM_DB.prepare('UPDATE mm_sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?')
      .bind(now(), now() + SESSION_DAYS * 86400000, idHash).run();
  }
  return row;
}

async function createSession(request, env, username, base) {
  const raw = randomToken();
  await env.MM_DB.prepare('INSERT INTO mm_sessions (id_hash, username, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256(raw), username, now(), now() + SESSION_DAYS * 86400000, now(), clientIp(request), (request.headers.get('user-agent') || '').slice(0, 200)).run();
  // occasional cleanup of expired sessions
  await env.MM_DB.prepare('DELETE FROM mm_sessions WHERE expires_at < ?').bind(now()).run();
  return sessionCookie(raw, base, SESSION_DAYS * 86400);
}

async function audit(env, username, request, action, target, detail) {
  try {
    await env.MM_DB.prepare('INSERT INTO mm_audit (username, at, ip, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(username || null, now(), clientIp(request), action, target ? String(target).slice(0, 500) : null, detail ? String(detail).slice(0, 1000) : null).run();
  } catch { /* never block the request on logging */ }
}

const validUsername = (u) => /^\d{5,15}$/.test(String(u || ''));
function passwordProblem(p) {
  if (!p || String(p).length < 6) return 'סיסמת הממשק חייבת להכיל לפחות 6 תווים.';
  if (String(p).length > 200) return 'הסיסמה ארוכה מדי.';
  return null;
}

// ---------------------------------------------------------------- routes

async function routeAuth(action, request, env, ctx, base) {
  const db = env.MM_DB;

  if (action === 'status' && request.method === 'GET') {
    const s = await getSession(request, env);
    if (!s) return json({ ok: true, loggedIn: false });
    const yemot = await yemotStatus(env, s);
    return json({ ok: true, loggedIn: true, username: s.username, yemot, encrypted: !!env.MM_SECRET });
  }

  if (request.method !== 'POST') return fail(405, 'Method not allowed');
  const body = await readBody(request);

  if (action === 'login') {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const account = validUsername(username) ? await db.prepare('SELECT * FROM mm_accounts WHERE username = ?').bind(username).first() : null;
    if (!account) {
      await hashPassword(password || 'x'); // similar timing either way
      return fail(401, 'מספר מערכת או סיסמה שגויים. אם זו הכניסה הראשונה לממשק החדש, בחרו "כניסה ראשונה / שכחתי סיסמה".');
    }
    if (account.failed_count >= LOCK_AFTER && now() - (account.failed_since || 0) < LOCK_WINDOW) {
      const mins = Math.ceil((LOCK_WINDOW - (now() - account.failed_since)) / 60000);
      return fail(429, `יותר מדי ניסיונות שגויים. נסו שוב בעוד ${mins} דקות, או בצעו "כניסה ראשונה / שכחתי סיסמה".`);
    }
    if (!(await verifyPassword(password, account.password_hash))) {
      const fresh = !account.failed_since || now() - account.failed_since > LOCK_WINDOW;
      await db.prepare('UPDATE mm_accounts SET failed_count = ?, failed_since = ? WHERE username = ?')
        .bind(fresh ? 1 : account.failed_count + 1, fresh ? now() : account.failed_since, username).run();
      ctx.waitUntil(audit(env, username, request, 'login-failed'));
      return fail(401, 'מספר מערכת או סיסמה שגויים. אם זו הכניסה הראשונה לממשק החדש, בחרו "כניסה ראשונה / שכחתי סיסמה".');
    }
    await db.prepare('UPDATE mm_accounts SET failed_count = 0, failed_since = NULL WHERE username = ?').bind(username).run();
    const cookie = await createSession(request, env, username, base);
    ctx.waitUntil(audit(env, username, request, 'login'));
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }

  if (action === 'setup') {
    // First sign-in or forgotten password: proven by the Yemot password itself.
    const username = String(body.username || '').trim();
    const yemotPassword = String(body.yemotPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!validUsername(username)) return fail(400, 'מספר מערכת לא תקין.');
    if (!yemotPassword) return fail(400, 'יש להזין את סיסמת הניהול של ימות המשיח.');
    const problem = passwordProblem(newPassword);
    if (problem) return fail(400, problem);
    let token;
    try {
      token = await yemotLogin(env, username, yemotPassword);
    } catch (e) {
      ctx.waitUntil(audit(env, username, request, 'setup-failed', null, e.message));
      return fail(401, `ימות המשיח דחה את הפרטים: ${e.message}`);
    }
    const hash = await hashPassword(newPassword);
    const sealed = await sealSecret(env, yemotPassword);
    const t = now();
    await db.batch([
      db.prepare(`INSERT INTO mm_accounts (username, password_hash, yemot_password, yemot_token, token_updated_at, failed_count, failed_since, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
                  ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, yemot_password = excluded.yemot_password,
                  yemot_token = excluded.yemot_token, token_updated_at = excluded.token_updated_at, failed_count = 0, failed_since = NULL, updated_at = excluded.updated_at`)
        .bind(username, hash, sealed, token, t, t, t),
      // a new password signs out every other device
      db.prepare('DELETE FROM mm_sessions WHERE username = ?').bind(username),
    ]);
    const cookie = await createSession(request, env, username, base);
    ctx.waitUntil(audit(env, username, request, 'setup'));
    return json({ ok: true }, 200, { 'set-cookie': cookie });
  }

  if (action === 'logout') {
    const raw = cookieValue(request, COOKIE);
    if (raw) await db.prepare('DELETE FROM mm_sessions WHERE id_hash = ?').bind(await sha256(raw)).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', base, 0) });
  }

  // ---- the rest needs a session
  const s = await getSession(request, env);
  if (!s) return fail(401, 'יש להתחבר מחדש.', { auth: true });

  if (action === 'password') {
    if (!(await verifyPassword(String(body.current || ''), s.password_hash))) return fail(400, 'הסיסמה הנוכחית שגויה.');
    const problem = passwordProblem(body.next);
    if (problem) return fail(400, problem);
    const rawCurrent = cookieValue(request, COOKIE);
    await db.batch([
      db.prepare('UPDATE mm_accounts SET password_hash = ?, updated_at = ? WHERE username = ?').bind(await hashPassword(String(body.next)), now(), s.username),
      db.prepare('DELETE FROM mm_sessions WHERE username = ? AND id_hash != ?').bind(s.username, await sha256(rawCurrent)),
    ]);
    ctx.waitUntil(audit(env, s.username, request, 'password-changed'));
    return json({ ok: true });
  }

  if (action === 'yemot') {
    const yemotPassword = String(body.yemotPassword || '');
    if (!yemotPassword) return fail(400, 'יש להזין את סיסמת ימות המשיח.');
    let token;
    try { token = await yemotLogin(env, s.username, yemotPassword); } catch (e) { return fail(401, `ימות המשיח דחה את הסיסמה: ${e.message}`); }
    await db.prepare('UPDATE mm_accounts SET yemot_password = ?, yemot_token = ?, token_updated_at = ?, updated_at = ? WHERE username = ?')
      .bind(await sealSecret(env, yemotPassword), token, now(), now(), s.username).run();
    ctx.waitUntil(audit(env, s.username, request, 'yemot-relinked'));
    return json({ ok: true });
  }

  if (action === 'logout-all') {
    await db.prepare('DELETE FROM mm_sessions WHERE username = ?').bind(s.username).run();
    ctx.waitUntil(audit(env, s.username, request, 'logout-all'));
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', base, 0) });
  }

  return fail(404, 'Not found');
}

async function routeHistory(rest, request, env, ctx) {
  const s = await getSession(request, env);
  if (!s) return fail(401, 'יש להתחבר מחדש.', { auth: true });
  const db = env.MM_DB;
  const url = new URL(request.url);

  if (rest === '' && request.method === 'GET') {
    const path = url.searchParams.get('path') || '';
    const { results } = await db.prepare('SELECT * FROM mm_grade_history WHERE username = ? AND path = ? ORDER BY at DESC LIMIT 300')
      .bind(s.username, path).all();
    return json({ ok: true, items: results });
  }
  if (rest === '' && request.method === 'POST') {
    const b = await readBody(request);
    if (!b.path || typeof b.oldLine !== 'string' || typeof b.newLine !== 'string') return fail(400, 'נתונים חסרים');
    const id = randomToken(12);
    await db.prepare(`INSERT INTO mm_grade_history (id, username, at, path, name, phone, school, old_value, new_value, old_line, new_line, note)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, s.username, now(), String(b.path), b.name || null, b.phone || null, b.school || null, b.from ?? null, b.to ?? null,
        b.oldLine, b.newLine, b.note ? String(b.note).slice(0, 300) : null).run();
    return json({ ok: true, id });
  }
  const m = rest.match(/^\/([\w-]+)\/undone$/);
  if (m && request.method === 'POST') {
    await db.prepare('UPDATE mm_grade_history SET undone_at = ? WHERE id = ? AND username = ?').bind(now(), m[1], s.username).run();
    return json({ ok: true });
  }
  return fail(404, 'Not found');
}

async function routeAudit(request, env) {
  const s = await getSession(request, env);
  if (!s) return fail(401, 'יש להתחבר מחדש.', { auth: true });
  const { results } = await env.MM_DB.prepare('SELECT at, ip, action, target, detail FROM mm_audit WHERE username = ? ORDER BY at DESC LIMIT 200')
    .bind(s.username).all();
  return json({ ok: true, items: results });
}

function describeWrite(endpoint, p) {
  switch (endpoint) {
    case 'UploadTextFile': return { target: p.what, detail: `${String(p.contents || '').length} תווים` };
    case 'FileAction': return { target: p.what, detail: `${p.action} → ${p.target || ''}` };
    case 'UpdateExtension': return { target: p.path, detail: Object.keys(p).filter((k) => k !== 'path').map((k) => `${k}=${p[k]}`).join(', ') };
    case 'RunTzintuk': return { target: p.phones, detail: `TimeOut=${p.TzintukTimeOut || ''}` };
    case 'UpdateTask': return { target: `Task ${p.TaskId}`, detail: `active=${p.active ?? ''}` };
    default: return { target: '', detail: '' };
  }
}

async function routeYemot(endpoint, request, env, ctx) {
  if (!ALLOWED.has(endpoint)) return fail(404, 'פעולה לא מורשית');
  const s = await getSession(request, env);
  if (!s) return fail(401, 'יש להתחבר מחדש.', { auth: true });

  const url = new URL(request.url);
  let params;
  let method = 'GET';
  if (request.method === 'POST') { params = await readBody(request); method = 'POST'; }
  else params = Object.fromEntries(url.searchParams);
  delete params.token;

  let token = s.yemot_token || await renewToken(env, s);
  if (!token) return fail(409, 'נדרשת סיסמת ימות המשיח כדי לחדש את החיבור.', { relink: true });

  const send = () => callYemot(env, endpoint, { ...params, token }, method);
  let res;
  try { res = await send(); } catch { return fail(502, 'אין תקשורת עם שרת ימות המשיח.'); }

  const type = res.headers.get('content-type') || '';
  const isJson = type.includes('json') || endpoint !== 'DownloadFile';
  if (!isJson) {
    // file download (audio): stream it as-is
    const headers = new Headers();
    ['content-type', 'content-length', 'content-disposition', 'accept-ranges'].forEach((h) => { const v = res.headers.get(h); if (v) headers.set(h, v); });
    headers.set('cache-control', 'private, max-age=300');
    return new Response(res.body, { status: res.status, headers });
  }

  let text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (data && looksLikeTokenProblem(data)) {
    token = await renewToken(env, s, token);
    if (!token) return fail(409, 'החיבור לימות פג. נדרשת סיסמת ימות המשיח כדי לחדש אותו.', { relink: true });
    res = await send();
    text = await res.text();
    try { data = JSON.parse(text); } catch { data = null; }
  }

  if (WRITE_ENDPOINTS.has(endpoint) || (endpoint === 'TzintukimListManagement' && !/^get/i.test(params.action || ''))) {
    const d = describeWrite(endpoint, params);
    const okFlag = data ? (data.responseStatus === 'OK' || data.success === true) : false;
    ctx.waitUntil(audit(env, s.username, request, `${endpoint}${okFlag ? '' : ' (נכשל)'}`, d.target, d.detail));
  }

  return new Response(text, { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Entry point for /srv/* (path without the /srv prefix). */
export async function handleServer(request, env, ctx, path, base) {
  if (!env.MM_DB) return fail(500, 'מסד הנתונים לא מחובר לשרת (MM_DB).');
  // Simple CSRF guard: our own fetch() calls always send this header.
  // (Audio players can't add headers; DownloadFile is read-only and protected by SameSite=Strict.)
  const isDownload = path === '/yemot/DownloadFile' && request.method === 'GET';
  if (!isDownload && request.headers.get('x-mm-client') !== '1') return fail(403, 'בקשה לא מורשית');
  try {
    await ensureSchema(env.MM_DB);
    if (path.startsWith('/auth/')) return await routeAuth(path.slice(6), request, env, ctx, base);
    if (path === '/history' || path.startsWith('/history/')) return await routeHistory(path.slice(8), request, env, ctx);
    if (path === '/audit') return await routeAudit(request, env);
    if (path.startsWith('/yemot/')) return await routeYemot(path.slice(7), request, env, ctx);
    return fail(404, 'Not found');
  } catch (e) {
    console.error(e);
    return fail(500, 'שגיאת שרת. נסו שוב בעוד רגע.');
  }
}
