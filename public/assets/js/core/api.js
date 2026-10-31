// Client for the Yemot HaMashiach API (call2all). Every request goes straight
// from the browser to the API, exactly like the old version did.
import { settings } from './settings.js';

export const API_BASE = 'https://www.call2all.co.il/ym/api';

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

let renewHandler = null;
/** auth.js registers a function that tries to get a fresh token (returns true on success). */
export function onTokenExpired(fn) { renewHandler = fn; }

function looksLikeTokenProblem(data) {
  const m = `${data?.message || ''} ${data?.responseStatus || ''}`;
  return /token|IS_NOT_LOGGED|not logged|session/i.test(m) && !/MFA/i.test(m);
}

function buildUrl(endpoint, params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.append(k, v);
  });
  return `${API_BASE}/${endpoint}?${qs.toString()}`;
}

/**
 * Generic call. Throws ApiError when responseStatus is present and not OK.
 * opts.raw: return the Response text instead of JSON.
 * opts.post: send params as form body (POST).
 * opts.noToken: don't attach the stored token.
 */
export async function call(endpoint, params = {}, opts = {}) {
  const doRequest = async () => {
    const p = { ...params };
    if (!opts.noToken) p.token = settings.token;
    let res;
    try {
      if (opts.post) {
        const body = new URLSearchParams();
        Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null) body.append(k, v); });
        res = await fetch(`${API_BASE}/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
      } else {
        // Cache-buster only on read-only endpoints: write endpoints such as
        // UpdateExtension store every parameter they receive.
        if (READ_ONLY.has(endpoint)) p._ = Date.now();
        res = await fetch(buildUrl(endpoint, p), { cache: 'no-store' });
      }
    } catch (e) {
      throw new ApiError('אין תקשורת עם שרת ימות המשיח. בדקו את החיבור לאינטרנט.');
    }
    if (!res.ok) throw new ApiError(`שגיאת רשת (${res.status})`);
    if (opts.raw) return res.text();
    let data;
    try {
      data = await res.json();
    } catch {
      throw new ApiError('השרת החזיר תשובה לא תקינה');
    }
    return data;
  };

  let data = await doRequest();
  if (opts.raw) return data;

  if (data && 'responseStatus' in data && data.responseStatus !== 'OK' && !opts.noRetry && !opts.noToken
      && looksLikeTokenProblem(data) && renewHandler) {
    const renewed = await renewHandler();
    if (renewed) data = await doRequest();
  }

  if (data && 'responseStatus' in data && data.responseStatus !== 'OK' && !opts.allowError) {
    throw new ApiError(data.message || 'השרת החזיר שגיאה', data);
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
  return `${API_BASE}/DownloadFile?token=${encodeURIComponent(settings.token)}&path=${encodeURIComponent(path)}`;
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
