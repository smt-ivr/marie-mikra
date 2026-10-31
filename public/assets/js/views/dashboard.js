// Overview: the most important numbers at a glance.
import * as api from '../core/api.js';
import { settings, PATHS } from '../core/settings.js';
import { esc, fmtNum, toNumber } from '../core/util.js';
import { reportLines, lineToObject, SCORE_KEY } from '../core/ymgr.js';
import { getLockState } from './tests/test-actions.js';
import { parseTimes, timeStatus } from './times.js';
import { parseStudentsMap, parsePoints } from './points.js';
import { liveCalls } from '../widgets/calls.js';

const card = (id, href, icon, title) => `
  <a class="dash-card" id="${id}" href="${href}">
    <div class="dash-card-head"><span class="dash-icon"><i class="fa-solid ${icon}"></i></span><span>${title}</span><i class="fa-solid fa-chevron-left dash-go"></i></div>
    <div class="dash-card-body"><span class="skeleton"></span><span class="skeleton short"></span></div>
  </a>`;

export function mount(el) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : hour < 21 ? 'ערב טוב' : 'לילה טוב';
  el.innerHTML = `
    <div class="page-head"><div><h1>${greet}</h1><p class="page-sub">סקירה כללית של המערכת</p></div></div>
    <div class="dash-grid">
      ${card('d-test', '#/tests', 'fa-clipboard-check', 'המבחן הפעיל')}
      ${card('d-lock', '#/tests', 'fa-lock', 'סטטוס שלוחת המבחן')}
      ${card('d-time', '#/times', 'fa-clock', 'זמני כניסה')}
      ${card('d-points', '#/points', 'fa-star', 'נקודות')}
      ${card('d-students', '#/students', 'fa-users', 'תלמידים')}
      ${card('d-calls', '#/tests', 'fa-phone-volume', 'שיחות פעילות')}
      ${card('d-sys', '#/settings', 'fa-server', 'פרטי מערכת')}
    </div>`;
  const set = (id, html) => { const b = el.querySelector(`#${id} .dash-card-body`); if (b) b.innerHTML = html; };
  const fail = (id, e) => set(id, `<span class="muted small"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(e?.message || 'לא זמין')}</span>`);

  api.getText(settings.activeTestPath).then((txt) => {
    if (txt === null) { set('d-test', '<span class="dash-big">—</span><span class="muted">אין כעת מבחן פעיל</span>'); return; }
    const objs = reportLines(txt).map(lineToObject);
    const scores = objs.map((o) => toNumber(o[SCORE_KEY])).filter(Number.isFinite);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : NaN;
    set('d-test', `<span class="dash-big">${objs.length}</span><span class="muted">נבחנים${scores.length ? ` · ממוצע <strong>${fmtNum(avg, 1)}</strong>` : ''}</span>`);
  }).catch((e) => fail('d-test', e));

  getLockState().then((locked) => set('d-lock', locked
    ? '<span class="dash-status bad"><i class="fa-solid fa-lock"></i> חסום</span><span class="muted">תלמידים לא יכולים להיבחן</span>'
    : '<span class="dash-status ok"><i class="fa-solid fa-lock-open"></i> פתוח</span><span class="muted">ניתן להיבחן</span>')).catch((e) => fail('d-lock', e));

  api.getText(PATHS.timeIni).then((txt) => {
    if (txt === null) { set('d-time', '<span class="muted">לא הוגדרו זמנים</span>'); return; }
    const st = timeStatus(parseTimes(txt));
    set('d-time', `<span class="dash-status ${st.open ? 'ok' : 'bad'}"><i class="fa-solid ${st.open ? 'fa-door-open' : 'fa-door-closed'}"></i> ${st.open ? 'פתוח עכשיו' : 'סגור עכשיו'}</span><span class="muted small">${esc(st.text)}</span>`);
  }).catch((e) => fail('d-time', e));

  Promise.all([api.getText(PATHS.studentsIni), api.getText(PATHS.pointsIni)]).then(([studentsTxt, pointsTxt]) => {
    const smap = parseStudentsMap(studentsTxt);
    const all = String(studentsTxt || '').split(/\r?\n/).slice(1).filter((l) => l.trim() && l.split(',')[0]);
    const active = all.filter((l) => (l.split(',')[1] || '1') === '1').length;
    set('d-students', studentsTxt === null ? '<span class="muted">לא נמצא קובץ תלמידים</span>'
      : `<span class="dash-big">${all.length}</span><span class="muted">${active} פעילים · ${all.length - active} מושבתים</span>`);
    if (pointsTxt === null) { set('d-points', '<span class="muted">אין דוח נקודות פעיל</span>'); return; }
    const rows = parsePoints(pointsTxt, smap).sort((a, b) => b.points - a.points);
    const total = rows.reduce((a, r) => a + r.points, 0);
    set('d-points', `<span class="dash-big">${fmtNum(total)}</span><span class="muted">${rows.length} תלמידים${rows[0] ? ` · מוביל: <strong>${esc(rows[0].name)}</strong>` : ''}</span>`);
  }).catch((e) => { fail('d-students', e); fail('d-points', e); });

  const renderCalls = (calls) => set('d-calls', `<span class="dash-big ${calls.length ? 'live' : ''}">${calls.length}</span><span class="muted">${calls.length ? 'מתקשרים כעת במערכת' : 'אין שיחות כרגע'}</span>`);
  renderCalls(liveCalls.list);
  const off = liveCalls.onChange(renderCalls);

  api.getCustomerData().then((d) => {
    const units = parseFloat(d.units || 0);
    set('d-sys', `<span class="dash-title">${esc(d.name || 'מערכת')}</span>
      <span class="muted"><span dir="ltr">${esc(d.mainDid || '')}</span> · <span class="${units < 10 ? 'bad' : ''}">${fmtNum(units, 1)} יחידות</span></span>`);
  }).catch((e) => fail('d-sys', e));

  return () => off();
}
