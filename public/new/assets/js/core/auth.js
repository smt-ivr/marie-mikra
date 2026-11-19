// Sign-in is shared with the original site: same server, same users and permissions
// (see src/api). Signing in happens on the main page (/marie-mikra/).
import { server } from './api.js';

export const LOGIN_URL = '/marie-mikra/';
export const ADMIN_URL = '/marie-mikra/admin';

export const authState = {
  loggedIn: false,
  principal: null,   // { label, master, perms[], via }
  paths: null,
  error: '',
};

/** Does the signed-in user have this permission? (edit implies view – resolved by the server) */
export function can(perm) {
  const p = authState.principal;
  return !!p && (p.master || p.perms.includes(perm));
}
export const isMaster = () => !!authState.principal?.master;

export async function refreshStatus() {
  authState.error = '';
  try {
    const me = await server('auth/me');
    const u = me.user;
    authState.loggedIn = true;
    authState.principal = { label: u.name, master: !!u.is_admin, perms: u.permissions || [], via: u.method };
    const cfg = await server('config').catch(() => ({ paths: null }));
    authState.paths = cfg.paths;
  } catch (e) {
    authState.loggedIn = false;
    if (e.status !== 401) authState.error = e.message;
  }
  return authState;
}

export const logout = () => server('auth/logout', { method: 'POST', body: {} });
