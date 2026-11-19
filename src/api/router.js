// ============================================================
//  router.js — כל ה-API של מארי מקרא: /marie-mikra/api/...  (כמו במסכת של שבת)
//  ללא כניסה:  auth/login, auth/google, auth/options, auth/setup, auth/logout
//  עם כניסה:   auth/me, config, client/browser-cleanup, yemot/<Method>, history
//  מנהל בלבד:  admin/...
// ============================================================
import { json, notFound, errorResponse, readJson, str, clientIp } from './http.js';
import { ensureSchema } from './schema.js';
import { login, loginGoogle, loginOptions, logout, authenticate, publicAccount, setup } from './auth.js';
import { proxyYemot } from './proxy.js';
import { handleAdmin } from './admin.js';
import { logAction } from './audit.js';
import { getConfig } from './settings.js';
import { getPaths } from './yemot-paths.js';
import { requirePermission } from './permissions.js';

// מפתחות שהאתר שמר בדפדפן (טוקנים וסיסמאות) – נמחקים ומדווחים
const KNOWN_BROWSER_KEYS = ['api_token', 'username', 'password'];

async function browserCleanup(request, env, ctx) {
  const b = await readJson(request).catch(() => ({}));
  const found = (Array.isArray(b.found) ? b.found : [])
    .filter((k) => KNOWN_BROWSER_KEYS.includes(k))
    .slice(0, 20);
  await logAction(env, request, ctx, {
    kind: 'cleanup',
    action: 'ניקוי דפדפן',
    target: found.length ? `נמצאו ונמחקו ${found.length} פריטים` : 'לא נמצאו נתונים שמורים',
    details: found.length ? { 'פריטים שנמחקו': found.join(', '), דפדפן: str(request.headers.get('user-agent'), 150) } : null,
    status: found.length ? 'נמחק' : 'נקי',
  });
  return json({ logged: true });
}

// יומן שינויי ציונים (הממשק החדש)
async function history(request, env, ctx, sub, url) {
  const m = request.method;
  if (sub === '' && m === 'GET') {
    requirePermission(ctx, 'tests_view');
    const { results } = await env.DB.prepare('SELECT * FROM mm_grade_history WHERE path = ? ORDER BY at DESC LIMIT 300')
      .bind(url.searchParams.get('path') || '').all();
    return json({ items: results });
  }
  requirePermission(ctx, 'tests_edit');
  if (sub === '' && m === 'POST') {
    const b = await readJson(request);
    if (!b.path || typeof b.oldLine !== 'string' || typeof b.newLine !== 'string') throw notFound('נתונים חסרים');
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO mm_grade_history (id, username, at, path, name, phone, school, old_value, new_value, old_line, new_line, note)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ctx.account.display_name, Date.now(), str(b.path, 300), str(b.name, 100), str(b.phone, 30), str(b.school, 60),
        str(b.from, 20), str(b.to, 20), b.oldLine, b.newLine, str(b.note, 300)).run();
    await logAction(env, request, ctx, { kind: 'write', action: 'עריכת ציון', target: str(b.name, 100), details: { מ: b.from, ל: b.to, קובץ: b.path, סיבה: b.note || '' } });
    return json({ id });
  }
  const mm = sub.match(/^\/([\w-]+)\/undone$/);
  if (mm && m === 'POST') {
    await env.DB.prepare('UPDATE mm_grade_history SET undone_at = ? WHERE id = ?').bind(Date.now(), mm[1]).run();
    return json({ ok: true });
  }
  throw notFound('הכתובת לא נמצאה');
}

export async function handleApi(request, env, path) {
  try {
    if (!env.DB) throw new Error('D1 binding DB is missing');
    await ensureSchema(env);
    const url = new URL(request.url);
    const m = request.method;

    if (path === 'auth/login' && m === 'POST') return await login(request, env);
    if (path === 'auth/google' && m === 'POST') return await loginGoogle(request, env);
    if (path === 'auth/options' && m === 'GET') return await loginOptions(env);
    if (path === 'auth/setup' && m === 'POST') return await setup(request, env);
    if (path === 'auth/logout' && m === 'POST') return await logout(request, env);

    const ctx = await authenticate(request, env);

    if (path === 'auth/me' && m === 'GET') return json({ user: publicAccount(ctx.account), ip: clientIp(request) });
    // הכתובות במערכת שהאתר עובד איתן (נערכות בהגדרות הניהול)
    if (path === 'config' && m === 'GET') return json({ paths: getPaths((await getConfig(env)).yemot_paths) });
    if (path === 'client/browser-cleanup' && m === 'POST') return await browserCleanup(request, env, ctx);
    if (path.startsWith('yemot/')) return await proxyYemot(request, env, ctx, path.slice('yemot/'.length));
    if (path === 'history' || path.startsWith('history/')) return await history(request, env, ctx, path.slice('history'.length), url);
    if (path.startsWith('admin/')) return await handleAdmin(request, env, ctx, path.slice('admin/'.length), url);

    throw notFound('הכתובת לא נמצאה');
  } catch (err) {
    return errorResponse(err);
  }
}
