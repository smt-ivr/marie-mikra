// ============================================================
//  yemot-paths.js — הכתובות (נתיבים) במערכת שהאתר עובד איתן (כמו במסכת של שבת)
//  נערכות בהגדרות הניהול. השרת מרשה פנייה רק לכתובות האלה (וכל מה שמתחתן),
//  לפי סוג השימוש: read = קריאה בלבד, write = קריאה ושינוי. כל כתובת אחרת נחסמת.
//  לכל כתובת "תחום" – לפיו נבדקת ההרשאה של המשתמש (צפייה / עריכה).
// ============================================================
import { badRequest, forbidden } from './http.js';

export const PATH_FIELDS = [
  { key: 'exam_ext', label: 'שלוחת המבחן', type: 'folder', access: 'write', area: 'tests', default: '1/1',
    hint: 'כוללת את המבחן הפעיל, קובץ התוצאות והשאלות, וחסימת המבחן (ext.ini)' },
  { key: 'active_test', label: 'קובץ תוצאות המבחן הפעיל', type: 'file', access: 'write', area: 'tests', default: '1/1/1/ExaminationAmericanLogOK.ymgr' },
  { key: 'archive_folder', label: 'תיקיית מבחנים קודמים', type: 'folder', access: 'write', area: 'tests', default: 'מבחנים-קודמים' },
  { key: 'import_source', label: 'מקור נוסף לייבוא שאלות', type: 'folder', access: 'read', area: 'tests', default: 'מבחנים-קודמים-תשפה' },
  { key: 'points_folder', label: 'תיקיית הנקודות', type: 'folder', access: 'write', area: 'points', default: 'Points',
    hint: 'כוללת את הדוח הפעיל (Split) ואת הדוחות הקודמים' },
  { key: 'points_report', label: 'דוח הנקודות', type: 'file', access: 'read', area: 'points', default: 'Points/Split/points_total.ymgr' },
  { key: 'students_file', label: 'קובץ התלמידים', type: 'file', access: 'write', area: 'students', default: 'EnterID/ListAllInformation.ini' },
  { key: 'times_file', label: 'קובץ הזמנים', type: 'file', access: 'write', area: 'times', default: 'ext.ini' },
  { key: 'logs_folder', label: 'תיקיית הלוגים', type: 'folder', access: 'read', area: 'logs', default: 'Log' },
];

export const DEFAULT_PATHS = Object.fromEntries(PATH_FIELDS.map((f) => [f.key, f.default]));

// "ivr2:/1/1/" → "1/1". כתובת עם .. או . נדחית
export function normalizePath(raw) {
  let p = String(raw ?? '').trim();
  try { p = decodeURIComponent(p); } catch { /* כבר מפוענח */ }
  p = p.replace(/\\/g, '/').replace(/^ivr2:/i, '').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  if (p.split('/').some((s) => s === '..' || s === '.')) return null;
  return p;
}

// הכתובות השמורות (או ברירת המחדל לכל מה שלא נשמר)
export function getPaths(json) {
  let saved = {};
  try { saved = typeof json === 'string' ? JSON.parse(json) : json || {}; } catch { saved = {}; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const out = {};
  for (const f of PATH_FIELDS) {
    const p = normalizePath(saved[f.key]);
    out[f.key] = p ? p : f.default;
  }
  return out;
}

// בדיקה ושמירה מהגדרות הניהול
export function validatePaths(input) {
  let obj;
  try { obj = typeof input === 'string' ? JSON.parse(input) : input; } catch { throw badRequest('הכתובות אינן תקינות'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw badRequest('הכתובות אינן תקינות');
  const out = {};
  for (const f of PATH_FIELDS) {
    const raw = String(obj[f.key] ?? '').trim();
    if (!raw) throw badRequest(`חסרה כתובת: ${f.label}`);
    const p = normalizePath(raw);
    if (p === null) throw badRequest(`כתובת לא תקינה (${f.label}): ${raw}`);
    if (p === '') throw badRequest(`${f.label}: אי אפשר להגדיר את כל המערכת (/). הגדירו שלוחה או קובץ מסוים`);
    out[f.key] = p;
  }
  return out;
}

// הכתובות → הרשאות גישה
export function rulesFromPaths(paths) {
  return [
    ...PATH_FIELDS.map((f) => ({ path: paths[f.key], access: f.access, area: f.area })),
    // דוח הנקודות מציג שמות תלמידים – קריאת קובץ התלמידים מותרת גם עם הרשאת נקודות
    { path: paths.students_file, access: 'read', area: 'points' },
  ];
}

const inside = (target, rule) => target === rule || target.startsWith(rule + '/');

// כל הכללים שהכתובת נמצאת בתוכם ומתאימים לסוג הגישה
function matching(rules, target, need) {
  return rules.filter((r) => inside(target, r.path) && (need === 'read' || r.access === 'write'));
}

// איזה פרמטר מכיל כתובת, ומה צריך עליה, לכל פעולה
function requirements(method, params) {
  const req = [];
  const add = (key, need) => { if (params[key] !== undefined && params[key] !== '') req.push([key, need]); };
  switch (method) {
    case 'GetTextFile': add('what', 'read'); break;
    case 'RenderYMGRFile': add('wath', 'read'); add('what', 'read'); break;
    case 'GetIVR2Dir': add('path', 'read'); break;
    case 'DownloadFile': add('path', 'read'); add('what', 'read'); break;
    case 'UploadTextFile': add('what', 'write'); break;
    case 'UploadFile': add('path', 'write'); add('what', 'write'); break;
    case 'UpdateExtension': add('path', 'write'); break;
    case 'FileAction':
      // העתקה: קריאה מהמקור וכתיבה ליעד. העברה / מחיקה / שינוי שם: כתיבה בשניהם
      add('what', params.action === 'copy' ? 'read' : 'write');
      add('target', 'write');
      break;
    default: break;
  }
  return req;
}

// פעולות שאינן על קבצים (שיחות, פרטי מערכת, אימות, צינתוקים) – בלי כתובת
export const PATHLESS = new Set(['GetIncomingCalls', 'GetCustomerData', 'MFASession', 'GetSession',
  'GetTasks', 'GetTasksData', 'GetTasksLogs', 'UpdateTask', 'TzintukimListManagement', 'RunTzintuk']);

/**
 * בודק שכל הכתובות בפנייה מורשות, ושיש למשתמש הרשאה לתחום שלהן.
 * hasPerm(perm) → boolean. זורק שגיאה אם משהו לא מורשה.
 */
export function enforcePaths(method, params, rules, hasPerm) {
  if (PATHLESS.has(method)) return [];
  const req = requirements(method, params);
  if (!req.length) throw forbidden('חסרה כתובת בפנייה');
  const checked = [];
  for (const [key, need] of req) {
    const target = normalizePath(params[key]);
    if (target === null) throw forbidden(`כתובת לא תקינה: ${params[key]}`);
    const hits = matching(rules, target, need);
    if (!hits.length) {
      throw forbidden(`הכתובת "${target || '/'}" לא מוגדרת בכתובות של האתר (${need === 'write' ? 'שינוי' : 'קריאה'}). אפשר לעדכן בהגדרות הניהול`);
    }
    const perm = (area) => `${area}_${need === 'write' ? 'edit' : 'view'}`;
    if (!hits.some((r) => hasPerm(perm(r.area)))) throw forbidden('אין לכם הרשאה לפעולה זו');
    checked.push(target);
  }
  return checked;
}
