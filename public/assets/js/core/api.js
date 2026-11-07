// Client for the Yemot HaMashiach API, through our own server.
// The browser never sees the Yemot token: the server (src/server.js) holds it,
// attaches it to every call and renews it automatically.

export const API_BASE = 'srv/yemot';

export class ApiError extends Error {
  constructor(message, data) {
    super(message);
    this.data = data;
  }
}

const NOT_FOUND_RE = /Error retrieving file path information|Invalid path|file does not exist|File Not Found|not exist/i;

export function isNotFound(err) {
  return NOT_FOUND_RE.test(err?.message || '');
}

const READ_ONLY = new Set(['GetTextFile', 'RenderYMGRFile', 'GetIVR2Dir', 'GetCustomerData']);

// main.js registers handlers for "signed out" and "Yemot needs the password again".
const handlers = { unauthorized: null, relink: null };
export function onServerEvent(name, fn) { handlers[name] = fn; }

function serverProblem(res, data) {
  if (res.status === 401 && data?.auth) { handlers.unauthorized && handlers.unauthorized(); return new ApiError('יש להתחבר מחדש.', data); }
  if (res.status === 409 && data?.relink) { handlers.relink && handlers.relink(data.message); return new ApiError(data.message, data); }
  return null;
}

/**
 * Generic call. Throws ApiError when responseStatus is present and not OK.
 * opts.post: send params as form body (POST).
 */
export async function call(endpoint, params = {}, opts = {}) {
  const p = {};
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) p[k] = v; });
  let res;
  try {
    if (opts.post) {
      res = await fetch(`${API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-MM-Client': '1' },
        body: new URLSearchParams(p),
        credentials: 'same-origin',
      });
    } else {
      if (READ_ONLY.has(endpoint)) p._ = Date.now();
      res = await fetch(`${API_BASE}/${endpoint}?${new URLSearchParams(p)}`, {
        headers: { 'X-MM-Client': '1' }, cache: 'no-store', credentials: 'same-origin',
      });
    }
  } catch {
    throw new ApiError('אין תקשורת עם השרת. בדקו את החיבור לאינטרנט.');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`השרת החזיר תשובה לא תקינה (${res.status})`);
  }
  const problem = serverProblem(res, data);
  if (problem) throw problem;
  if (data && data.ok === false && data.message) throw new ApiError(data.message, data);
  if (data && 'responseStatus' in data && data.responseStatus !== 'OK' && !opts.allowError) {
    throw new ApiError(data.message || 'השרת החזיר שגיאה', data);
  }
  return data;
}

/** Calls to our own server (sign-in, history, audit). */
export async function server(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`srv/${path}`, {
      method,
      headers: { 'X-MM-Client': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('אין תקשורת עם השרת. בדקו את החיבור לאינטרנט.');
  }
  let data;
  try { data = await res.json(); } catch { throw new ApiError(`השרת החזיר תשובה לא תקינה (${res.status})`); }
  if (!res.ok || data.ok === false) {
    if (!path.startsWith('auth/')) serverProblem(res, data);
    throw new ApiError(data.message || `שגיאת שרת (${res.status})`, data);
  }
  return data;
}

// ---------- Files & folders ----------

/** Read a text file. Returns null when the file does not exist. */
export async function getText(path) {
  try {
    const data = await call('GetTextFile', { what: path });
    return typeof data.contents === 'string' ? data.contents : '';
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** Same as getText but also returns file metadata (mtime) when the API provides it. */
export async function getTextWithMeta(path) {
  try {
    const data = await call('GetTextFile', { what: path });
    return { contents: data.contents ?? '', file: data.file || null };
  } catch (e) {
    if (isNotFound(e)) return { contents: null, file: null };
    throw e;
  }
}

export async function uploadText(path, contents) {
  return call('UploadTextFile', { what: path, contents }, { post: true });
}

export async function listDir(path) {
  const data = await call('GetIVR2Dir', { path });
  data.dirs = data.dirs || [];
  data.files = data.files || [];
  data.ini = data.ini || [];
  return data;
}

/** mtime of a file in a folder (or null). */
export async function fileMTime(path) {
  try {
    const i = path.lastIndexOf('/');
    const dir = await listDir(path.substring(0, i));
    const name = path.substring(i + 1);
    const f = [...dir.ini, ...dir.files].find((x) => x.name === name);
    return f?.mtime || null;
  } catch {
    return null;
  }
}

/** Render a .ymgr file to JSON rows with Hebrew headers. */
export async function renderYmgr(path) {
  // note: "wath" is the real parameter name expected by the API.
  const data = await call('RenderYMGRFile', { wath: path, convertType: 'json' });
  return data.data || [];
}

export async function fileAction(action, what, target) {
  const data = await call('FileAction', { action, what, target }, { allowError: true });
  const report = data?.reports?.[0] || {};
  const ok = (data?.success && (report.success ?? true)) || data?.message === 'ok';
  if (!ok) throw new ApiError(data?.message || 'הפעולה נכשלה בשרת', data);
  return data;
}

export async function updateExtension(path, props = {}) {
  return call('UpdateExtension', { path, ...props });
}

export function downloadUrl(path) {
  return `${API_BASE}/DownloadFile?path=${encodeURIComponent(path)}`;
}

// ---------- System ----------

export async function getIncomingCalls() {
  const data = await call('GetIncomingCalls', {}, { allowError: true, noRetry: true });
  return Array.isArray(data?.calls) ? data.calls : [];
}

export async function getCustomerData() {
  return call('GetCustomerData');
}

/** True if someone is currently inside the given folder (e.g. taking the test). */
export async function hasActiveCallsIn(folderPath) {
  try {
    const calls = await getIncomingCalls();
    const mine = folderPath.replace(/^ivr2:/, '').replace(/^\/+|\/+$/g, '');
    return calls.some((c) => c.path && String(c.path).includes(mine));
  } catch {
    return false;
  }
}
