// ============================================================
//  settings.js — הגדרות המערכת, שמורות במסד (mm_settings) ולא במשתני סביבה
//  טוקן, Google, ומייל (Resend). נערכות בדף הניהול (כמו במסכת של שבת).
//  ערכים סודיים לא חוזרים לדפדפן – רק האם הם מוגדרים וארבע הספרות האחרונות.
// ============================================================
import { badRequest, israelNow } from './http.js';
import { DEFAULT_PATHS, PATH_FIELDS, validatePaths } from './yemot-paths.js';

export const DEFAULT_WELCOME = {
  welcome_subject: 'פרטי כניסה למערכת מארי מקרא',
  welcome_title: 'נפתח לכם חשבון במערכת מארי מקרא',
  welcome_body: 'שלום {שם},\n\nנפתח עבורכם חשבון במערכת הניהול של מארי מקרא. הכניסה היא בסיסמה בלבד.\n\nאלה פרטי הכניסה שלכם:',
  welcome_button: 'כניסה למערכת',
  welcome_note: 'מומלץ לשמור את המייל הזה במקום בטוח ולא להעביר את הסיסמה לאחרים.',
};

// מפתח → [אורך מרבי, סודי?]
const FIELDS = {
  yemot_token: [300, true],
  google_enabled: [1, false],
  google_client_id: [200, false],
  resend_api_key: [200, true],
  mail_from: [200, false],
  site_url: [300, false],
  welcome_subject: [200, false],
  welcome_title: [200, false],
  welcome_body: [4000, false],
  welcome_button: [60, false],
  welcome_note: [1000, false],
  yemot_paths: [20000, false],
};

const DEFAULTS = {
  google_enabled: '0',
  mail_from: 'מארי מקרא <marie-mikra@smti.uk>',
  site_url: 'https://smti.uk/marie-mikra/',
  yemot_paths: JSON.stringify(DEFAULT_PATHS),
  ...DEFAULT_WELCOME,
};

let cache = null;

export function clearSettingsCache() {
  cache = null;
}

export async function getConfig(env) {
  if (cache && cache.at > Date.now() - 30000) return cache.values;
  const { results } = await env.DB.prepare('SELECT key, value FROM mm_settings').all();
  const saved = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const values = {};
  for (const k of Object.keys(FIELDS)) {
    const v = saved[k];
    values[k] = v !== undefined && v !== null && v !== '' ? v : DEFAULTS[k] ?? '';
  }
  values.google_enabled = values.google_enabled === '1';
  cache = { at: Date.now(), values };
  return values;
}

// לדף הניהול – בלי הערכים הסודיים עצמם
export async function publicSettings(env) {
  const c = await getConfig(env);
  const out = { defaults: DEFAULT_WELCOME, yemot_path_fields: PATH_FIELDS };
  for (const [k, [, secret]] of Object.entries(FIELDS)) {
    if (secret) {
      out[`${k}_set`] = !!c[k];
      out[`${k}_hint`] = c[k] ? `••••${String(c[k]).slice(-4)}` : '';
    } else {
      out[k] = c[k];
    }
  }
  return out;
}

// עדכון: שדה סודי ריק = ללא שינוי; clear: [מפתחות] = מחיקה
const LABELS = {
  yemot_token: 'טוקן',
  google_enabled: 'כניסה עם Google', google_client_id: 'Google Client ID', resend_api_key: 'מפתח Resend',
  mail_from: 'שולח המייל', site_url: 'כתובת האתר', welcome_subject: 'נושא מייל הפתיחה', welcome_title: 'כותרת מייל הפתיחה',
  welcome_body: 'גוף מייל הפתיחה', welcome_button: 'כפתור מייל הפתיחה', welcome_note: 'הערת מייל הפתיחה',
  yemot_paths: 'כתובות במערכת',
};

// מחזיר רק את מה שבאמת השתנה – לתיעוד ביומן הפעולות
export async function updateSettings(env, body) {
  const now = israelNow();
  const stmts = [];
  const changed = [];
  const { results } = await env.DB.prepare('SELECT key, value FROM mm_settings').all();
  const saved = Object.fromEntries(results.map((r) => [r.key, r.value]));
  for (const [k, [max, secret]] of Object.entries(FIELDS)) {
    if (body[k] === undefined) continue;
    let v = k === 'google_enabled' ? (body[k] ? '1' : '0') : String(body[k] ?? '').slice(0, max);
    if (k === 'yemot_paths') v = JSON.stringify(validatePaths(body[k]));
    if (k !== 'welcome_body' && k !== 'welcome_note') v = v.trim();
    if (secret && !v) continue;
    if (k === 'resend_api_key' && !/^re_[\w-]{10,}$/.test(v)) throw badRequest('מפתח Resend אמור להתחיל ב-re_');
    if (k === 'site_url' && v && !/^https:\/\//.test(v)) throw badRequest('כתובת האתר חייבת להתחיל ב-https://');
    const before = saved[k] !== undefined && saved[k] !== null && saved[k] !== '' ? saved[k] : DEFAULTS[k] ?? '';
    if (v === before) continue;
    stmts.push(
      env.DB.prepare(
        'INSERT INTO mm_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      ).bind(k, v, now),
    );
    changed.push(LABELS[k] || k);
  }
  for (const k of Array.isArray(body.clear) ? body.clear : []) {
    if (FIELDS[k]) {
      stmts.push(env.DB.prepare('DELETE FROM mm_settings WHERE key = ?').bind(k));
      changed.push(`${LABELS[k] || k} (נמחק)`);
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  cache = null;
  return changed;
}

export function fillTemplate(text, vars) {
  return String(text || '').replace(/\{([^{}]+)\}/g, (m, k) => (vars[k.trim()] !== undefined ? vars[k.trim()] : m));
}
