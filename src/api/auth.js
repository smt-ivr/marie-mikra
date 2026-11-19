// ============================================================
//  auth.js — כניסה למערכת והרשאות (כמו במסכת של שבת)
//  POST /auth/login   { password }            — סיסמה בלבד (כמו אסיפה, בלי שם משתמש)
//                     בלי פרטים: כניסה אוטומטית לפי IP מורשה
//  POST /auth/google  { credential }           — כניסה עם Google לפי המייל
//  POST /auth/logout
//  GET  /auth/me                               — המשתמש המחובר
//  GET  /auth/options                          — מזהה Google למסך הכניסה, והאם נדרשת הגדרה ראשונית
//  POST /auth/setup   { token, password }     — הגדרה ראשונית (רק כשאין עדיין אף משתמש)
//  החיבור נשמר בעוגייה מאובטחת (HttpOnly) ל-30 יום – הדפדפן לא שומר טוקנים.
// ============================================================
import { ApiError, unauthorized, forbidden, badRequest, readJson, str, clientIp, israelNow, json } from './http.js';
import { getConfig, clearSettingsCache } from './settings.js';
import { logAction } from './audit.js';
import { permissionsOf, requirePermission } from './permissions.js';

// כתובת ה-API (בבדיקות מקומיות אפשר להחליף עם YEMOT_API)
export const yemotBase = (env) => `${String(env.YEMOT_API || 'https://www.call2all.co.il/ym/api').replace(/\/+$/, '')}/`;

const SESSION_DAYS = 30;
const MAX_FAILS = 8; // ניסיונות כושלים מאותה כתובת ברבע שעה
const ITERATIONS = 100000;
const COOKIE = 'mm_session';

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const randomToken = () =>
  b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt = b64(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS },
    key,
    256,
  );
  return { hash: b64(bits), salt };
}

// מלח אחיד למערכת (נוצר פעם אחת ונשמר במסד). כך הסיסמה לבדה מאתרת את המשתמש בשאילתה אחת
async function systemSalt(env) {
  const row = await env.DB.prepare("SELECT value FROM mm_settings WHERE key = 'auth_salt'").first();
  if (row && row.value) return row.value;
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.prepare("INSERT OR IGNORE INTO mm_settings (key, value, updated_at) VALUES ('auth_salt', ?, ?)").bind(salt, israelNow()).run();
  return (await env.DB.prepare("SELECT value FROM mm_settings WHERE key = 'auth_salt'").first()).value;
}

export async function passwordKey(env, password) {
  return (await hashPassword(password, await systemSalt(env))).hash;
}

function sameHash(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();

// method: איך נכנסו בחיבור הזה – password / ip / google
export function publicAccount(a, method = a.s_method || null) {
  return {
    id: a.id,
    method,
    name: a.display_name,
    email: a.email || null,
    is_admin: !!a.is_admin,
    permissions: permissionsOf(a),
    has_password: !!(a.password_hash || a.legacy_sha256 || a.legacy_pbkdf2),
    // לחץ "אחר כך" בהצעה ליצור סיסמה (המנהל יכול לאפס)
    password_prompt_dismissed: !!a.password_prompt_dismissed,
  };
}

async function loginLog(env, request, { success, method, username, accountId }) {
  try {
    await env.DB.prepare(
      'INSERT INTO mm_login_log (created_at, success, method, username, account_id, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(israelNow(), success ? 1 : 0, method, username || null, accountId || null, clientIp(request),
        (request.headers.get('user-agent') || '').slice(0, 300))
      .run();
  } catch (e) {
    console.error('login log failed:', e);
  }
}

async function checkRateLimit(env, request) {
  const since = israelNowMinus(15);
  const fails = await env.DB.prepare('SELECT COUNT(*) n FROM mm_login_log WHERE ip = ? AND success = 0 AND created_at > ?')
    .bind(clientIp(request), since)
    .first();
  if (fails.n >= MAX_FAILS) throw new ApiError(429, 'too_many_attempts', 'יותר מדי ניסיונות כניסה שגויים. נסו שוב בעוד רבע שעה');
}

function israelNowMinus(minutes) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(Date.now() - minutes * 60000));
}

function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/marie-mikra; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readCookie(request) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
}

async function openSession(env, request, account, method) {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO mm_sessions (token_hash, account_id, ip, method, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      await sha256Hex(token), account.id, clientIp(request), method,
      new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(), israelNow(),
    ),
    env.DB.prepare('UPDATE mm_accounts SET last_used_at = ? WHERE id = ?').bind(israelNow(), account.id),
    env.DB.prepare('DELETE FROM mm_sessions WHERE expires_at < ?').bind(new Date().toISOString()),
  ]);
  return json({ authorized: true, user: publicAccount(account, method) }, 200, {
    'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400),
  });
}

// סיסמה בפורמט של הגרסה הקודמת: pbkdf2$<iterations>$<salt base64>$<hash base64>
async function matchesOldPbkdf2(password, stored) {
  const [, iter, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: Number(iter) || ITERATIONS }, key, 256);
  return sameHash(b64(bits), hash);
}

// איתור משתמש לפי סיסמה. משתמש שהועבר מהגרסה הקודמת משודרג אוטומטית בכניסה הראשונה
async function findByPassword(env, password) {
  const key = await passwordKey(env, password);
  const a = await env.DB.prepare('SELECT * FROM mm_accounts WHERE password_hash = ? AND active = 1').bind(key).first();
  if (a) return a;
  let legacy = await env.DB.prepare('SELECT * FROM mm_accounts WHERE legacy_sha256 = ? AND active = 1')
    .bind(await sha256Hex(password)).first();
  if (!legacy) {
    const { results } = await env.DB.prepare('SELECT * FROM mm_accounts WHERE legacy_pbkdf2 IS NOT NULL AND active = 1').all();
    for (const r of results) {
      if (await matchesOldPbkdf2(password, r.legacy_pbkdf2)) { legacy = r; break; }
    }
  }
  if (!legacy) return null;
  await env.DB.prepare("UPDATE mm_accounts SET password_hash = ?, password_salt = 'system', legacy_sha256 = NULL, legacy_pbkdf2 = NULL WHERE id = ?")
    .bind(key, legacy.id).run();
  return legacy;
}

export async function login(request, env) {
  const body = await readJson(request).catch(() => ({}));
  const password = String(body.password || '');
  const ip = clientIp(request);

  await checkRateLimit(env, request);

  let account = null;
  if (password) {
    account = await findByPassword(env, password);
  } else if (ip) {
    // כתובת IP מורשית – שייכת למשתמש אחד (אצלו ברשימת הכתובות)
    account = await env.DB.prepare(
      'SELECT a.* FROM mm_user_ips i JOIN mm_accounts a ON a.id = i.account_id WHERE i.ip = ? AND a.active = 1',
    ).bind(ip).first();
  }

  // כניסה לפי IP בלי הצלחה היא בדיקה שקטה – לא נרשמת ככישלון
  if (password || account) {
    await loginLog(env, request, {
      success: !!account, method: password ? 'password' : 'ip',
      username: account ? account.display_name : (password ? 'סיסמה שגויה' : ip), accountId: account?.id,
    });
  }
  if (!account) {
    if (!password) return json({ authorized: false, ip });
    throw new ApiError(401, 'bad_credentials', 'הסיסמה שגויה');
  }
  await logAction(env, request, { account }, { kind: 'auth', action: 'כניסה', target: password ? 'סיסמה' : `IP מורשה (${ip})` });
  return openSession(env, request, account, password ? 'password' : 'ip');
}

const noAccounts = async (env) => (await env.DB.prepare('SELECT COUNT(*) n FROM mm_accounts').first()).n === 0;

export async function loginOptions(env) {
  const c = await getConfig(env);
  return json({
    google_client_id: c.google_enabled && c.google_client_id ? c.google_client_id : null,
    setup_needed: await noAccounts(env),
  });
}

// הגדרה ראשונית: רק כשאין עדיין אף משתמש. טוקן + סיסמת מנהל → משתמש מנהל ראשון
export async function setup(request, env) {
  if (!(await noAccounts(env))) throw forbidden('המערכת כבר הוגדרה. יש להיכנס עם סיסמה');
  await checkRateLimit(env, request);
  const body = await readJson(request);
  const token = str(body.token, 300);
  const password = String(body.password || '');
  if (!token) throw badRequest('יש להזין טוקן');
  if (password.length < 4) throw badRequest('הסיסמה חייבת להכיל לפחות 4 תווים');
  // בדיקה שהטוקן עובד
  let ok = false;
  try {
    const r = await (await fetch(`${yemotBase(env)}MFASession?token=${encodeURIComponent(token)}&action=isPass`)).json();
    ok = r.responseStatus === 'OK';
  } catch { ok = false; }
  if (!ok) throw badRequest('הטוקן לא התקבל: הטוקן אינו תקף או שפג תוקפו');
  const now = israelNow();
  const key = await passwordKey(env, password);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mm_settings (key, value, updated_at) VALUES ('yemot_token', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(token, now),
    env.DB.prepare("INSERT INTO mm_accounts (display_name, password_hash, password_salt, is_admin, permissions, active, created_at) VALUES ('מנהל ראשי', ?, 'system', 1, '[]', 1, ?)").bind(key, now),
  ]);
  clearSettingsCache();
  const account = await env.DB.prepare('SELECT * FROM mm_accounts WHERE password_hash = ?').bind(key).first();
  await loginLog(env, request, { success: true, method: 'setup', username: account.display_name, accountId: account.id });
  await logAction(env, request, { account }, { kind: 'admin', action: 'הגדרה ראשונית', target: 'טוקן ומנהל ראשי' });
  return openSession(env, request, account, 'password');
}

// כניסה עם Google: Google מאמת את החתימה (tokeninfo); בודקים שהאסימון הונפק לאתר שלנו,
// שהמייל מאומת, ושיש משתמש פעיל עם המייל הזה
export async function loginGoogle(request, env) {
  const cfg = await getConfig(env);
  if (!cfg.google_enabled || !cfg.google_client_id) throw new ApiError(403, 'google_off', 'הכניסה עם Google אינה זמינה');
  const body = await readJson(request);
  const credential = str(body.credential, 4096);
  if (!credential) throw badRequest('חסר אסימון Google');
  await checkRateLimit(env, request);

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  const g = res.ok ? await res.json() : null;
  if (!g || !g.email || g.aud !== cfg.google_client_id || String(g.email_verified) !== 'true' || Number(g.exp) * 1000 < Date.now()) {
    throw new ApiError(401, 'google_failed', 'האימות מול Google נכשל. נסו שוב');
  }
  const email = normalizeEmail(g.email);
  const account = await env.DB.prepare('SELECT * FROM mm_accounts WHERE email = ? AND active = 1').bind(email).first();
  await loginLog(env, request, { success: !!account, method: 'google', username: email, accountId: account?.id });
  if (!account) throw new ApiError(401, 'no_user', `אין במערכת משתמש פעיל עם המייל ${g.email}. פנו למנהל המערכת`);
  await logAction(env, request, { account }, { kind: 'auth', action: 'כניסה', target: `Google (${email})` });
  return openSession(env, request, account, 'google');
}

export async function logout(request, env) {
  const token = readCookie(request);
  let ctx = null;
  try { ctx = await authenticate(request, env); } catch { /* כבר מנותק */ }
  if (token) await env.DB.prepare('DELETE FROM mm_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  if (ctx) await logAction(env, request, ctx, { kind: 'auth', action: 'יציאה' });
  return json({ logged_out: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

// הקשר הבקשה: { account } – זורק 401 אם אין חיבור תקף
export async function authenticate(request, env) {
  const token = readCookie(request);
  if (!token) throw unauthorized();
  const row = await env.DB.prepare(
    `SELECT a.*, s.expires_at AS s_expires, s.ip AS s_ip, s.method AS s_method FROM mm_sessions s JOIN mm_accounts a ON a.id = s.account_id
     WHERE s.token_hash = ? AND a.active = 1`,
  ).bind(await sha256Hex(token)).first();
  if (!row || row.s_expires < new Date().toISOString()) throw unauthorized('פג תוקף הכניסה, יש להיכנס מחדש');
  // כניסה לפי IP תקפה רק מאותה כתובת, וכל עוד הכתובת עדיין ברשימה של המשתמש
  if (row.s_method === 'ip') {
    const ip = clientIp(request);
    const ok = ip === row.s_ip && (await env.DB.prepare('SELECT 1 FROM mm_user_ips WHERE account_id = ? AND ip = ?').bind(row.id, ip).first());
    if (!ok) throw unauthorized('הכתובת שלכם השתנתה, יש להיכנס מחדש');
  }
  return { account: row, sessionHash: await sha256Hex(token) };
}

// ===== אזור אישי: יצירת / החלפת סיסמה של המשתמש עצמו (בכפוף להרשאה) =====
// יש כבר סיסמה → צריך את הסיסמה הנוכחית, חוץ ממי שנכנס עכשיו עם Google.
// אין עדיין סיסמה → יוצרים בלי אימות.
export async function changeOwnPassword(request, env, ctx) {
  requirePermission(ctx, 'self_password');
  const a = ctx.account;
  const body = await readJson(request);
  const next = String(body.password || '');
  if (next.length < 4) throw badRequest('הסיסמה חייבת להכיל לפחות 4 תווים');
  if (next.length > 200) throw badRequest('הסיסמה ארוכה מדי');
  const hasPassword = !!(a.password_hash || a.legacy_sha256 || a.legacy_pbkdf2);
  if (hasPassword && a.s_method !== 'google') {
    await checkRateLimit(env, request);
    const current = String(body.current || '');
    const key = current ? await passwordKey(env, current) : '';
    const ok = current && (sameHash(key, a.password_hash || '')
      || (a.legacy_sha256 && sameHash(await sha256Hex(current), a.legacy_sha256))
      || (a.legacy_pbkdf2 && await matchesOldPbkdf2(current, a.legacy_pbkdf2)));
    if (!ok) {
      await loginLog(env, request, { success: false, method: 'password-change', username: a.display_name, accountId: a.id });
      throw badRequest('הסיסמה הנוכחית שגויה');
    }
  }
  const key = await passwordKey(env, next);
  const taken = await env.DB.prepare('SELECT id FROM mm_accounts WHERE password_hash = ? AND id != ?').bind(key, a.id).first();
  if (taken) throw new ApiError(409, 'conflict', 'לא ניתן להשתמש בסיסמה הזו – בחרו סיסמה אחרת');
  await env.DB.batch([
    env.DB.prepare("UPDATE mm_accounts SET password_hash = ?, password_salt = 'system', legacy_sha256 = NULL, legacy_pbkdf2 = NULL WHERE id = ?").bind(key, a.id),
    // שאר החיבורים של המשתמש מתנתקים (החיבור הנוכחי נשאר)
    env.DB.prepare('DELETE FROM mm_sessions WHERE account_id = ? AND token_hash != ?').bind(a.id, ctx.sessionHash || ''),
  ]);
  await logAction(env, request, ctx, { kind: 'auth', action: hasPassword ? 'החלפת סיסמה אישית' : 'יצירת סיסמה אישית', target: a.display_name });
  return json({ has_password: true });
}

// "אחר כך" בהצעה ליצור סיסמה – ההצעה לא תופיע יותר, עד שהמנהל יאפס
export async function dismissPasswordPrompt(request, env, ctx) {
  await env.DB.prepare('UPDATE mm_accounts SET password_prompt_dismissed = ? WHERE id = ?').bind(israelNow(), ctx.account.id).run();
  await logAction(env, request, ctx, { kind: 'auth', action: 'דחיית ההצעה ליצור סיסמה', target: ctx.account.display_name });
  return json({ dismissed: true });
}

export function requireAdmin(ctx) {
  requirePermission(ctx, 'admin');
}

// בדיקה שקטה (לדפים שמוגשים מהשרת, למשל האתר הישן): מחובר ועם ההרשאה
export async function hasPagePermission(request, env, perm) {
  try { return permissionsOf((await authenticate(request, env)).account).includes(perm); } catch { return false; }
}
