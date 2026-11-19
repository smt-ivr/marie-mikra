// ============================================================
//  permissions.js — הרשאות משתמש (כמו במסכת של שבת)
//  לכל משתמש רשימת הרשאות. "ניהול המערכת" (is_admin) כולל את כולן.
//  השרת חוסם כל פעולה שאין לה הרשאה – האתר רק מסתיר את הכפתורים.
// ============================================================
import { forbidden } from './http.js';

export const PERMISSIONS = {
  tests_view: 'צפייה במבחנים',
  tests_edit: 'ניהול מבחנים וציונים',
  points_view: 'צפייה בנקודות',
  points_edit: 'עריכת נקודות',
  students_view: 'צפייה בתלמידים',
  students_edit: 'עריכת תלמידים',
  times_view: 'צפייה בזמנים',
  times_edit: 'עריכת זמנים',
  tzintuk_view: 'צפייה בצינתוקים',
  tzintuk_edit: 'הפעלת וניהול צינתוקים',
  logs_view: 'צפייה בלוגים',
  new_site: 'ממשק חדש',
  self_password: 'יצירת והחלפת סיסמה אישית',
  admin: 'ניהול המערכת',
};

// ברירת מחדל למשתמש חדש: כל העבודה באתר, בלי ניהול המערכת ובלי ניהול סיסמה אישית
export const DEFAULT_PERMISSIONS = Object.keys(PERMISSIONS).filter((p) => p !== 'admin' && p !== 'self_password');

export function permissionsOf(account) {
  if (!account) return [];
  if (account.is_admin) return Object.keys(PERMISSIONS);
  let list = [];
  try { list = JSON.parse(account.permissions || '[]'); } catch { list = []; }
  const set = new Set(list.filter((p) => p !== 'admin' && PERMISSIONS[p]));
  // עריכה כוללת צפייה
  for (const p of [...set]) if (p.endsWith('_edit')) set.add(p.replace('_edit', '_view'));
  return [...set];
}

export function cleanPermissions(input) {
  return [...new Set((Array.isArray(input) ? input : []).filter((p) => p !== 'admin' && PERMISSIONS[p]))];
}

export const can = (ctx, perm) => permissionsOf(ctx?.account).includes(perm);

export function requirePermission(ctx, perm) {
  if (!can(ctx, perm)) throw forbidden(`אין לכם הרשאה: ${PERMISSIONS[perm] || perm}`);
}

export function requireAnyPermission(ctx, perms) {
  if (!perms.some((p) => can(ctx, p))) throw forbidden(`אין לכם הרשאה: ${perms.map((p) => PERMISSIONS[p]).join(' / ')}`);
}
