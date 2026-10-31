// Login, token verification and automatic token renewal (same flow as the old version).
import { call, onTokenExpired } from './api.js';
import { settings } from './settings.js';

const PASS_REASONS = {
  IS_CUSTOMER_AUTH_TOKEN: 'משתמש עם טוקן קבוע',
  INIT_WHITELIST_IPS: 'כתובת IP ברשימה לבנה',
  INIT_MASTER_LOGIN_WHITELIST_IPS: 'התחברות מאסטר',
  HAVE_ACTIVE_TRUST_TOKEN: 'מכשיר מוכר ("זכור אותי")',
  INHERITED_FROM_ORIGINAL_SESSION: 'ירושה מסשן קודם',
  MFA_PASSED: 'בוצע אימות דו-שלבי',
  SPECIAL_VALID_TOKEN: 'טוקן עם פטור מיוחד',
};

export const authState = {
  status: 'pending', // pending | ok | mfa | error | none
  message: '',
};

export async function login(username, password) {
  if (!username || !password) throw new Error('יש להזין מספר מערכת וסיסמה.');
  const data = await call('Login', { username, password }, { noToken: true, allowError: true });
  if (data.responseStatus === 'OK' && data.token) return data.token;
  throw new Error(data.message || 'מספר מערכת או סיסמה שגויים.');
}

/** Returns {status:'ok'|'mfa'|'error', message}. */
export async function verifyToken(token) {
  if (!token) return { status: 'error', message: 'לא נמצא טוקן.' };
  try {
    const isPass = await call('MFASession', { token, action: 'isPass' }, { noToken: true, allowError: true });
    if (isPass.responseStatus !== 'OK') return { status: 'error', message: isPass.message || 'הטוקן אינו תקף.' };
    if (isPass.isPass) return { status: 'ok', message: PASS_REASONS[isPass.passReason] || isPass.passReason || 'מאומת' };
    const tryRes = await call('MFASession', { token, action: 'try' }, { noToken: true, allowError: true });
    if (tryRes.responseStatus === 'OK' && tryRes.isPass) {
      return { status: 'ok', message: PASS_REASONS[tryRes.passReason] || tryRes.passReason || 'מאומת' };
    }
    return { status: 'mfa', message: 'נדרש אימות דו-שלבי.' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Establish a working connection using the stored token, renewing it with the
 * stored credentials when needed. Updates authState and returns it.
 */
export async function connect({ allowRenew = true } = {}) {
  authState.status = 'pending';
  let token = settings.token;
  const canRenew = allowRenew && settings.username && settings.password;

  if (!token) {
    if (!canRenew) return set('none', 'לא מחובר. יש להתחבר עם מספר מערכת וסיסמה.');
    try {
      token = await login(settings.username, settings.password);
      settings.token = token;
    } catch (e) {
      return set('error', `יצירת טוקן אוטומטית נכשלה: ${e.message}`);
    }
  }

  let v = await verifyToken(token);
  if (v.status === 'error' && canRenew) {
    try {
      token = await login(settings.username, settings.password);
      settings.token = token;
      v = await verifyToken(token);
    } catch (e) {
      return set('error', `חידוש הטוקן נכשל: ${e.message}`);
    }
  }
  return set(v.status, v.message);
}

function set(status, message) {
  authState.status = status;
  authState.message = message;
  return authState;
}

// Renew silently when an API call reports an expired token.
let renewing = null;
onTokenExpired(async () => {
  if (!settings.username || !settings.password) return false;
  if (!renewing) {
    renewing = (async () => {
      try {
        settings.token = await login(settings.username, settings.password);
        const v = await verifyToken(settings.token);
        return v.status === 'ok';
      } catch {
        return false;
      } finally {
        setTimeout(() => { renewing = null; }, 0);
      }
    })();
  }
  return renewing;
});
