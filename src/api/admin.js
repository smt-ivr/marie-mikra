// ============================================================
//  admin.js — ניהול (מנהל בלבד): משתמשים, הגדרות, יומן כניסות, יומן פעולות, מייל פתיחה
//  כל פעולת ניהול נרשמת ביומן הפעולות.
// ============================================================
import { badRequest, conflict, notFound, readJson, str, json, israelNow } from './http.js';
import { passwordKey, normalizeEmail, requireAdmin } from './auth.js';
import { getConfig, publicSettings, updateSettings, fillTemplate } from './settings.js';
import { connectionStatus } from './proxy.js';
import { logAction } from './audit.js';
import { welcomeMail, sendMail, validEmail, mailReady, renderMail } from './mail.js';
import { PERMISSIONS, cleanPermissions } from './permissions.js';

const isIp = (v) =>
  /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v) || // IPv4
  (v.includes(':') && /^[0-9a-fA-F:]{2,45}$/.test(v)); // IPv6

function accountOut(a, ips) {
  let stored = [];
  try { stored = JSON.parse(a.permissions || '[]'); } catch { stored = []; }
  return {
    id: a.id,
    name: a.display_name,
    email: a.email,
    is_admin: !!a.is_admin,
    permissions: cleanPermissions(stored),
    active: !!a.active,
    has_password: !!(a.password_hash || a.legacy_sha256 || a.legacy_pbkdf2),
    password_prompt_dismissed: a.password_prompt_dismissed || null,
    ips: ips.filter((i) => i.account_id === a.id).map((i) => ({ id: i.id, ip: i.ip, label: i.label || '' })),
    last_used_at: a.last_used_at,
    created_at: a.created_at,
  };
}

async function activeAdmins(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) n FROM mm_accounts WHERE is_admin = 1 AND active = 1').first();
  return r.n;
}

async function checkUnique(env, field, value, exceptId = 0) {
  if (!value) return;
  const q = {
    password: 'SELECT id FROM mm_accounts WHERE password_hash = ? AND id != ?',
    email: 'SELECT id FROM mm_accounts WHERE email = ? AND id != ?',
    ip: 'SELECT a.display_name AS name FROM mm_user_ips i JOIN mm_accounts a ON a.id = i.account_id WHERE i.ip = ? AND i.account_id != ?',
  }[field];
  const hit = await env.DB.prepare(q).bind(value, exceptId).first();
  if (hit) {
    throw conflict({
      password: 'הסיסמה כבר בשימוש אצל משתמש אחר – בחרו סיסמה אחרת',
      email: 'המייל כבר משויך למשתמש אחר',
      ip: `כתובת ה-IP ${value} כבר משויכת למשתמש "${hit.name}"`,
    }[field]);
  }
}

// רשימת כתובות IP מהטופס: [{ ip, label }] – בדיקה, בלי כפילויות
async function readIps(env, list, exceptId = 0) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const ip = str(item && item.ip, 45);
    if (!ip) continue;
    if (!isIp(ip)) throw badRequest(`כתובת IP לא תקינה: ${ip}`);
    if (seen.has(ip)) continue;
    seen.add(ip);
    await checkUnique(env, 'ip', ip, exceptId);
    out.push({ ip, label: str(item.label, 60) });
  }
  return out;
}

const ipStatements = (env, accountId, ips, now) => [
  env.DB.prepare('DELETE FROM mm_user_ips WHERE account_id = ?').bind(accountId),
  ...ips.map((x) => env.DB.prepare('INSERT INTO mm_user_ips (account_id, ip, label, created_at) VALUES (?, ?, ?, ?)').bind(accountId, x.ip, x.label || null, now)),
];

const permNames = (list) => list.map((p) => PERMISSIONS[p]).join(', ') || '(אין)';

// ===== משתמשים: שם ומייל; בתוכם סיסמה, כתובות IP והרשאות =====
async function listAccounts(env) {
  const { results } = await env.DB.prepare('SELECT * FROM mm_accounts ORDER BY is_admin DESC, active DESC, display_name').all();
  const { results: ips } = await env.DB.prepare('SELECT * FROM mm_user_ips ORDER BY id').all();
  return json({ accounts: results.map((a) => accountOut(a, ips)), permissions: PERMISSIONS });
}

async function createAccount(request, env, ctx) {
  const b = await readJson(request);
  const name = str(b.name, 80);
  if (!name) throw badRequest('חסר שם');
  const email = b.email ? normalizeEmail(b.email) : null;
  if (email && !validEmail(email)) throw badRequest('כתובת המייל אינה תקינה');
  await checkUnique(env, 'email', email);

  const password = String(b.password || '');
  let key = null;
  if (password) {
    if (password.length < 4) throw badRequest('סיסמה חייבת להיות לפחות 4 תווים');
    key = await passwordKey(env, password);
    await checkUnique(env, 'password', key);
  }
  const ips = await readIps(env, b.ips);
  if (!key && !ips.length && !email) throw badRequest('יש להגדיר לפחות דרך כניסה אחת: סיסמה, כתובת IP, או מייל (לכניסה עם Google)');

  const perms = cleanPermissions(b.permissions);
  const now = israelNow();
  const r = await env.DB.prepare(
    "INSERT INTO mm_accounts (rule_type, email, password_hash, password_salt, display_name, is_admin, permissions, active, created_at) VALUES ('user', ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(email, key, key ? 'system' : null, name, b.is_admin ? 1 : 0, JSON.stringify(perms), b.active === false ? 0 : 1, now).run();
  const id = r.meta.last_row_id;
  if (ips.length) await env.DB.batch(ipStatements(env, id, ips, now));

  await logAction(env, request, ctx, {
    kind: 'admin', action: 'הוספת משתמש', target: name,
    details: {
      מייל: email || '', סיסמה: key ? 'הוגדרה' : 'אין', 'כתובות IP': ips.map((x) => x.ip).join(', ') || 'אין',
      הרשאות: b.is_admin ? 'ניהול המערכת (הכול)' : permNames(perms),
    },
  });
  return json({ id });
}

async function updateAccount(request, env, ctx, id) {
  const a = await env.DB.prepare('SELECT * FROM mm_accounts WHERE id = ?').bind(id).first();
  if (!a) throw notFound('המשתמש לא נמצא');
  const b = await readJson(request);
  const changes = {};
  const set = [];
  const vals = [];
  const put = (col, val, label, shown = val) => { set.push(`${col} = ?`); vals.push(val); changes[label] = shown; };
  let dropSessions = false;

  if (b.name !== undefined) {
    const name = str(b.name, 80);
    if (!name) throw badRequest('חסר שם');
    if (name !== a.display_name) put('display_name', name, 'שם');
  }
  let email = a.email || null;
  if (b.email !== undefined) {
    email = b.email ? normalizeEmail(b.email) : null;
    if (email && !validEmail(email)) throw badRequest('כתובת המייל אינה תקינה');
    if (email !== (a.email || null)) { await checkUnique(env, 'email', email, id); put('email', email, 'מייל', email || '(הוסר)'); }
  }
  let hasPassword = !!(a.password_hash || a.legacy_sha256 || a.legacy_pbkdf2);
  if (b.password) {
    if (String(b.password).length < 4) throw badRequest('סיסמה חייבת להיות לפחות 4 תווים');
    const key = await passwordKey(env, String(b.password));
    await checkUnique(env, 'password', key, id);
    set.push('password_hash = ?', "password_salt = 'system'", 'legacy_sha256 = NULL', 'legacy_pbkdf2 = NULL');
    vals.push(key);
    changes['סיסמה'] = 'הוחלפה';
    hasPassword = true;
    dropSessions = true;
  } else if (b.remove_password && hasPassword) {
    set.push('password_hash = NULL', 'password_salt = NULL', 'legacy_sha256 = NULL', 'legacy_pbkdf2 = NULL');
    changes['סיסמה'] = 'הוסרה';
    hasPassword = false;
    dropSessions = true;
  }

  let ips = null;
  if (b.ips !== undefined) {
    ips = await readIps(env, b.ips, id);
    const { results: before } = await env.DB.prepare('SELECT ip FROM mm_user_ips WHERE account_id = ? ORDER BY id').bind(id).all();
    const was = before.map((x) => x.ip).sort().join(', ');
    const now = ips.map((x) => x.ip).sort().join(', ');
    if (was !== now) { changes['כתובות IP'] = `${was || 'אין'} ← ${now || 'אין'}`; dropSessions = true; }
  }
  const ipCount = ips ? ips.length : (await env.DB.prepare('SELECT COUNT(*) n FROM mm_user_ips WHERE account_id = ?').bind(id).first()).n;
  if (!hasPassword && !ipCount && !email) throw badRequest('יש להשאיר לפחות דרך כניסה אחת: סיסמה, כתובת IP, או מייל (לכניסה עם Google)');

  if (b.permissions !== undefined) {
    const perms = cleanPermissions(b.permissions);
    let before = [];
    try { before = cleanPermissions(JSON.parse(a.permissions || '[]')); } catch { before = []; }
    if (perms.slice().sort().join() !== before.slice().sort().join()) put('permissions', JSON.stringify(perms), 'הרשאות', permNames(perms));
  }
  if (b.is_admin !== undefined && !!b.is_admin !== !!a.is_admin) put('is_admin', b.is_admin ? 1 : 0, 'ניהול המערכת', b.is_admin ? 'כן' : 'לא');
  // הצגה מחדש של ההצעה ליצור סיסמה (אחרי שהמשתמש לחץ "אחר כך")
  if (b.reset_password_prompt && a.password_prompt_dismissed) put('password_prompt_dismissed', null, 'הצעה ליצור סיסמה', 'תוצג שוב');
  if (b.active !== undefined && !!b.active !== !!a.active) { put('active', b.active ? 1 : 0, 'פעיל', b.active ? 'כן' : 'לא'); if (!b.active) dropSessions = true; }

  // לא משאירים את המערכת בלי מנהל פעיל
  const losesAdmin = a.is_admin && a.active && ((b.is_admin !== undefined && !b.is_admin) || (b.active !== undefined && !b.active));
  if (losesAdmin && (await activeAdmins(env)) <= 1) throw badRequest('חייב להישאר לפחות מנהל פעיל אחד');

  const stmts = [];
  if (set.length) stmts.push(env.DB.prepare(`UPDATE mm_accounts SET ${set.join(', ')} WHERE id = ?`).bind(...vals, id));
  if (ips && changes['כתובות IP']) stmts.push(...ipStatements(env, id, ips, israelNow()));
  if (!stmts.length) return json({ updated: false });
  await env.DB.batch(stmts);
  // שינוי סיסמה / כתובות / השבתה → ניתוק החיבורים האחרים של המשתמש
  if (dropSessions) await env.DB.prepare('DELETE FROM mm_sessions WHERE account_id = ? AND token_hash != ?').bind(id, ctx.sessionHash || '').run();
  await logAction(env, request, ctx, { kind: 'admin', action: 'עדכון משתמש', target: a.display_name, details: changes });
  return json({ updated: true });
}

async function deleteAccount(request, env, ctx, id) {
  if (id === ctx.account.id) throw badRequest('אי אפשר למחוק את עצמך');
  const a = await env.DB.prepare('SELECT * FROM mm_accounts WHERE id = ?').bind(id).first();
  if (!a) throw notFound('המשתמש לא נמצא');
  if (a.is_admin && a.active && (await activeAdmins(env)) <= 1) throw badRequest('חייב להישאר לפחות מנהל פעיל אחד');
  const { results: ips } = await env.DB.prepare('SELECT ip FROM mm_user_ips WHERE account_id = ?').bind(id).all();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mm_sessions WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM mm_user_ips WHERE account_id = ?').bind(id),
    env.DB.prepare('DELETE FROM mm_accounts WHERE id = ?').bind(id),
  ]);
  await logAction(env, request, ctx, {
    kind: 'admin', action: 'מחיקת משתמש', target: a.display_name,
    details: { מייל: a.email || '', 'כתובות IP': ips.map((x) => x.ip).join(', ') || 'אין' },
  });
  return json({ deleted: true });
}

async function sendWelcome(request, env, ctx, id) {
  const a = await env.DB.prepare('SELECT * FROM mm_accounts WHERE id = ?').bind(id).first();
  if (!a) throw notFound('המשתמש לא נמצא');
  const b = await readJson(request).catch(() => ({}));
  const to = b.to ? normalizeEmail(b.to) : a.email;
  if (!to) throw badRequest('למשתמש אין מייל. הוסיפו מייל או הזינו כתובת לשליחה');
  const cfg = await getConfig(env);
  const m = welcomeMail(cfg, {
    displayName: a.display_name, password: b.password ? String(b.password) : '',
    email: to, google: cfg.google_enabled && !!cfg.google_client_id && to === a.email,
  }, fillTemplate);
  const res = await sendMail(cfg, m);
  await logAction(env, request, ctx, { kind: 'admin', action: 'שליחת מייל פתיחה', target: a.display_name, details: { אל: to, 'כולל סיסמה': b.password ? 'כן' : 'לא' } });
  return json(res);
}

// ===== הגדרות =====
async function saveSettings(request, env, ctx) {
  const b = await readJson(request);
  const changed = await updateSettings(env, b);
  if (changed.length) await logAction(env, request, ctx, { kind: 'admin', action: 'עדכון הגדרות', details: { שדות: changed.join(', ') } });
  return json({ ...(await publicSettings(env)), connection: await connectionStatus(env) });
}

async function testMail(request, env, ctx) {
  const b = await readJson(request);
  const to = normalizeEmail(b.to);
  if (!validEmail(to)) throw badRequest('כתובת המייל אינה תקינה');
  const cfg = await getConfig(env);
  const res = await sendMail(cfg, {
    to, subject: 'מייל בדיקה – מארי מקרא', title: 'מייל בדיקה',
    paragraphs: ['אם קיבלתם את המייל הזה, שליחת המיילים במערכת מארי מקרא עובדת.'],
  });
  await logAction(env, request, ctx, { kind: 'admin', action: 'מייל בדיקה', target: to });
  return json(res);
}

async function previewWelcome(request, env) {
  const b = await readJson(request).catch(() => ({}));
  const cfg = { ...(await getConfig(env)), ...Object.fromEntries(Object.entries(b).filter(([k]) => k.startsWith('welcome_'))) };
  const m = welcomeMail(cfg, { displayName: 'ר׳ משה כהן', password: 'sod1234', email: 'office@example.com', google: cfg.google_enabled }, fillTemplate);
  return json({ subject: m.subject, html: renderMail(m), mail_ready: mailReady(cfg) });
}

// ===== יומנים =====
const page = (url) => {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
  return { limit, offset };
};

async function loginLog(env, url) {
  const { limit, offset } = page(url);
  const { results } = await env.DB.prepare(
    `SELECT l.*, a.display_name FROM mm_login_log l LEFT JOIN mm_accounts a ON a.id = l.account_id
     ORDER BY l.id DESC LIMIT ? OFFSET ?`,
  ).bind(limit + 1, offset).all();
  return json({ rows: results.slice(0, limit), more: results.length > limit });
}

async function actionLog(env, url) {
  const { limit, offset } = page(url);
  const where = [];
  const vals = [];
  const kind = url.searchParams.get('kind');
  if (kind) { where.push('kind = ?'); vals.push(kind); }
  const account = parseInt(url.searchParams.get('account') || '', 10);
  if (account) { where.push('account_id = ?'); vals.push(account); }
  const q = str(url.searchParams.get('q'), 100);
  if (q) { where.push('(action LIKE ? OR target LIKE ? OR details LIKE ? OR account_name LIKE ?)'); vals.push(...Array(4).fill(`%${q}%`)); }
  const { results } = await env.DB.prepare(
    `SELECT * FROM mm_action_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).bind(...vals, limit + 1, offset).all();
  return json({ rows: results.slice(0, limit), more: results.length > limit });
}

// ===== נתב =====
export async function handleAdmin(request, env, ctx, sub, url) {
  requireAdmin(ctx);
  const m = request.method;
  const idMatch = sub.match(/^accounts\/(\d+)(\/welcome)?$/);

  if (sub === 'accounts' && m === 'GET') return listAccounts(env);
  if (sub === 'accounts' && m === 'POST') return createAccount(request, env, ctx);
  if (idMatch && !idMatch[2] && m === 'PUT') return updateAccount(request, env, ctx, Number(idMatch[1]));
  if (idMatch && !idMatch[2] && m === 'DELETE') return deleteAccount(request, env, ctx, Number(idMatch[1]));
  if (idMatch && idMatch[2] && m === 'POST') return sendWelcome(request, env, ctx, Number(idMatch[1]));
  if (sub === 'settings' && m === 'GET') return json({ ...(await publicSettings(env)), connection: await connectionStatus(env) });
  if (sub === 'settings' && m === 'PUT') return saveSettings(request, env, ctx);
  if (sub === 'settings/test-mail' && m === 'POST') return testMail(request, env, ctx);
  if (sub === 'settings/preview' && m === 'POST') return previewWelcome(request, env);
  if (sub === 'login-log' && m === 'GET') return loginLog(env, url);
  if (sub === 'action-log' && m === 'GET') return actionLog(env, url);
  throw notFound('הכתובת לא נמצאה');
}
