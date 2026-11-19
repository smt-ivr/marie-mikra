// App shell, sign-in screens and hash router.
import { authState, refreshStatus, logout, can, isMaster, changeOwnPassword, LOGIN_URL, ADMIN_URL } from './core/auth.js';
import { getCustomerData, onServerEvent, server } from './core/api.js';
import { toast, loadingHtml, closeAllModals, openModal } from './core/ui.js';
import { esc, storageGet, storageSet, fmtNum } from './core/util.js';
import { startCalls } from './widgets/calls.js';
import { startMessages } from './widgets/message.js';

import * as dashboard from './views/dashboard.js';
import * as tests from './views/tests/index.js';
import * as points from './views/points.js';
import * as students from './views/students.js';
import * as times from './views/times.js';
import * as tzintuk from './views/tzintuk.js';
import * as logs from './views/logs.js';

const LEGACY_URL = '/marie-mikra/';
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
  { route: 'admin', label: 'ניהול', icon: 'fa-user-shield', href: ADMIN_URL, master: true },
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

const legacyButton = (cls = '') => `<a class="btn btn-legacy ${cls}" href="${LEGACY_URL}" title="מעבר לאתר המקורי"><i class="fa-solid fa-clock-rotate-left"></i><span>לאתר המקורי</span></a>`;
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

// Not signed in: sign-in happens on the main site (same users, same connection)
function goToLogin() {
  location.href = LOGIN_URL;
}

// ---------------- Shell ----------------

function renderShell() {
  const p = authState.principal;
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        ${brand}
        <nav class="nav">${NAV.filter(allowed).map((n) => (n.href
          ? `<a href="${n.href}" target="_blank" rel="noopener"><i class="fa-solid ${n.icon}"></i><span>${n.label}</span><i class="fa-solid fa-arrow-up-right-from-square nav-ext"></i></a>`
          : `<a href="#/${n.route}" data-route="${n.route}"><i class="fa-solid ${n.icon}"></i><span>${n.label}</span></a>`)).join('')}</nav>
        <div class="sidebar-foot">
          <div class="who"><i class="fa-solid ${p.master ? 'fa-user-shield' : p.via === 'ip' ? 'fa-network-wired' : 'fa-circle-user'}"></i><button type="button" class="who-name" id="me-btn" title="אזור אישי">${esc(p.label)}</button>
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
  app.querySelector('#me-btn').onclick = () => openPersonalArea();
  const lo = app.querySelector('#logout-btn');
  if (lo) lo.onclick = async () => { await logout().catch(() => {}); goToLogin(); };
  const sidebar = app.querySelector('#sidebar');
  app.querySelector('#menu-btn').onclick = () => sidebar.classList.toggle('open');
  app.querySelector('#backdrop').onclick = () => sidebar.classList.remove('open');
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) sidebar.classList.remove('open'); });

  // מספר גרסה בקטן בתחתית תפריט הצד
  server('version').then((v) => {
    const when = v.deployed_at ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(v.deployed_at)) : '';
    const el = document.createElement('p');
    el.className = 'credit version';
    el.textContent = `גרסה ${v.release}${when ? ` · עלתה ${when}` : ''}`;
    el.title = [v.note, v.id ? `מזהה פריסה: ${v.id}` : ''].filter(Boolean).join('\n');
    app.querySelector('.sidebar-foot')?.appendChild(el);
  }).catch(() => {});

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

// ---------------- Personal area ----------------
// Same rules as the original site: changing a password needs the current one,
// except right after signing in with Google; without a password one can be created.
// Only with the permission "יצירת והחלפת סיסמה אישית".

const METHOD_NAMES = { password: 'סיסמה', ip: 'כתובת IP מורשית', google: 'Google' };

function openPersonalArea({ prompt = false } = {}) {
  const u = authState.user;
  if (!u) return;
  const hasPw = !!u.has_password;
  const allowed = can('self_password');
  const needCurrent = hasPw && u.method !== 'google';
  const m = openModal({
    title: 'אזור אישי', icon: 'fa-circle-user', size: 'sm',
    body: `${prompt ? '<div class="alert alert-info small"><i class="fa-solid fa-key"></i> עדיין אין לכם סיסמה. אפשר ליצור סיסמה עכשיו, כדי להיכנס גם מכל מחשב אחר.</div>' : ''}
      <div class="kv-grid">
        <div class="kv"><span>שם</span><strong>${esc(u.name)}</strong></div>
        ${u.email ? `<div class="kv"><span>מייל</span><strong dir="ltr">${esc(u.email)}</strong></div>` : ''}
        <div class="kv"><span>נכנסתם עם</span><strong>${esc(METHOD_NAMES[u.method] || u.method || '—')}</strong></div>
        <div class="kv"><span>סיסמה</span><strong>${hasPw ? 'מוגדרת' : 'עדיין אין'}</strong></div>
      </div>
      ${allowed ? `<form class="form" id="pa-form" autocomplete="off" style="margin-top:1rem">
          <h4 style="margin:0">${hasPw ? 'החלפת סיסמה' : 'יצירת סיסמה'}</h4>
          ${needCurrent ? '<label class="field"><span>סיסמה נוכחית</span><input class="input" type="password" name="current" dir="ltr" autocomplete="current-password"></label>' : ''}
          <label class="field"><span>${hasPw ? 'סיסמה חדשה' : 'סיסמה'} (לפחות 4 תווים, אפשר גם 4 ספרות)</span><input class="input" type="password" name="next" dir="ltr" autocomplete="new-password"></label>
          <label class="field"><span>אימות הסיסמה</span><input class="input" type="password" name="next2" dir="ltr" autocomplete="new-password"></label>
          <p class="field-error" hidden></p>
        </form>` : `<p class="muted small" style="margin-top:1rem">${hasPw ? 'להחלפת הסיסמה' : 'ליצירת סיסמה'} יש לפנות למנהל המערכת.</p>`}`,
    footer: allowed
      ? `${prompt ? '<button class="btn btn-ghost" data-act="later">אחר כך</button>' : ''}<button class="btn btn-primary" data-act="save"><i class="fa-solid fa-key"></i> ${hasPw ? 'החלפת סיסמה' : 'יצירת סיסמה'}</button>`
      : '<button class="btn btn-ghost" data-act="later">סגירה</button>',
  });
  const later = m.footer.querySelector('[data-act=later]');
  if (later) later.onclick = () => {
    m.close();
    // "אחר כך" – נשמר בחשבון בשרת (המנהל יכול לאפס בדף הניהול)
    if (prompt) { u.password_prompt_dismissed = true; server('auth/password-prompt/dismiss', { method: 'POST', body: {} }).catch(() => {}); }
  };
  const f = m.body.querySelector('#pa-form');
  if (!f) return;
  const err = f.querySelector('.field-error');
  const fail = (t) => { err.textContent = t; err.hidden = false; };
  setTimeout(() => (f.current || f.next).focus(), 50);
  const submit = async () => {
    err.hidden = true;
    if (f.next.value.length < 4) return fail('הסיסמה חייבת להכיל לפחות 4 תווים');
    if (f.next.value !== f.next2.value) return fail('הסיסמאות אינן זהות');
    if (needCurrent && !f.current.value) return fail('יש להזין את הסיסמה הנוכחית');
    const btn = m.footer.querySelector('[data-act=save]');
    btn.disabled = true;
    try {
      await changeOwnPassword(needCurrent ? f.current.value : undefined, f.next.value);
      u.has_password = true;
      m.close();
      toast(hasPw ? 'הסיסמה הוחלפה' : 'הסיסמה נוצרה. מעכשיו אפשר להיכנס איתה מכל מחשב', 'success', 6000);
    } catch (e) {
      fail(e.message);
      btn.disabled = false;
    }
  };
  f.onsubmit = (e) => { e.preventDefault(); submit(); };
  m.footer.querySelector('[data-act=save]').onclick = submit;
}

function maybePromptPassword() {
  const u = authState.user;
  if (!u || u.has_password !== false || u.password_prompt_dismissed || !can('self_password')) return;
  try { if (sessionStorage.getItem('mmPasswordPromptShown') === '1') return; sessionStorage.setItem('mmPasswordPromptShown', '1'); } catch { /* ignore */ }
  openPersonalArea({ prompt: true });
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
  let entry = NAV.find((n) => n.route === r && n.mod) || NAV[0];
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
    const c = entry.mod.mount(host, { route: entry.route, sub, query, reconnect: boot, logout: async () => { await logout().catch(() => {}); goToLogin(); } });
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
    if (!st.loggedIn) {
      if (st.error) { loginScreen(`<div class="alert alert-danger small">${esc(st.error)}</div><button class="btn btn-primary btn-block" id="retry">ניסיון נוסף</button>`); app.querySelector('#retry').onclick = () => boot(); return; }
      goToLogin();
      return;
    }
    if (!can('new_site')) { location.href = LEGACY_URL; return; }
    renderShell();
    route();
    maybePromptPassword();
  })();
  try { await booting; } finally { booting = null; }
}

onServerEvent('unauthorized', () => goToLogin());

boot();
