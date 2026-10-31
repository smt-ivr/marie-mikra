// App shell, login screen and hash router.
import { settings, absorbUrlParams } from './core/settings.js';
import { connect, login, authState } from './core/auth.js';
import { getCustomerData } from './core/api.js';
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

const brand = `<div class="brand"><img src="assets/img/logo.svg" alt="" class="brand-logo"><div><strong>מארי מקרא</strong><span>ממשק ניהול</span></div></div>`;

// ---------------- Screens ----------------

function renderConnecting(text = 'מתחבר למערכת...') {
  app.innerHTML = `<div class="center-screen">${brand}${loadingHtml(text)}</div>`;
}

function renderLogin(message = '') {
  const isMfa = authState.status === 'mfa';
  app.innerHTML = `
    <div class="center-screen">
      <div class="login-card">
        ${brand}
        ${message ? `<div class="alert ${isMfa ? 'alert-warning' : 'alert-danger'} small">${esc(message)}</div>` : ''}
        ${isMfa ? `
          <p>החיבור הצליח, אך המערכת דורשת אימות דו-שלבי.</p>
          <button class="btn btn-primary btn-block" id="do-mfa"><i class="fa-solid fa-shield-halved"></i> ביצוע אימות</button>
          <button class="btn btn-ghost btn-block" id="relogin">התחברות עם פרטים אחרים</button>`
        : `
          <form class="form" id="login-form" autocomplete="on">
            <label class="field"><span>מספר מערכת</span><input class="input" name="username" dir="ltr" inputmode="numeric" autocomplete="username" value="${esc(settings.username)}" required></label>
            <label class="field"><span>סיסמת ניהול</span><input class="input" name="password" type="password" dir="ltr" autocomplete="current-password" required></label>
            <label class="check"><input type="checkbox" name="remember" checked> זכור אותי במחשב זה (חידוש חיבור אוטומטי)</label>
            <p class="field-error" hidden></p>
            <button class="btn btn-primary btn-block" type="submit"><i class="fa-solid fa-right-to-bracket"></i> התחברות</button>
          </form>
          <details class="token-login"><summary>התחברות עם טוקן</summary>
            <form class="form" id="token-form"><label class="field"><span>טוקן</span><input class="input mono" name="token" dir="ltr"></label>
              <button class="btn btn-ghost btn-block" type="submit">התחברות עם טוקן</button></form></details>`}
        <div class="login-foot">${legacyButton('btn-block')}</div>
      </div>
      <p class="credit">פיתוח מיוחד עבור ת"ת בת עין צפת · פותח בסייעתא דישמיא ע"י שימי טרייטל</p>
    </div>`;

  if (isMfa) {
    app.querySelector('#do-mfa').onclick = async () => { if (await runMfa()) boot(); };
    app.querySelector('#relogin').onclick = () => { authState.status = 'none'; renderLogin(); };
    return;
  }
  const form = app.querySelector('#login-form');
  const err = form.querySelector('.field-error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    err.hidden = true;
    try {
      const u = form.username.value.trim();
      const p = form.password.value;
      const token = await login(u, p);
      settings.token = token;
      settings.username = u;
      settings.password = form.remember.checked ? p : '';
      boot();
    } catch (er) {
      err.textContent = er.message;
      err.hidden = false;
      btn.disabled = false;
    }
  };
  app.querySelector('#token-form').onsubmit = (e) => {
    e.preventDefault();
    const t = e.target.token.value.trim();
    if (!t) return;
    settings.token = t;
    boot();
  };
}

function renderShell() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        ${brand}
        <nav class="nav">${NAV.map((n) => `<a href="#/${n.route}" data-route="${n.route}"><i class="fa-solid ${n.icon}"></i><span>${n.label}</span></a>`).join('')}</nav>
        <div class="sidebar-foot">
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
    const c = entry.mod.mount(host, { route: entry.route, sub, query, reconnect: boot });
    cleanup = typeof c === 'function' ? c : null;
  } catch (e) {
    console.error(e);
    host.innerHTML = `<div class="state state-error"><i class="fa-solid fa-bug"></i><p>${esc(e.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------------- Boot ----------------

async function boot() {
  renderConnecting();
  const res = await connect();
  if (res.status === 'ok') {
    renderShell();
    route();
    return;
  }
  if (res.status === 'mfa') {
    renderLogin(res.message);
    if (await runMfa()) boot();
    return;
  }
  renderLogin(res.status === 'error' ? res.message : '');
}

const urlMsg = absorbUrlParams();
boot().then(() => { if (urlMsg) toast(urlMsg, 'info', 7000); });
