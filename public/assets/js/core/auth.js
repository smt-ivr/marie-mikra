// Sign-in to the new interface (handled by our server, see src/server.js).
import { server } from './api.js';

export const authState = {
  configured: true,
  loggedIn: false,
  principal: null,   // { label, master, perms[], via }
  paths: null,
  connection: null,  // { status: ok|mfa|expired|error, message }
  error: '',
};

/** Does the signed-in user have this permission? (edit implies view) */
export function can(perm) {
  const p = authState.principal;
  if (!p) return false;
  if (p.master) return true;
  if (p.perms.includes(perm)) return true;
  return perm.endsWith('_view') && p.perms.includes(perm.replace('_view', '_edit'));
}
export const isMaster = () => !!authState.principal?.master;

export async function refreshStatus() {
  authState.error = '';
  try {
    const r = await server('auth/status');
    authState.configured = r.configured !== false;
    authState.loggedIn = !!r.loggedIn;
    authState.principal = r.principal || null;
    authState.paths = r.paths || null;
    authState.connection = r.connection || null;
  } catch (e) {
    authState.loggedIn = false;
    authState.error = e.message;
  }
  return authState;
}

export const setup = (token, password) => server('auth/setup', { method: 'POST', body: { token, password } });
export const login = (password) => server('auth/login', { method: 'POST', body: { password } });
export const logout = () => server('auth/logout', { method: 'POST', body: {} });
