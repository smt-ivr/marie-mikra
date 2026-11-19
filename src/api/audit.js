// ============================================================
//  audit.js — יומן פעולות: כל פעולה במערכת נרשמת עם המשתמש, הכתובת והזמן
//  kind: read (קריאה) / write (שינוי) / admin (ניהול) / auth (כניסה ויציאה)
// ============================================================
import { clientIp, israelNow } from './http.js';

// פרמטרים שלעולם לא נשמרים ביומן
const SECRET_KEYS = /^(token|apipassword|password|password_hash|password_salt|resend_api_key|yemot_token|nedarim_api_password|credential)$/i;

export function safeDetails(obj, maxLen = 300) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (SECRET_KEYS.test(k)) continue;
    if (v instanceof File || (v && typeof v === 'object' && 'size' in v && 'name' in v)) {
      out[k] = `[קובץ ${v.name || ''} ${v.size || 0} bytes]`;
      continue;
    }
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    out[k] = s && s.length > maxLen ? `${s.slice(0, maxLen)}… (${s.length} תווים)` : s;
  }
  return out;
}

export async function logAction(env, request, ctx, { kind, action, target = '', details = null, status = 'ok' }) {
  try {
    await env.DB.prepare(
      'INSERT INTO mm_action_log (created_at, account_id, account_name, ip, kind, action, target, details, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        israelNow(),
        ctx?.account?.id || null,
        ctx?.account?.display_name || null,
        clientIp(request),
        kind,
        action,
        String(target || '').slice(0, 300),
        details ? JSON.stringify(details).slice(0, 4000) : null,
        String(status || '').slice(0, 200),
      )
      .run();
  } catch (e) {
    console.error('audit log failed:', e);
  }
}
