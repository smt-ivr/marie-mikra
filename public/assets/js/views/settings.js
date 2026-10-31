// Settings: connection, credentials and file paths.
import { settings, DEFAULTS } from '../core/settings.js';
import { login, authState } from '../core/auth.js';
import { toast, confirmDialog } from '../core/ui.js';
import { esc } from '../core/util.js';

export function mount(el, ctx) {
  const st = authState;
  const statusCls = { ok: 'ok', mfa: 'warn', error: 'bad', none: 'bad', pending: 'muted' }[st.status] || 'muted';
  el.innerHTML = `
    <div class="page-head"><div><h1>הגדרות</h1><p class="page-sub">ההגדרות נשמרות בדפדפן זה ומשותפות לגרסה החדשה ולגרסה הישנה</p></div></div>
    <section class="panel">
      <div class="panel-head"><h3><i class="fa-solid fa-plug"></i> חיבור למערכת</h3>
        <span class="conn conn-${statusCls}"><span class="conn-dot"></span>${esc(st.message || '—')}</span></div>
      <form class="form form-grid" id="cred" autocomplete="off">
        <label class="field"><span>מספר מערכת</span><input class="input" name="username" value="${esc(settings.username)}" dir="ltr" inputmode="numeric"></label>
        <label class="field"><span>סיסמת ניהול</span><span class="pw"><input class="input" type="password" name="password" value="${esc(settings.password)}" dir="ltr"><button type="button" class="icon-btn pw-eye" aria-label="הצגת סיסמה"><i class="fa-solid fa-eye"></i></button></span></label>
        <label class="field span-2"><span>טוקן (ניתן גם להזין ידנית)</span><span class="pw"><input class="input mono" type="password" name="token" value="${esc(settings.token)}" dir="ltr"><button type="button" class="icon-btn pw-eye" aria-label="הצגת טוקן"><i class="fa-solid fa-eye"></i></button></span></label>
        <p class="hint span-2">כששמורים מספר מערכת וסיסמה, הטוקן מתחדש אוטומטית כשפג תוקפו.</p>
        <div class="form-actions span-2">
          <button type="button" class="btn btn-ghost" data-cmd="gen"><i class="fa-solid fa-key"></i> יצירת טוקן חדש</button>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> שמירה והתחברות מחדש</button>
        </div>
      </form>
    </section>
    <section class="panel">
      <div class="panel-head"><h3><i class="fa-solid fa-folder-tree"></i> נתיבי קבצים</h3></div>
      <form class="form" id="paths">
        <label class="field"><span>נתיב המבחן הפעיל</span><input class="input mono" name="active" dir="ltr" value="${esc(settings.activeTestPath)}"></label>
        <label class="field"><span>נתיב דוח נקודות</span><input class="input mono" name="points" dir="ltr" value="${esc(settings.pointsReportPath)}"></label>
        <label class="field"><span>תיקיית מבחנים קודמים</span><input class="input mono" name="prev" dir="ltr" value="${esc(settings.previousTestsPath)}"></label>
        <div class="form-actions"><button type="button" class="btn btn-ghost" data-cmd="defaults">ברירת מחדל</button>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> שמירת נתיבים</button></div>
      </form>
    </section>
    <section class="panel danger-zone">
      <div class="panel-head"><h3><i class="fa-solid fa-triangle-exclamation"></i> איפוס</h3></div>
      <p>מחיקת כל ההגדרות השמורות בדפדפן זה (כולל פרטי ההתחברות).</p>
      <button class="btn btn-danger" data-cmd="reset"><i class="fa-solid fa-rotate-left"></i> איפוס הגדרות</button>
    </section>`;

  el.querySelectorAll('.pw-eye').forEach((b) => (b.onclick = () => {
    const i = b.previousElementSibling;
    i.type = i.type === 'password' ? 'text' : 'password';
    b.firstElementChild.className = `fa-solid ${i.type === 'password' ? 'fa-eye' : 'fa-eye-slash'}`;
  }));
  const cred = el.querySelector('#cred');
  cred.onsubmit = (e) => {
    e.preventDefault();
    settings.username = cred.username.value.trim();
    settings.password = cred.password.value;
    settings.token = cred.token.value.trim();
    toast('ההגדרות נשמרו', 'success');
    ctx.reconnect();
  };
  el.querySelector('[data-cmd=gen]').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const token = await login(cred.username.value.trim(), cred.password.value);
      cred.token.value = token;
      settings.token = token;
      settings.username = cred.username.value.trim();
      settings.password = cred.password.value;
      toast('נוצר טוקן חדש ונשמר', 'success');
      ctx.reconnect();
    } catch (er) { toast(er.message, 'error'); } finally { btn.disabled = false; }
  };
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
  el.querySelector('[data-cmd=reset]').onclick = async () => {
    if (!(await confirmDialog({ title: 'איפוס הגדרות', danger: true, message: 'למחוק את כל ההגדרות השמורות בדפדפן זה?', confirmText: 'איפוס' }))) return;
    settings.reset();
    location.hash = '#/';
    location.reload();
  };
}
