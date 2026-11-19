// ============================================================
//  proxy.js — כל הפניות למערכת עוברות דרך השרת (כמו במסכת של שבת)
//  הדפדפן לא מחזיק טוקן: השרת מוסיף את הטוקן מההגדרות במסד.
//  כל פעולת שינוי נרשמת ביומן הפעולות (בלי הטוקן).
//
//  /marie-mikra/api/yemot/<Method>?...   → https://www.call2all.co.il/ym/api/<Method>
// ============================================================
import { ApiError, badRequest } from './http.js';
import { getConfig } from './settings.js';
import { logAction, safeDetails } from './audit.js';
import { can } from './permissions.js';
import { enforcePaths, getPaths, rulesFromPaths } from './yemot-paths.js';
import { yemotBase } from './auth.js';

// רק הפעולות שהאתר (הישן והחדש) משתמש בהן
const YEMOT_METHODS = {
  GetTextFile: 'read',
  GetIVR2Dir: 'read',
  RenderYMGRFile: 'read',
  DownloadFile: 'read',
  GetSession: 'read',
  GetIncomingCalls: 'read',
  GetCustomerData: 'read',
  MFASession: 'read',
  GetTasks: 'read',
  GetTasksData: 'read',
  GetTasksLogs: 'read',
  TzintukimListManagement: 'read', // getlistEnteres / getLogList בלבד – ראו למטה
  UploadTextFile: 'write',
  UploadFile: 'write',
  FileAction: 'write',
  UpdateExtension: 'write',
  UpdateTask: 'write',
  RunTzintuk: 'write',
};

const YEMOT_NAMES = {
  GetTextFile: 'קריאת קובץ', GetIVR2Dir: 'רשימת תיקייה', RenderYMGRFile: 'קריאת דוח',
  DownloadFile: 'הורדת קובץ', GetSession: 'בדיקת חיבור', GetIncomingCalls: 'שיחות פעילות', GetCustomerData: 'פרטי מערכת',
  MFASession: 'אימות דו-שלבי', GetTasks: 'רשימת משימות', GetTasksData: 'פרטי משימה', GetTasksLogs: 'יומן משימה',
  TzintukimListManagement: 'רשימת צינתוקים', UploadTextFile: 'שמירת קובץ', UploadFile: 'העלאת קובץ',
  FileAction: 'פעולה על קבצים', UpdateExtension: 'עדכון שלוחה', UpdateTask: 'עדכון משימה', RunTzintuk: 'הפעלת צינתוק',
};

// פעולות שחוזרות כל כמה שניות – לא נרשמות ביומן בכלל
const NEVER_LOG = new Set(['GetIncomingCalls', 'GetCustomerData', 'MFASession', 'GetSession']);

// קריאות שקורות בכל טעינת עמוד – נרשמות פעם אחת לכל משתמש בכל 10 דקות, כדי שהיומן לא יוצף
async function shouldLogRead(env, ctx, action, target) {
  const since = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(Date.now() - 10 * 60000));
  const row = await env.DB.prepare(
    'SELECT 1 FROM mm_action_log WHERE account_id = ? AND action = ? AND target = ? AND created_at > ? LIMIT 1',
  ).bind(ctx.account.id, action, target, since).first();
  return !row;
}

function yemotTarget(params) {
  return params.what || params.wath || params.path || params.phones || (params.TaskId ? `Task ${params.TaskId}` : '') || '';
}

// הרשאות לפעולות שאינן על קבצים
function pathlessPermission(method, params) {
  if (['GetIncomingCalls', 'GetCustomerData', 'MFASession', 'GetSession'].includes(method)) return null; // לכל משתמש מחובר
  if (['GetTasks', 'GetTasksData', 'GetTasksLogs'].includes(method)) return 'tzintuk_view';
  if (method === 'TzintukimListManagement') return /^get/i.test(params.action || '') ? 'tzintuk_view' : 'tzintuk_edit';
  if (method === 'UpdateTask' || method === 'RunTzintuk') return 'tzintuk_edit';
  return undefined;
}

export async function proxyYemot(request, env, ctx, method) {
  let kind = YEMOT_METHODS[method];
  if (!kind) throw badRequest('פעולה לא מורשית');
  const cfg = await getConfig(env);
  if (!cfg.yemot_token) throw new ApiError(503, 'yemot_not_configured', 'לא הוגדר טוקן. מנהל המערכת צריך להגדיר אותו בדף הניהול');

  const url = new URL(request.url);
  const query = new URLSearchParams(url.search);
  query.delete('token');
  query.delete('_');
  query.set('token', cfg.yemot_token);

  const init = { method: request.method, headers: {} };
  const logged = Object.fromEntries([...query].filter(([k]) => k !== 'token'));

  if (request.method === 'POST') {
    const type = request.headers.get('content-type') || '';
    if (type.includes('multipart/form-data')) {
      const form = await request.formData();
      form.delete('token');
      for (const [k, v] of form) logged[k] = v;
      form.set('token', cfg.yemot_token);
      init.body = form;
    } else {
      const body = new URLSearchParams(await request.text());
      body.delete('token');
      for (const [k, v] of body) logged[k] = v;
      body.set('token', cfg.yemot_token);
      init.body = body;
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }
  const range = request.headers.get('Range');
  if (range) init.headers.Range = range;

  if (method === 'TzintukimListManagement' && !/^get/i.test(logged.action || '')) kind = 'write';
  const action = YEMOT_NAMES[method] || method;
  const target = yemotTarget(logged);

  // הרשאות: לפי התחום של הכתובת (מבחנים / נקודות / תלמידים / זמנים / לוגים) או לפי סוג הפעולה
  try {
    const perm = pathlessPermission(method, logged);
    if (perm !== undefined) {
      if (perm && !can(ctx, perm)) throw new ApiError(403, 'forbidden', 'אין לכם הרשאה לפעולה זו');
    } else {
      enforcePaths(method, logged, rulesFromPaths(getPaths(cfg.yemot_paths)), (p) => can(ctx, p));
    }
  } catch (err) {
    await logAction(env, request, ctx, { kind, action, target, details: safeDetails(logged), status: `נחסם: ${err.message}` });
    throw err;
  }

  const upstream = await fetch(`${yemotBase(env)}${method}?${query.toString()}`, init);
  const contentType = upstream.headers.get('content-type') || '';
  const logIt = async (status) => {
    if (NEVER_LOG.has(method)) return;
    if (kind === 'write' || (await shouldLogRead(env, ctx, action, target))) {
      await logAction(env, request, ctx, { kind, action, target, details: safeDetails(logged), status });
    }
  };

  // קבצים (הקלטות) – מועברים כמו שהם
  if (!contentType.includes('json')) {
    await logIt(String(upstream.status));
    const headers = new Headers();
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition']) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('Cache-Control', 'private, max-age=300');
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const text = await upstream.text();
  let status = String(upstream.status);
  try {
    const data = JSON.parse(text);
    status = data.responseStatus ? `${data.responseStatus}${data.message ? `: ${String(data.message).slice(0, 120)}` : ''}` : status;
  } catch { /* לא JSON */ }
  await logIt(status);
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// בדיקת חיבור (לממשק החדש ולדף הניהול): ok | mfa | expired | error
export async function connectionStatus(env) {
  const cfg = await getConfig(env);
  if (!cfg.yemot_token) return { status: 'expired', ok: false, message: 'לא הוגדר טוקן' };
  const get = async (action) => (await fetch(`${yemotBase(env)}MFASession?token=${encodeURIComponent(cfg.yemot_token)}&action=${action}`)).json();
  try {
    const r = await get('isPass');
    if (r.responseStatus !== 'OK') return { status: 'expired', ok: false, message: 'הטוקן אינו תקף או שפג תוקפו' };
    if (r.isPass) return { status: 'ok', ok: true, message: 'מחובר' };
    const t = await get('try');
    if (t.responseStatus === 'OK' && t.isPass) return { status: 'ok', ok: true, message: 'מחובר' };
    return { status: 'mfa', ok: false, message: 'נדרש אימות דו-שלבי' };
  } catch {
    return { status: 'error', ok: false, message: 'שגיאת תקשורת' };
  }
}
