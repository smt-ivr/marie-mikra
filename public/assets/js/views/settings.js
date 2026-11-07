// Settings: account, passwords, file paths and the server-side action log.
import { settings, DEFAULTS } from '../core/settings.js';
import { authState, changePassword, relinkYemot, logoutAll } from '../core/auth.js';
import { server } from '../core/api.js';
import { toast, confirmDialog, createTable, loadingHtml, errorHtml, emptyHtml, withBusy } from '../core/ui.js';
import { esc } from '../core/util.js';

const ACTIONS = {
  login: 'התחברות', 'login-failed': 'ניסיון התחברות שגוי', setup: 'כניסה ראשונה / איפוס סיסמה', 'setup-failed': 'איפוס סיסמה נכשל',
  'password-changed': 'שינוי סיסמת הממשק', 'yemot-relinked': 'עדכון סיסמת ימות', 'logout-all': 'ניתוק כל המכשירים',
  UploadTextFile: 'שמירת קובץ', FileAction: 'פעולת קבצים', UpdateExtension: 'עדכון שלוחה', UpdateTask: 'עדכון משימה',
  RunTzintuk: 'הפעלת צינתוק', TzintukimListManagement: 'ניהול רשימת צינתוקים',
};

const pw = (name, label, ac) => `<label class="field"><span>${label}</span><span class="pw"><input class="input" type="password" name="${name}" dir="ltr" autocomplete="${ac}" required><button type="button" class="icon-btn pw-eye" aria-label="הצגת סיסמה"><i class="fa-solid fa-eye"></i></button></span></label>`;

export function mount(el, ctx) {
  const st = authState;
  const statusCls = { ok: 'ok', mfa: 'warn', relink: 'warn', error: 'bad', none: 'bad', pending: 'muted' }[st.status] || 'muted';
  el.innerHTML = `
    <div class="page-head"><div><h1>הגדרות</h1><p class="page-sub">פרטי ההתחברות שמורים בשרת בלבד, ולא בדפדפן</p></div></div>

    <section class="panel">
      <div class="panel-head"><h3><i class="fa-solid fa-circle-user"></i> חשבון</h3>
        <span class="conn conn-${statusCls}"><span class="conn-dot"></span>ימות המשיח: ${esc(st.message || '—')}</span></div>
      <p>מחובר כמערכת <strong dir="ltr">${esc(st.username)}</strong>.</p>
      ${st.encrypted ? '' : '<div class="alert alert-warning small"><i class="fa-solid fa-triangle-exclamation"></i> סיסמת ימות נשמרת בשרת ללא הצפנה נוספת. להצפנה יש להוסיף סוד בשם <span class="mono">MM_SECRET</span> בהגדרות ה-Worker ב-Cloudflare (ראו README).</div>'}
      <div class="form-actions" style="justify-content:flex-start">
        <button class="btn btn-ghost" data-cmd="logout"><i class="fa-solid fa-right-from-bracket"></i> התנתקות</button>
        <button class="btn btn-ghost" data-cmd="logout-all"><i class="fa-solid fa-users-slash"></i> ניתוק כל המכשירים</button>
      </div>
    </section>

    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h3><i class="fa-solid fa-lock"></i> שינוי סיסמת הממשק</h3></div>
        <form class="form" id="pw-form" autocomplete="off">
          ${pw('current', 'סיסמה נוכחית', 'current-password')}
          ${pw('next', 'סיסמה חדשה (לפחות 6 תווים)', 'new-password')}
          ${pw('next2', 'אימות הסיסמה החדשה', 'new-password')}
          <p class="field-error" hidden></p>
          <div class="form-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> שינוי סיסמה</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-head"><h3><i class="fa-solid fa-plug"></i> סיסמת ימות המשיח</h3></div>
        <p class="muted small">אם שיניתם את סיסמת הניהול בימות המשיח, עדכנו אותה כאן כדי שהשרת ימשיך לחדש את החיבור אוטומטית.</p>
        <form class="form" id="yemot-form" autocomplete="off">
          ${pw('yemot', 'סיסמת ניהול חדשה של ימות', 'off')}
          <p class="field-error" hidden></p>
          <div class="form-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> עדכון</button></div>
        </form>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h3><i class="fa-solid fa-folder-tree"></i> נתיבי קבצים</h3><span class="muted small">נשמרים בדפדפן זה, משותפים עם הגרסה הישנה</span></div>
      <form class="form" id="paths">
        <label class="field"><span>נתיב המבחן הפעיל</span><input class="input mono" name="active" dir="ltr" value="${esc(settings.activeTestPath)}"></label>
        <label class="field"><span>נתיב דוח נקודות</span><input class="input mono" name="points" dir="ltr" value="${esc(settings.pointsReportPath)}"></label>
        <label class="field"><span>תיקיית מבחנים קודמים</span><input class="input mono" name="prev" dir="ltr" value="${esc(settings.previousTestsPath)}"></label>
        <div class="form-actions"><button type="button" class="btn btn-ghost" data-cmd="defaults">ברירת מחדל</button>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> שמירת נתיבים</button></div>
      </form>
    </section>

    <section class="panel">
      <div class="panel-head"><h3><i class="fa-solid fa-list-check"></i> יומן פעולות בשרת</h3>
        <button class="btn btn-ghost btn-sm" data-cmd="audit"><i class="fa-solid fa-rotate"></i> רענון</button></div>
      <p class="muted small">כל שמירה, העברת קבצים, שינוי שלוחה, הפעלת צינתוק והתחברות נרשמים כאן — מכל מחשב.</p>
      <div id="audit">${loadingHtml()}</div>
    </section>`;

  el.querySelectorAll('.pw-eye').forEach((b) => (b.onclick = () => {
    const i = b.previousElementSibling;
    i.type = i.type === 'password' ? 'text' : 'password';
    b.firstElementChild.className = `fa-solid ${i.type === 'password' ? 'fa-eye' : 'fa-eye-slash'}`;
  }));

  const formAction = (form, fn) => {
    const err = form.querySelector('.field-error');
    form.onsubmit = (e) => {
      e.preventDefault();
      err.hidden = true;
      withBusy(form.querySelector('button[type=submit]'), async () => {
        try { await fn(form); form.reset(); } catch (er) { err.textContent = er.message; err.hidden = false; }
      });
    };
  };
  formAction(el.querySelector('#pw-form'), async (f) => {
    if (f.next.value !== f.next2.value) throw new Error('הסיסמאות החדשות אינן זהות.');
    await changePassword(f.current.value, f.next.value);
    toast('סיסמת הממשק שונתה. מכשירים אחרים נותקו.', 'success');
    loadAudit();
  });
  formAction(el.querySelector('#yemot-form'), async (f) => {
    await relinkYemot(f.yemot.value);
    toast('סיסמת ימות עודכנה והחיבור חודש.', 'success');
    loadAudit();
  });

  const paths = el.querySelector('#paths');
  paths.onsubmit = (e) => {
    e.preventDefault();
    settings.activeTestPath = paths.active.value.trim();
    settings.pointsReportPath = paths.points.value.trim();
    settings.previousTestsPath = paths.prev.value.trim();
    toast('הנתיבים נשמרו', 'success');
  };
  el.querySelector('[data-cmd=defaults]').onclick = () => {
    paths.active.value = DEFAULTS.active_test_path;
    paths.points.value = DEFAULTS.points_report_path;
    paths.prev.value = DEFAULTS.previous_tests_path;
  };
  el.querySelector('[data-cmd=logout]').onclick = () => ctx.logout();
  el.querySelector('[data-cmd=logout-all]').onclick = async () => {
    if (!(await confirmDialog({ title: 'ניתוק כל המכשירים', message: 'לנתק את הממשק בכל המחשבים והטלפונים, כולל זה?', confirmText: 'ניתוק', danger: true }))) return;
    await logoutAll().catch(() => {});
    ctx.reconnect();
  };

  const auditBox = el.querySelector('#audit');
  async function loadAudit() {
    auditBox.innerHTML = loadingHtml();
    try {
      const { items } = await server('audit');
      if (!items.length) { auditBox.innerHTML = emptyHtml('עדיין אין פעולות ביומן.', 'fa-list-check'); return; }
      createTable(auditBox, {
        rows: items,
        columns: [
          { key: 'at', label: 'מתי', value: (r) => r.at, render: (r) => esc(new Date(r.at).toLocaleString('he-IL')), className: 'nowrap ltr-cell' },
          { key: 'action', label: 'פעולה', value: (r) => { const [a, ...rest] = r.action.split(' '); return `${ACTIONS[a] || a}${rest.length ? ` ${rest.join(' ')}` : ''}`; } },
          { key: 'target', label: 'יעד', className: 'ltr-cell' },
          { key: 'detail', label: 'פרטים', className: 'ltr-cell' },
          { key: 'ip', label: 'כתובת IP', className: 'mono' },
        ],
        sortKey: 'at', sortDir: -1,
      });
    } catch (e) { auditBox.innerHTML = errorHtml(e); }
  }
  el.querySelector('[data-cmd=audit]').onclick = loadAudit;
  loadAudit();
}
