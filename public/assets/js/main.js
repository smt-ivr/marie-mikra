// App shell, login screen and hash router.
import { authState, refreshStatus, login, setup, logout, relinkYemot, lastUsername } from './core/auth.js';
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
import * as settingsView from './views/settings.js';

const LEGACY_URL = 'legacy/';
const LOGO_URL = 'https://smti.uk/smt.png';
// If the logo can't load, fall back to the built-in icon.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img?.classList?.contains('brand-logo') && !img.dataset.fallback) { img.dataset.fallback = '1'; img.src = 'assets/img/logo.svg'; }
}, true);

const NAV = [
  { route: '', label: 'סקירה כללית', icon: 'fa-gauge-high', mod: dashboard },
  { route: 'tests', label: 'מבחנים', icon: 'fa-clipboard-check', mod: tests },
  { route: 'points', label: 'נקודות', icon: 'fa-star', mod: points },
  { route: 'students', label: 'תלמידים', icon: 'fa-users', mod: students },
  { route: 'times', label: 'זמנים', icon: 'fa-clock', mod: times },
  { route: 'tzintuk', label: 'צינתוקים', icon: 'fa-bell', mod: tzintuk },
  { route: 'logs', label: 'לוגים', icon: 'fa-file-lines', mod: logs },
  { route: 'settings', label: 'הגדרות', icon: 'fa-gear', mod: settingsView },
];

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

// ---------------- Screens ----------------

function renderConnecting(text = 'מתחבר למערכת...') {
  app.innerHTML = `<div class="center-screen">${brand}${loadingHtml(text)}</div>`;
}

const credit = '<p class="credit">פיתוח מיוחד עבור ת"ת בת עין צפת · פותח בסייעתא דישמיא ע"י שימי טרייטל</p>';

function loginScreen(inner) {
  app.innerHTML = `
    <div class="center-screen">
      <div class="login-card">
        ${brand}
        ${inner}
        <div class="login-foot">${legacyButton('btn-block')}</div>
      </div>
      ${credit}
    </div>`;
}

const pwField = (name, label, autocomplete) => `<label class="field"><span>${label}</span>
  <span class="pw"><input class="input" name="${name}" type="password" dir="ltr" autocomplete="${autocomplete}" required>
  <button type="button" class="icon-btn pw-eye" aria-label="הצגת סיסמה"><i class="fa-solid fa-eye"></i></button></span></label>`;

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

/** Normal sign-in: system number + interface password. */
function renderLogin(message = '') {
  loginScreen(`
    ${message ? `<div class="alert alert-danger small">${esc(message)}</div>` : ''}
    <form class="form" id="login-form" autocomplete="on">
      <label class="field"><span>מספר מערכת</span><input class="input" name="username" dir="ltr" inputmode="numeric" autocomplete="username" value="${esc(lastUsername.get())}" required></label>
      ${pwField('password', 'סיסמת הממשק', 'current-password')}
      <p class="field-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit"><i class="fa-solid fa-right-to-bracket"></i> התחברות</button>
    </form>
    <button class="btn btn-ghost btn-block" id="go-setup"><i class="fa-solid fa-key"></i> כניסה ראשונה / שכחתי סיסמה</button>`);
  const form = app.querySelector('#login-form');
  wireEyes(form);
  bindForm(form, async (f) => { await login(f.username.value.trim(), f.password.value); await boot(); });
  app.querySelector('#go-setup').onclick = () => renderSetup(form.username.value.trim());
  setTimeout(() => (form.username.value ? form.password : form.username).focus(), 50);
}

/** First sign-in or forgotten password: prove ownership with the Yemot password. */
function renderSetup(username = '') {
  loginScreen(`
    <h2 class="login-title">כניסה ראשונה / איפוס סיסמה</h2>
    <p class="muted small">מזינים פעם אחת את סיסמת הניהול של ימות המשיח, ובוחרים סיסמה לממשק. סיסמת ימות נשמרת בשרת בלבד, כדי לחדש את החיבור אוטומטית.</p>
    <form class="form" id="setup-form" autocomplete="off">
      <label class="field"><span>מספר מערכת</span><input class="input" name="username" dir="ltr" inputmode="numeric" autocomplete="username" value="${esc(username || lastUsername.get())}" required></label>
      ${pwField('yemot', 'סיסמת ניהול של ימות המשיח', 'off')}
      ${pwField('pw1', 'סיסמה חדשה לממשק (לפחות 6 תווים)', 'new-password')}
      ${pwField('pw2', 'אימות הסיסמה החדשה', 'new-password')}
      <p class="field-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit"><i class="fa-solid fa-check"></i> שמירה וכניסה</button>
    </form>
    <button class="btn btn-ghost btn-block" id="go-login"><i class="fa-solid fa-arrow-right"></i> חזרה להתחברות</button>`);
  const form = app.querySelector('#setup-form');
  wireEyes(form);
  bindForm(form, async (f) => {
    if (f.pw1.value !== f.pw2.value) throw new Error('הסיסמאות החדשות אינן זהות.');
    if (f.pw1.value.length < 6) throw new Error('סיסמת הממשק חייבת להכיל לפחות 6 תווים.');
    await setup(f.username.value.trim(), f.yemot.value, f.pw1.value);
    toast('הסיסמה נשמרה. מעכשיו נכנסים עם מספר המערכת וסיסמת הממשק.', 'success', 7000);
    await boot();
  });
  app.querySelector('#go-login').onclick = () => renderLogin();
}

/** Signed in, but the server can no longer renew the Yemot token by itself. */
function renderRelink(message = '') {
  loginScreen(`
    <h2 class="login-title">חידוש החיבור לימות המשיח</h2>
    <div class="alert alert-warning small">${esc(message || 'נדרשת סיסמת ימות המשיח כדי לחדש את החיבור.')}</div>
    <form class="form" id="relink-form" autocomplete="off">
      ${pwField('yemot', 'סיסמת ניהול של ימות המשיח', 'off')}
      <p class="field-error" hidden></p>
      <button class="btn btn-primary btn-block" type="submit"><i class="fa-solid fa-plug"></i> חידוש החיבור</button>
    </form>
    <button class="btn btn-ghost btn-block" id="do-logout">התנתקות</button>`);
  const form = app.querySelector('#relink-form');
  wireEyes(form);
  bindForm(form, async (f) => { await relinkYemot(f.yemot.value); await boot(); });
  app.querySelector('#do-logout').onclick = async () => { await logout().catch(() => {}); boot(); };
}

/** Signed in, Yemot asks for two-step verification. */
function renderMfaNeeded(message = '') {
  loginScreen(`
    <div class="alert alert-warning small">${esc(message || 'ימות המשיח דורש אימות דו-שלבי.')}</div>
    <button class="btn btn-primary btn-block" id="do-mfa"><i class="fa-solid fa-shield-halved"></i> ביצוע אימות</button>
    <button class="btn btn-ghost btn-block" id="do-logout">התנתקות</button>`);
  app.querySelector('#do-mfa').onclick = async () => { if (await runMfa()) boot(); };
  app.querySelector('#do-logout').onclick = async () => { await logout().catch(() => {}); boot(); };
}

function renderShell() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        ${brand}
        <nav class="nav">${NAV.map((n) => `<a href="#/${n.route}" data-route="${n.route}"><i class="fa-solid ${n.icon}"></i><span>${n.label}</span></a>`).join('')}</nav>
        <div class="sidebar-foot">
          <div class="who"><i class="fa-solid fa-circle-user"></i><span dir="ltr">${esc(authState.username)}</span>
            <button class="icon-btn" id="logout-btn" title="התנתקות"><i class="fa-solid fa-right-from-bracket"></i></button></div>
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
  app.querySelector('#logout-btn').onclick = async () => { await logout().catch(() => {}); location.hash = '#/'; boot(); };
  const sidebar = app.querySelector('#sidebar');
  app.querySelector('#menu-btn').onclick = () => sidebar.classList.toggle('open');
  app.querySelector('#backdrop').onclick = () => sidebar.classList.remove('open');
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) sidebar.classList.remove('open'); });

  getCustomerData().then((d) => {
    const units = parseFloat(d.units || 0);
    app.querySelector('#sysinfo').innerHTML = `<strong>${esc(d.name || 'מערכת')}</strong><span dir="ltr">${esc(d.mainDid || '')}</span>
      <span class="${units < 10 ? 'bad' : ''}">${fmtNum(units, 1)} יחידות</span>`;
    app.querySelector('#sysinfo').title = `שם המערכת: ${d.name || ''}\nמספר ראשי: ${d.mainDid || ''}\nאימייל: ${d.email || ''}\nמשווק: ${d.resellerCreditFile || '-'}\nשרת: ${d.systemSite || '-'}`;
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
  const entry = NAV.find((n) => n.route === r) || NAV[0];
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
    if (!st.loggedIn) { widgetsStarted && location.reload(); renderLogin(st.status === 'error' ? st.message : ''); return; }
    if (st.status === 'ok') { renderShell(); route(); return; }
    if (st.status === 'mfa') { renderMfaNeeded(st.message); if (await runMfa()) { booting = null; boot(); } return; }
    if (st.status === 'relink') { renderRelink(st.message); return; }
    renderLogin(st.message);
  })();
  try { await booting; } finally { booting = null; }
}

// The server says the session ended / Yemot needs the password again.
onServerEvent('unauthorized', () => { toast('פג תוקף ההתחברות, יש להתחבר מחדש.', 'warning'); boot(); });
onServerEvent('relink', (msg) => renderRelink(msg));

boot();
