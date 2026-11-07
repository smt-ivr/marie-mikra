// Admin panel (master password only): token, master password, extra passwords,
// allowed IP addresses with limited permissions, file paths, action log.
import { server } from '../core/api.js';
import { authState } from '../core/auth.js';
import { toast, confirmDialog, openModal, createTable, loadingHtml, errorHtml, emptyHtml, withBusy } from '../core/ui.js';
import { esc } from '../core/util.js';
import { DEFAULTS } from '../core/settings.js';

export const AREAS = [
  { key: 'tests', label: 'מבחנים וציונים', edit: true },
  { key: 'points', label: 'נקודות', edit: true },
  { key: 'students', label: 'תלמידים', edit: true },
  { key: 'times', label: 'זמנים', edit: true },
  { key: 'tzintuk', label: 'צינתוקים', edit: true },
  { key: 'logs', label: 'לוגים', edit: false },
];

const ACTIONS = {
  setup: 'הגדרה ראשונית', login: 'כניסה', 'login-failed': 'ניסיון כניסה שגוי', 'login-blocked-ip': 'כניסה נחסמה (IP)',
  'token-replaced': 'הוחלף טוקן', 'master-changed': 'שונתה סיסמת מאסטר', 'paths-changed': 'שונו נתיבים', 'logout-all': 'ניתוק כולם',
  'access-created': 'נוצרה גישה', 'access-updated': 'עודכנה גישה', 'access-deleted': 'נמחקה גישה',
  UploadTextFile: 'שמירת קובץ', FileAction: 'פעולת קבצים', UpdateExtension: 'עדכון שלוחה', UpdateTask: 'עדכון משימה',
  RunTzintuk: 'הפעלת צינתוק', TzintukimListManagement: 'ניהול רשימת צינתוקים',
};

function permsSummary(perms) {
  return AREAS.map((a) => {
    if (perms.includes(`${a.key}_edit`)) return `<span class="badge badge-primary">${a.label}: עריכה</span>`;
    if (perms.includes(`${a.key}_view`)) return `<span class="badge">${a.label}: צפייה</span>`;
    return '';
  }).join(' ') || '<span class="muted small">ללא הרשאות</span>';
}

const pw = (name, label, ac = 'new-password') => `<label class="field"><span>${label}</span><span class="pw"><input class="input" type="password" name="${name}" dir="ltr" autocomplete="${ac}"><button type="button" class="icon-btn pw-eye" aria-label="הצגה"><i class="fa-solid fa-eye"></i></button></span></label>`;
function wireEyes(root) {
  root.querySelectorAll('.pw-eye').forEach((b) => (b.onclick = () => {
    const i = b.previousElementSibling;
    i.type = i.type === 'password' ? 'text' : 'password';
    b.firstElementChild.className = `fa-solid ${i.type === 'password' ? 'fa-eye' : 'fa-eye-slash'}`;
  }));
}

/** Add / edit an access entry (password or IP). */
function editAccess({ kind, entry, yourIp, onSaved }) {
  const isNew = !entry;
  const e = entry || { label: '', ips: '', perms: ['tests_view'], active: true };
  const level = (area) => (e.perms.includes(`${area}_edit`) ? 'edit' : e.perms.includes(`${area}_view`) ? 'view' : 'none');
  const m = openModal({
    title: `${isNew ? 'הוספת' : 'עריכת'} ${kind === 'ip' ? 'כתובת IP מורשית' : 'סיסמה'}`,
    icon: kind === 'ip' ? 'fa-network-wired' : 'fa-key', size: 'md',
    body: `<form class="form" autocomplete="off">
      <label class="field"><span>שם (למשל: מזכירות, מחשב משרד)</span><input class="input" name="label" value="${esc(e.label)}" maxlength="80"></label>
      ${kind === 'password'
        ? `${pw('password', isNew ? 'סיסמה (לפחות 6 תווים)' : 'סיסמה חדשה (להשאיר ריק כדי לא לשנות)')}
           <label class="field"><span>הגבלה לכתובות IP (רשות)</span><input class="input mono" name="ips" dir="ltr" value="${esc(e.ips)}" placeholder="ריק = מכל מקום"></label>
           <p class="hint">אם ממלאים כתובות, הסיסמה תעבוד רק מהן. אפשר כמה כתובות מופרדות בפסיק, או טווח כמו 1.2.3.0/24.</p>`
        : `<label class="field"><span>כתובות IP (כניסה ללא סיסמה מכתובות אלו)</span><input class="input mono" name="ips" dir="ltr" value="${esc(e.ips)}" placeholder="1.2.3.4, 5.6.7.0/24"></label>
           <p class="hint">הכתובת שלכם כרגע: <span class="mono" dir="ltr">${esc(yourIp || 'לא ידוע')}</span> <button type="button" class="btn btn-sm btn-ghost" data-act="my-ip">הוספת הכתובת שלי</button></p>`}
      <div class="field"><span>הרשאות</span>
        <table class="perm-table"><thead><tr><th></th><th>ללא</th><th>צפייה</th><th>עריכה</th></tr></thead><tbody>
          ${AREAS.map((a) => `<tr><th>${a.label}</th>
            ${['none', 'view', 'edit'].map((lv) => (lv === 'edit' && !a.edit) ? '<td></td>'
              : `<td><input type="radio" name="perm-${a.key}" value="${lv}" ${level(a.key) === lv ? 'checked' : ''} aria-label="${a.label} ${lv}"></td>`).join('')}</tr>`).join('')}
        </tbody></table>
        <p class="hint">"עריכה" כוללת גם צפייה. סקירה כללית ושיחות פעילות זמינות לכל מי שנכנס.</p>
      </div>
      <label class="check"><input type="checkbox" name="active" ${e.active ? 'checked' : ''}> פעיל</label>
      <p class="field-error" hidden></p></form>`,
    footer: '<button class="btn btn-ghost" data-act="cancel">ביטול</button><button class="btn btn-primary" data-act="save"><i class="fa-solid fa-floppy-disk"></i> שמירה</button>',
  });
  const f = m.body.querySelector('form');
  wireEyes(f);
  const my = m.body.querySelector('[data-act=my-ip]');
  if (my) my.onclick = () => { if (yourIp && !f.ips.value.includes(yourIp)) f.ips.value = [f.ips.value.trim(), yourIp].filter(Boolean).join(', '); };
  m.footer.querySelector('[data-act=cancel]').onclick = () => m.close();
  const err = m.body.querySelector('.field-error');
  m.footer.querySelector('[data-act=save]').onclick = (ev) => withBusy(ev.currentTarget, async () => {
    err.hidden = true;
    const perms = [];
    AREAS.forEach((a) => {
      const v = f.querySelector(`input[name=perm-${a.key}]:checked`)?.value;
      if (v === 'view') perms.push(`${a.key}_view`);
      if (v === 'edit') perms.push(`${a.key}_edit`);
    });
    const body = { kind, label: f.label.value.trim(), ips: f.ips.value, perms, active: f.active.checked };
    if (kind === 'password' && f.password.value) body.password = f.password.value;
    try {
      await server(isNew ? 'admin/access' : `admin/access/${encodeURIComponent(entry.id)}`, { method: 'POST', body });
      m.close();
      toast(isNew ? 'הגישה נוצרה' : 'הגישה עודכנה', 'success');
      onSaved();
    } catch (er) {
      err.textContent = er.message;
      err.hidden = false;
    }
  });
  setTimeout(() => f.label.focus(), 50);
}

export function mount(el, ctx) {
  el.innerHTML = `
    <div class="page-head"><div><h1>ניהול</h1><p class="page-sub">נגיש רק עם סיסמת המאסטר</p></div>
      <div class="page-actions"><button class="btn btn-ghost icon-only" data-cmd="refresh" title="רענון"><i class="fa-solid fa-rotate"></i></button></div></div>
    <div id="adm">${loadingHtml()}</div>`;
  const box = el.querySelector('#adm');
  let state = null;

  async function load() {
    box.innerHTML = loadingHtml();
    try { state = await server('admin/state'); } catch (e) { box.innerHTML = errorHtml(e); return; }
    const c = state.connection || {};
    const connCls = { ok: 'ok', mfa: 'warn', expired: 'bad', error: 'bad' }[c.status] || 'muted';
    const passwords = state.access.filter((a) => a.kind === 'password');
    const ips = state.access.filter((a) => a.kind === 'ip');
    box.innerHTML = `
      <section class="panel">
        <div class="panel-head"><h3><i class="fa-solid fa-plug"></i> חיבור</h3>
          <span class="conn conn-${connCls}"><span class="conn-dot"></span>${esc(c.message || '—')}</span></div>
        <p class="muted small">הטוקן שמור בשרת בלבד ולא מוצג לאף אחד. טוקן נוכחי: <span class="mono" dir="ltr">${esc(state.tokenPreview || '—')}</span></p>
        <form class="form form-inline" id="token-form" autocomplete="off">
          ${pw('token', 'טוקן חדש', 'off')}
          <p class="field-error" hidden></p>
          <div class="form-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-arrows-rotate"></i> החלפת טוקן</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h3><i class="fa-solid fa-key"></i> סיסמאות</h3>
          <button class="btn btn-primary btn-sm" data-cmd="add-password"><i class="fa-solid fa-plus"></i> סיסמה חדשה</button></div>
        <div id="pw-table"></div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3><i class="fa-solid fa-network-wired"></i> כתובות IP מורשות (כניסה ללא סיסמה)</h3>
          <button class="btn btn-primary btn-sm" data-cmd="add-ip"><i class="fa-solid fa-plus"></i> כתובת חדשה</button></div>
        <p class="muted small">הכתובת שלכם כרגע: <span class="mono" dir="ltr">${esc(state.yourIp || 'לא ידוע')}</span></p>
        <div id="ip-table"></div>
      </section>

      <div class="two-col">
        <section class="panel">
          <div class="panel-head"><h3><i class="fa-solid fa-user-shield"></i> שינוי סיסמת המאסטר</h3></div>
          <form class="form" id="master-form" autocomplete="off">
            ${pw('current', 'סיסמת מאסטר נוכחית', 'current-password')}
            ${pw('next', 'סיסמת מאסטר חדשה (לפחות 6 תווים)')}
            ${pw('next2', 'אימות הסיסמה החדשה')}
            <p class="field-error" hidden></p>
            <div class="form-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> שינוי</button></div>
          </form>
        </section>
        <section class="panel">
          <div class="panel-head"><h3><i class="fa-solid fa-folder-tree"></i> נתיבי קבצים</h3></div>
          <form class="form" id="paths-form">
            <label class="field"><span>נתיב המבחן הפעיל</span><input class="input mono" name="active" dir="ltr" value="${esc(state.paths.activeTestPath)}"></label>
            <label class="field"><span>תיקיית מבחנים קודמים</span><input class="input mono" name="prev" dir="ltr" value="${esc(state.paths.previousTestsPath)}"></label>
            <p class="field-error" hidden></p>
            <div class="form-actions"><button type="button" class="btn btn-ghost" data-cmd="defaults">ברירת מחדל</button>
              <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> שמירה</button></div>
          </form>
        </section>
      </div>

      <section class="panel">
        <div class="panel-head"><h3><i class="fa-solid fa-list-check"></i> יומן פעולות</h3>
          <div class="seg"><button class="btn btn-ghost btn-sm" data-cmd="audit"><i class="fa-solid fa-rotate"></i> רענון</button>
            <button class="btn btn-danger btn-sm" data-cmd="logout-all"><i class="fa-solid fa-users-slash"></i> ניתוק כל המחוברים</button></div></div>
        <div id="audit">${loadingHtml()}</div>
      </section>`;
    wireEyes(box);

    const accessTable = (container, rows, kind) => {
      if (!rows.length) { container.innerHTML = emptyHtml(kind === 'ip' ? 'לא הוגדרו כתובות IP.' : 'לא נוצרו סיסמאות נוספות.', kind === 'ip' ? 'fa-network-wired' : 'fa-key'); return; }
      createTable(container, {
        rows, rowId: (a) => a.id,
        columns: [
          { key: 'label', label: 'שם', render: (a) => `<strong>${esc(a.label)}</strong>` },
          { key: 'ips', label: kind === 'ip' ? 'כתובות' : 'הגבלת IP', className: 'ltr-cell mono', value: (a) => a.ips || (kind === 'ip' ? '' : 'מכל מקום') },
          { key: 'perms', label: 'הרשאות', sortable: false, render: (a) => permsSummary(a.perms) },
          { key: 'active', label: 'סטטוס', render: (a) => (a.active ? '<span class="badge badge-ok">פעיל</span>' : '<span class="badge badge-bad">מושבת</span>') },
          { key: 'lastUsedAt', label: 'שימוש אחרון', className: 'nowrap', value: (a) => a.lastUsedAt || 0, render: (a) => (a.lastUsedAt ? esc(new Date(a.lastUsedAt).toLocaleString('he-IL')) : '<span class="muted">—</span>') },
        ],
        actions: (a) => `<button class="icon-btn" data-action="edit" title="עריכה"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn" data-action="toggle" title="${a.active ? 'השבתה' : 'הפעלה'}"><i class="fa-solid ${a.active ? 'fa-toggle-on' : 'fa-toggle-off'}"></i></button>
          <button class="icon-btn danger" data-action="delete" title="מחיקה"><i class="fa-solid fa-trash"></i></button>`,
        onAction: async (act, a) => {
          if (act === 'edit') editAccess({ kind, entry: a, yourIp: state.yourIp, onSaved: load });
          if (act === 'toggle') {
            try { await server(`admin/access/${encodeURIComponent(a.id)}`, { method: 'POST', body: { active: !a.active } }); toast(a.active ? 'הגישה הושבתה' : 'הגישה הופעלה', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
          }
          if (act === 'delete') {
            if (!(await confirmDialog({ title: 'מחיקת גישה', danger: true, message: `למחוק את <strong>${esc(a.label)}</strong>? מי שמחובר בה ינותק.`, confirmText: 'מחיקה' }))) return;
            try { await server(`admin/access/${encodeURIComponent(a.id)}/delete`, { method: 'POST', body: {} }); toast('הגישה נמחקה', 'success'); load(); } catch (e) { toast(e.message, 'error'); }
          }
        },
      });
    };
    accessTable(box.querySelector('#pw-table'), passwords, 'password');
    accessTable(box.querySelector('#ip-table'), ips, 'ip');

    const formAction = (form, fn) => {
      const err = form.querySelector('.field-error');
      form.onsubmit = (e) => {
        e.preventDefault();
        err.hidden = true;
        withBusy(form.querySelector('button[type=submit]'), async () => {
          try { await fn(form); } catch (er) { err.textContent = er.message; err.hidden = false; }
        });
      };
    };
    formAction(box.querySelector('#token-form'), async (f) => {
      if (!f.token.value.trim()) throw new Error('יש להזין טוקן.');
      await server('admin/token', { method: 'POST', body: { token: f.token.value.trim() } });
      toast('הטוקן הוחלף בהצלחה', 'success');
      ctx.reconnect();
    });
    formAction(box.querySelector('#master-form'), async (f) => {
      if (f.next.value !== f.next2.value) throw new Error('הסיסמאות החדשות אינן זהות.');
      await server('admin/master', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      f.reset();
      toast('סיסמת המאסטר שונתה. שאר החיבורים עם סיסמת המאסטר נותקו.', 'success');
      loadAudit();
    });
    const pf = box.querySelector('#paths-form');
    formAction(pf, async (f) => {
      const r = await server('admin/paths', { method: 'POST', body: { activeTestPath: f.active.value, previousTestsPath: f.prev.value } });
      authState.paths = r.paths;
      toast('הנתיבים נשמרו', 'success');
    });
    box.querySelector('[data-cmd=defaults]').onclick = () => { pf.active.value = DEFAULTS.active_test_path; pf.prev.value = DEFAULTS.previous_tests_path; };
    loadAudit();
  }

  async function loadAudit() {
    const auditBox = box.querySelector('#audit');
    if (!auditBox) return;
    auditBox.innerHTML = loadingHtml();
    try {
      const { items } = await server('audit');
      if (!items.length) { auditBox.innerHTML = emptyHtml('עדיין אין פעולות ביומן.', 'fa-list-check'); return; }
      createTable(auditBox, {
        rows: items, sortKey: 'at', sortDir: -1,
        columns: [
          { key: 'at', label: 'מתי', value: (r) => r.at, render: (r) => esc(new Date(r.at).toLocaleString('he-IL')), className: 'nowrap' },
          { key: 'username', label: 'מי', value: (r) => r.username || '—' },
          { key: 'action', label: 'פעולה', value: (r) => { const [a, ...rest] = r.action.split(' '); return `${ACTIONS[a] || a}${rest.length ? ` ${rest.join(' ')}` : ''}`; } },
          { key: 'target', label: 'יעד', className: 'ltr-cell' },
          { key: 'detail', label: 'פרטים', className: 'ltr-cell' },
          { key: 'ip', label: 'IP', className: 'mono' },
        ],
      });
    } catch (e) { auditBox.innerHTML = errorHtml(e); }
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b || !state) return;
    const cmd = b.dataset.cmd;
    if (cmd === 'refresh') load();
    if (cmd === 'audit') loadAudit();
    if (cmd === 'add-password') editAccess({ kind: 'password', yourIp: state.yourIp, onSaved: load });
    if (cmd === 'add-ip') editAccess({ kind: 'ip', yourIp: state.yourIp, onSaved: load });
    if (cmd === 'logout-all') {
      if (!(await confirmDialog({ title: 'ניתוק כל המחוברים', danger: true, message: 'לנתק את כל מי שמחובר עם סיסמה (כולל אתכם)? גישה לפי IP לא מושפעת.', confirmText: 'ניתוק' }))) return;
      await server('admin/logout-all', { method: 'POST', body: {} }).catch(() => {});
      ctx.reconnect();
    }
  });
  load();
}
