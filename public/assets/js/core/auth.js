// Sign-in to the new interface (handled by our server, see src/server.js).
import { server } from './api.js';
import { storageGet, storageSet } from './util.js';

export const authState = {
  loggedIn: false,
  username: '',
  status: 'pending', // pending | ok | mfa | relink | error | none
  message: '',
  encrypted: false,
};

export const lastUsername = {
  get: () => storageGet('mm_last_user', '') || '',
  set: (u) => storageSet('mm_last_user', u || null),
};

/** Ask the server who we are and how the Yemot connection looks. */
export async function refreshStatus() {
  authState.status = 'pending';
  try {
    const r = await server('auth/status');
    authState.loggedIn = !!r.loggedIn;
    authState.username = r.username || '';
    authState.encrypted = !!r.encrypted;
    if (!r.loggedIn) { authState.status = 'none'; authState.message = ''; }
    else { authState.status = r.yemot?.status || 'error'; authState.message = r.yemot?.message || ''; }
  } catch (e) {
    authState.loggedIn = false;
    authState.status = 'error';
    authState.message = e.message;
  }
  return authState;
}

export async function login(username, password) {
  await server('auth/login', { method: 'POST', body: { username, password } });
  lastUsername.set(username);
}

/** First sign-in / forgot password: proven with the Yemot password. */
export async function setup(username, yemotPassword, newPassword) {
  await server('auth/setup', { method: 'POST', body: { username, yemotPassword, newPassword } });
  lastUsername.set(username);
}

export const logout = () => server('auth/logout', { method: 'POST', body: {} });
export const logoutAll = () => server('auth/logout-all', { method: 'POST', body: {} });
export const changePassword = (current, next) => server('auth/password', { method: 'POST', body: { current, next } });
export const relinkYemot = (yemotPassword) => server('auth/yemot', { method: 'POST', body: { yemotPassword } });
