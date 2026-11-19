// ============================================================
//  http.js — תגובות JSON אחידות ושגיאות
//  הצלחה:  { ok: true, data }
//  כישלון: { ok: false, error: { code, message } }  + קוד HTTP מתאים
// ============================================================

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code = 'bad_request') => new ApiError(400, code, message);
export const unauthorized = (message = 'נדרשת כניסה למערכת') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'אין הרשאה לפעולה זו') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'הפריט לא נמצא') => new ApiError(404, 'not_found', message);
export const conflict = (message, code = 'conflict') => new ApiError(409, code, message);

const baseHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(baseHeaders);
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  return new Response(JSON.stringify({ ok: true, data }), { status, headers });
}

export function errorResponse(err) {
  const known = err instanceof ApiError;
  if (!known) console.error(err && err.stack || err);
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: known ? err.code : 'server_error', message: known ? err.message : 'אירעה תקלה בשרת, נסו שוב' },
    }),
    { status: known ? err.status : 500, headers: baseHeaders },
  );
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (body && typeof body === 'object') return body;
  } catch {
    /* נופל לשגיאה */
  }
  throw badRequest('גוף הבקשה אינו JSON תקין');
}

export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export const clientIp = (request) => request.headers.get('cf-connecting-ip') || '';

// זמן ישראל לתצוגה: 2026-11-18 14:05:09
export function israelNow() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date());
}
