// App shell, sign-in screens and hash router.
import { authState, refreshStatus, login, setup, logout, can, isMaster } from './core/auth.js';
import { getCustomerData, onServerEvent } from './core/api.js';
import { toast, loadingHtml, closeAllModals } from './core/ui.js';
import { esc, storageGet, storageSet, fmtNum } from './core/util.js';
import { runMfa } from './widgets/mfa.js';
import { startCalls } from './widgets/calls.js';
import { startMessages } from './widgets/message.js';

import * as dashboard from './views/dashboard.js';
import * as tests from './views/tests/index.js';
import * as points from './views/points.js';
import * as students from './views/students.js';
import * as times from './views/times.js';
import * as tzintuk from './views/tzintuk.js';
import * as logs from './views/logs.js';
import * as admin from './views/admin.js';

const LEGACY_URL = 'legacy/';
const LOGO_URL = 'https://smti.uk/smt.png';
// If the logo can't load, fall back to the built-in icon.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img?.classList?.contains('brand-logo') && !img.dataset.fallback) { img.dataset.fallback = '1'; img.src = 'assets/img/logo.svg'; }
}, true);

// `perm`: needed to see the item. `master`: only with the master password.
const NAV = [
  { route: '', label: 'סקירה כללית', icon: 'fa-gauge-high', mod: dashboard },
  { route: 'tests', label: 'מבחנים', icon: 'fa-clipboard-check', mod: tests, perm: 'tests_view' },
  { route: 'points', label: 'נקודות', icon: 'fa-star', mod: points, perm: 'points_view' },
  { route: 'students', label: 'תלמידים', icon: 'fa-users', mod: students, perm: 'students_view' },
  { route: 'times', label: 'זמנים', icon: 'fa-clock', mod: times, perm: 'times_view' },
  { route: 'tzintuk', label: 'צינתוקים', icon: 'fa-bell', mod: tzintuk, perm: 'tzintuk_view' },
  { route: 'logs', label: 'לוגים', icon: 'fa-file-lines', mod: logs, perm: 'logs_view' },
  { route: 'admin', label: 'ניהול', icon: 'fa-user-shield', mod: admin, master: true },
];
const allowed = (n) => (n.master ? isMaster() : !n.perm || can(n.perm));

const app = document.getElementById('app');
let cleanup = null;
let widgetsStarted = false;

// ---------------- Theme ----------------

function applyTheme(t) {
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme(storageGet('mm_theme'));
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  storageSet('mm_theme', next);
  applyTheme(next);
}

const legacyButton = (cls = '') => `<a class="btn btn-legacy ${cls}" href="${LEGACY_URL}" title="מעבר לממשק הקודם, ללא שינויים"><i class="fa-solid fa-clock-rotate-left"></i><span>לגרסה הישנה</span></a>`;
const brand = `<div class="brand"><img src="${LOGO_URL}" alt="S.M.T" class="brand-logo"><div><strong>מארי מקרא</strong><span>ממשק ניהול</span></div></div>`;
const credit = '<p class="credit">פיתוח מיוחד עבור ת"ת בת עין צפת · פותח בסייעתא דישמיא ע"י שימי טרייטל</p>';

// ---------------- Sign-in screens ----------------

function renderConnecting(text = 'מתחבר...') {
  app.innerHTML = `<div class="center-screen">${brand}${loadingHtml(text)}</div>`;
}

function loginScreen(inner) {
  app.innerHTML = `
    <div class="center-screen">
      <div class="login-card">${brand}${inner}<div class="login-foot">${legacyButton('btn-block')}</div></div>
      ${credit}
    </div>`;
}

const pwField = (name, label, autocomplete) => `<label class="field"><span>${label}</span>
  <span class="pw"><input class="input" name="${name}" type="password" dir="ltr" autocomplete="${autocomplete}" required>
  <button type="button" class="icon-btn pw-eye" aria-label="הצגה"><i class="fa-solid fa-eye"></i></button></span></label>`;

function wireEyes(root) {
  root.querySelectorAll('.pw-eye').forEach((b) => (b.onclick = () => {
    const i = b.previousElementSibling;
    i.type = i.type === 'password' ? 'text' : 'password';
    b.firstElementChild.className = `fa-solid ${i.type === 'password' ? 'fa-eye' : 'fa-eye-slash'}`;
  }));
}

function bindForm(form, action) {
  const err = form.querySelector('.field-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    err.hidden = true;
    try {
      await action(form);
    } catch (er) {
      err.textContent = er.message;
      err.hidden = false;
      btn.disabled = false;
    }
  };
}

/** Nothing configured yet: register with the token and choose the master password. */
function renderSetup() {
  loginScreen(`
    <h2 class="login-title">הגדרה ראשונית</h2>
    <p class="muted small">מזינים את הטוקן פעם אחת בלבד, ובוחרים סיסמת מאסטר. סיסמת המאסטר היא היחידה שנכנסת לניהול: יצירת סיסמאות נוספות, הגדרת כתובות IP מורשות והגבלת הרשאות.</p>
    <form class="form" id="setup-form" autocomplete="off">
      ${pwField('token', 'טוקן', 'off')}
      ${pwField('pw1', 'סיסמת מאסטר (לפחות 6 תווים)', 'new-password')}
      ${pwField('pw2', 'אימות סיסמת המאסטר', 'new-password')}
      <p class="field-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit"><i class="fa-solid fa-check"></i> שמירה וכניסה</button>
    </form>`);
  const form = app.querySelector('#setup-form');
  wireEyes(form);
  bindForm(form, async (f) => {
    if (f.pw1.value !== f.pw2.value) throw new Error('הסיסמאות אינן זהות.');
    if (f.pw1.value.length < 6) throw new Error('הסיסמה חייבת להכיל לפחות 6 תווים.');
    await setup(f.token.value.trim(), f.pw1.value);
    toast('ההגדרה הושלמה. שמרו את סיסמת המאסטר במקום בטוח.', 'success', 8000);
    await boot();
  });
  setTimeout(() => form.token.focus(), 50);
}

/** Sign-in with a password only. */
function renderLogin(message = '') {
  loginScreen(`
    ${message ? `<div class="alert alert-danger small">${esc(message)}</div>` : ''}
    <form class="form" id="login-form" autocomplete="on">
      <input type="text" name="username" value="marie-mikra" autocomplete="username" hidden>
      ${pwField('password', 'סיסמה', 'current-password')}
      <p class="field-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit"><i class="fa-solid fa-right-to-bracket"></i> כניסה</button>
    </form>`);
  const form = app.querySelector('#login-form');
  wireEyes(form);
  bindForm(form, async (f) => { await login(f.password.value); await boot(); });
  setTimeout(() => form.password.focus(), 50);
}

/** Signed in, but the connection needs attention. */
function renderConnectionProblem(conn) {
  const master = isMaster();
  const isMfa = conn?.status === 'mfa';
  loginScreen(`
    <div class="alert alert-warning small">${esc(conn?.message || 'אין חיבור למערכת.')}</div>
    ${isMfa ? '<button class="btn btn-primary btn-block" id="do-mfa"><i class="fa-solid fa-shield-halved"></i> ביצוע אימות</button>'
      : master ? '<p class="muted small">יש להזין טוקן חדש בניהול.</p><button class="btn btn-primary btn-block" id="go-admin"><i class="fa-solid fa-user-shield"></i> מעבר לניהול</button>'
        : '<p class="muted small">פנו למנהל הראשי כדי לחדש את החיבור.</p>'}
    <button class="btn btn-ghost btn-block" id="retry"><i class="fa-solid fa-rotate"></i> ניסיון נוסף</button>
    <button class="btn btn-ghost btn-block" id="do-logout">יציאה</button>`);
  const mfa = app.querySelector('#do-mfa');
  if (mfa) mfa.onclick = async () => { if (await runMfa()) boot(); };
  const ga = app.querySelector('#go-admin');
  if (ga) ga.onclick = () => { location.hash = '#/admin'; renderShell(); route(); };
  app.querySelector('#retry').onclick = () => boot();
  app.querySelector('#do-logout').onclick = async () => { await logout().catch(() => {}); boot(); };
}

// ---------------- Shell ----------------

function renderShell() {
  const p = authState.principal;
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        ${brand}
        <nav class="nav">${NAV.filter(allowed).map((n) => `<a href="#/${n.route}" data-route="${n.route}"><i class="fa-solid ${n.icon}"></i><span>${n.label}</span></a>`).join('')}</nav>
        <div class="sidebar-foot">
          <div class="who"><i class="fa-solid ${p.master ? 'fa-user-shield' : p.via === 'ip' ? 'fa-network-wired' : 'fa-circle-user'}"></i><span>${esc(p.label)}</span>
            ${p.via === 'ip' ? '' : '<button class="icon-btn" id="logout-btn" title="יציאה"><i class="fa-solid fa-right-from-bracket"></i></button>'}</div>
          ${legacyButton('btn-block')}
          <p class="credit">פיתוח מיוחד עבור ת"ת בת עין צפת<br>פותח בסייעתא דישמיא ע"י שימי טרייטל</p>
        </div>
      </aside>
      <div class="sidebar-backdrop" id="backdrop"></div>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menu-btn" aria-label="תפריט"><i class="fa-solid fa-bars"></i></button>
          <div class="sysinfo" id="sysinfo"></div>
          <div class="topbar-spacer"></div>
          <button class="topbar-btn calls-btn" id="calls-btn" hidden title="שיחות פעילות"><i class="fa-solid fa-phone-volume"></i><span class="calls-n">0</span></button>
          <button class="icon-btn bell-btn" id="bell-btn" hidden title="הודעת מערכת"><i class="fa-solid fa-bullhorn"></i></button>
          <button class="icon-btn" id="theme-btn" title="מצב כהה / בהיר"><i class="fa-solid fa-circle-half-stroke"></i></button>
          ${legacyButton('topbar-legacy')}
        </header>
        <main class="content" id="view"></main>
      </div>
    </div>`;
  app.querySelector('#theme-btn').onclick = toggleTheme;
  const lo = app.querySelector('#logout-btn');
  if (lo) lo.onclick = async () => { await logout().catch(() => {}); location.hash = '#/'; boot(); };
  const sidebar = app.querySelector('#sidebar');
  app.querySelector('#menu-btn').onclick = () => sidebar.classList.toggle('open');
  app.querySelector('#backdrop').onclick = () => sidebar.classList.remove('open');
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) sidebar.classList.remove('open'); });

  getCustomerData().then((d) => {
    const units = parseFloat(d.units || 0);
    app.querySelector('#sysinfo').innerHTML = `<strong>${esc(d.name || 'מערכת')}</strong><span dir="ltr">${esc(d.mainDid || '')}</span>
      <span class="${units < 10 ? 'bad' : ''}">${fmtNum(units, 1)} יחידות</span>`;
  }).catch(() => {});

  if (!widgetsStarted) {
    widgetsStarted = true;
    startCalls(app.querySelector('#calls-btn'));
    startMessages(app.querySelector('#bell-btn'));
  }
}

// ---------------- Router ----------------

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = h.split('?');
  const [route = '', sub = ''] = pathPart.split('/');
  return { route, sub, query: new URLSearchParams(queryPart) };
}

function route() {
  const view = document.getElementById('view');
  if (!view) return;
  const { route: r, sub, query } = parseHash();
  let entry = NAV.find((n) => n.route === r) || NAV[0];
  if (!allowed(entry)) entry = NAV[0];
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === entry.route));
  document.title = `${entry.label} · מארי מקרא`;
  closeAllModals();
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const host = document.createElement('div');
  host.className = 'view';
  view.replaceChildren(host);
  window.scrollTo(0, 0);
  try {
    const c = entry.mod.mount(host, { route: entry.route, sub, query, reconnect: boot, logout: async () => { await logout().catch(() => {}); boot(); } });
    cleanup = typeof c === 'function' ? c : null;
  } catch (e) {
    console.error(e);
    host.innerHTML = `<div class="state state-error"><i class="fa-solid fa-bug"></i><p>${esc(e.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------------- Boot ----------------

let booting = null;
async function boot() {
  if (booting) return booting;
  booting = (async () => {
    renderConnecting();
    const st = await refreshStatus();
    if (st.error) { renderLogin(st.error); return; }
    if (!st.configured) { renderSetup(); return; }
    if (!st.loggedIn) { if (widgetsStarted) { location.reload(); return; } renderLogin(); return; }
    const conn = st.connection || {};
    if (conn.status === 'ok') { renderShell(); route(); return; }
    if (conn.status === 'mfa') { renderConnectionProblem(conn); if (await runMfa()) { booting = null; boot(); } return; }
    // expired / error: the master may still open the admin panel to fix the token
    if (isMaster() && location.hash.startsWith('#/admin')) { renderShell(); route(); return; }
    renderConnectionProblem(conn);
  })();
  try { await booting; } finally { booting = null; }
}

onServerEvent('unauthorized', () => { toast('פג תוקף הכניסה, יש להיכנס מחדש.', 'warning'); boot(); });
onServerEvent('relink', (msg) => { toast(msg, 'error', 9000); });

boot();
