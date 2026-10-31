// Times: open/closed/filter mode and weekly access rules in ivr2:/ext.ini.
// The file format handling mirrors the old version exactly.
import * as api from '../core/api.js';
import { PATHS } from '../core/settings.js';
import { loadingHtml, errorHtml, emptyHtml, toast, confirmDialog, withBusy } from '../core/ui.js';
import { esc } from '../core/util.js';

const DAYS = [['sun', 'ראשון'], ['mon', 'שני'], ['tue', 'שלישי'], ['wed', 'רביעי'], ['thu', 'חמישי'], ['fri', 'שישי'], ['sat', 'שבת']];
const DAY_IDX = Object.fromEntries(DAYS.map(([k], i) => [k, i]));
const WEEK = 7 * 24 * 60;
const VALUE_RE = /g\.(\d{2}:\d{2})-(\d{2}:\d{2})\.([a-z]{3})-([a-z]{3})/;

export function parseTimes(content) {
  const lines = String(content).split('\n');
  const filters = [];
  let checkAccess = null;
  let yesGoto = null;
  lines.forEach((line, index) => {
    const t = line.trim();
    if (t.startsWith('check_access_filter=')) checkAccess = t.split('=')[1];
    else if (t.replace(/^;/, '').startsWith('access_filter_yes_goto=')) { if (!t.startsWith(';')) yesGoto = t.split('=')[1]; }
    else {
      const m = t.match(/^(,)?(access_filter_\d+)=(.*)$/);
      if (m) filters.push({ enabled: !m[1], key: m[2], value: m[3], parsed: m[3].match(VALUE_RE), index });
    }
  });
  filters.sort((a, b) => parseInt(a.key.split('_')[2], 10) - parseInt(b.key.split('_')[2], 10));
  const mode = checkAccess === 'no' ? 'open' : yesGoto === '3' ? 'closed' : 'filter';
  return { lines, filters, mode };
}

const toMin = (day, time) => { const [h, m] = time.split(':').map(Number); return (DAY_IDX[day] || 0) * 1440 + h * 60 + m; };
const fromMin = (total) => { const x = (total % WEEK + WEEK) % WEEK; const d = Math.floor(x / 1440); const r = x % 1440; return { day: DAYS[d][1], time: `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}` }; };
const fmtDiff = (m) => { const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60); const mm = m % 60; const p = []; if (d) p.push(`${d} ימים`); if (h) p.push(`${h} שעות`); if (mm) p.push(`${mm} דקות`); return p.join(', ') || 'פחות מדקה'; };

/** Merge active rules into weekly open slots [{start,end}] in minutes. */
export function slotsOf(filters) {
  const slots = [];
  filters.filter((f) => f.enabled && f.parsed).forEach((f) => {
    const [, st, et, sd, ed] = f.parsed;
    const start = toMin(sd, st);
    let end = toMin(ed, et);
    if (et === '00:00') { end = toMin(ed, '00:00') + 1440; if (ed !== 'sat') end %= WEEK; else if (end > WEEK) end = WEEK; }
    if (end < start) { slots.push({ start, end: WEEK }); slots.push({ start: 0, end }); } else slots.push({ start, end });
  });
  slots.sort((a, b) => a.start - b.start);
  const merged = [];
  slots.forEach((s) => { const last = merged[merged.length - 1]; if (last && s.start <= last.end) last.end = Math.max(last.end, s.end); else merged.push({ ...s }); });
  return merged;
}

/** Human status for the current moment. */
export function timeStatus(model) {
  if (model.mode === 'open') return { open: true, text: 'המערכת פתוחה (כניסה חופשית ללא הגבלה)' };
  if (model.mode === 'closed') return { open: false, text: 'המערכת סגורה (חסימה יזומה)' };
  const merged = slotsOf(model.filters);
  if (!merged.length) return { open: false, text: 'המערכת סגורה (אין כללי סינון פעילים)' };
  const d = new Date();
  const now = d.getDay() * 1440 + d.getHours() * 60 + d.getMinutes();
  // treat wrap-around as one continuous slot
  const wrap = merged.length > 1 && merged[0].start === 0 && merged[merged.length - 1].end === WEEK;
  const inside = merged.find((s) => now >= s.start && now < s.end);
  if (inside) {
    let end = inside.end;
    if (wrap && end === WEEK) end = WEEK + merged[0].end;
    const e = fromMin(end);
    return { open: true, text: `המערכת פתוחה כעת. הסגירה הבאה ביום ${e.day} בשעה ${e.time} (בעוד ${fmtDiff(end - now)})` };
  }
  const next = merged.find((s) => s.start > now) || { start: merged[0].start + WEEK };
  const s = fromMin(next.start);
  return { open: false, text: `המערכת סגורה כעת. הפתיחה הבאה ביום ${s.day} בשעה ${s.time} (בעוד ${fmtDiff(next.start - now)})` };
}

export function mount(el) {
  let model = null;
  el.innerHTML = `
    <div class="page-head"><div><h1>ניהול זמנים</h1><p class="page-sub">מתי המערכת פתוחה לכניסת תלמידים</p></div>
      <div class="page-actions"><button class="btn btn-ghost icon-only" data-cmd="refresh" title="רענון"><i class="fa-solid fa-rotate"></i></button></div></div>
    <div id="tm">${loadingHtml('טוען הגדרות זמנים...')}</div>`;
  const box = el.querySelector('#tm');

  async function load() {
    box.innerHTML = loadingHtml('טוען הגדרות זמנים...');
    try {
      const content = await api.getText(PATHS.timeIni);
      if (content === null) { box.innerHTML = emptyHtml('לא נמצא קובץ הגדרות זמנים (ext.ini).', 'fa-clock'); return; }
      model = parseTimes(content);
      render();
    } catch (e) { box.innerHTML = errorHtml(e); }
  }

  function ruleRow(f) {
    const [st, et, sd, ed] = f.parsed ? [f.parsed[1], f.parsed[2], f.parsed[3], f.parsed[4]] : ['00:00', '23:59', 'sun', 'sun'];
    const daySel = (cls, v) => `<select class="input input-sm ${cls}">${DAYS.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    return `<div class="rule ${f.deleted ? 'is-deleted' : ''}" data-key="${esc(f.key)}">
      <label class="switch"><input type="checkbox" class="r-on" ${f.enabled ? 'checked' : ''}><span></span></label>
      <span class="rule-txt">מיום</span>${daySel('r-sd', sd)}<span class="rule-txt">בשעה</span><input type="time" class="input input-sm r-st" value="${st}">
      <span class="rule-txt">עד יום</span>${daySel('r-ed', ed)}<span class="rule-txt">בשעה</span><input type="time" class="input input-sm r-et" value="${et}">
      <button class="icon-btn danger r-del" title="${f.deleted ? 'ביטול מחיקה' : 'מחיקת כלל'}"><i class="fa-solid ${f.deleted ? 'fa-rotate-left' : 'fa-trash'}"></i></button>
    </div>`;
  }

  function timeline() {
    const slots = slotsOf(model.filters);
    const d = new Date();
    const now = (d.getDay() * 1440 + d.getHours() * 60 + d.getMinutes()) / WEEK * 100;
    return `<div class="timeline">
      <div class="tl-track">${model.mode === 'filter' ? slots.map((s) => `<span class="tl-slot" style="right:${(s.start / WEEK) * 100}%;width:${((s.end - s.start) / WEEK) * 100}%"></span>`).join('') : model.mode === 'open' ? '<span class="tl-slot" style="right:0;width:100%"></span>' : ''}
        <span class="tl-now" style="right:${now}%" title="עכשיו"></span></div>
      <div class="tl-days">${DAYS.map(([, l]) => `<span>${l}</span>`).join('')}</div></div>`;
  }

  function render() {
    const st = timeStatus(model);
    const banner = {
      open: ['fa-door-open', 'כניסה חופשית פעילה', 'הסינון לפי שעות עקוף — המערכת פתוחה לכולם עד לביטול ידני.'],
      closed: ['fa-door-closed', 'המערכת סגורה', 'הסינון לפי שעות עקוף — אף משתמש לא יוכל להיכנס עד לביטול ידני.'],
      filter: ['fa-filter', 'סינון לפי שעות', 'הכניסה מנוהלת אוטומטית לפי הכללים שלמטה.'],
    }[model.mode];
    box.innerHTML = `
      <section class="panel status-panel ${st.open ? 'is-open' : 'is-closed'}">
        <div class="status-main"><i class="fa-solid ${banner[0]}"></i><div><h3>${banner[1]}</h3><p>${banner[2]}</p></div></div>
        <p class="status-now"><i class="fa-solid ${st.open ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> ${esc(st.text)}</p>
        ${timeline()}
        <div class="seg">
          <button class="btn ${model.mode === 'filter' ? 'btn-primary' : 'btn-ghost'}" data-mode="filter"><i class="fa-solid fa-filter"></i> לפי שעות</button>
          <button class="btn ${model.mode === 'open' ? 'btn-success' : 'btn-ghost'}" data-mode="open"><i class="fa-solid fa-door-open"></i> פתוח לכולם</button>
          <button class="btn ${model.mode === 'closed' ? 'btn-danger' : 'btn-ghost'}" data-mode="closed"><i class="fa-solid fa-door-closed"></i> סגור לכולם</button>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h3><i class="fa-solid fa-list-check"></i> כללי סינון שבועיים</h3>
          <button class="btn btn-ghost btn-sm" data-cmd="add-rule"><i class="fa-solid fa-plus"></i> כלל חדש</button></div>
        <div class="rules">${model.filters.map(ruleRow).join('') || '<p class="muted">אין כללים מוגדרים.</p>'}</div>
        <div class="panel-foot"><span class="muted small dirty-note" hidden>יש שינויים שלא נשמרו</span>
          <button class="btn btn-primary" data-cmd="save"><i class="fa-solid fa-floppy-disk"></i> שמירת הכללים</button></div>
      </section>`;
  }

  function collect() {
    box.querySelectorAll('.rule').forEach((row) => {
      const f = model.filters.find((x) => x.key === row.dataset.key);
      if (!f) return;
      f.enabled = row.querySelector('.r-on').checked;
      const st = row.querySelector('.r-st').value || '00:00';
      const et = row.querySelector('.r-et').value || '00:00';
      const sd = row.querySelector('.r-sd').value;
      const ed = row.querySelector('.r-ed').value;
      const extra = f.value && VALUE_RE.test(f.value) ? f.value.replace(VALUE_RE, '') : '.*.*.*.*.*.*.*';
      f.value = `g.${st}-${et}.${sd}-${ed}${extra}`;
      f.parsed = f.value.match(VALUE_RE);
    });
  }

  async function saveRules() {
    collect();
    const active = model.filters.filter((f) => f.enabled && !f.deleted);
    const inactive = model.filters.filter((f) => !f.enabled && !f.deleted);
    const out = [];
    let n = 1;
    const aq = [...active];
    const iq = [...inactive];
    model.lines.forEach((line) => {
      const m = line.trim().match(/^(,)?(access_filter_\d+)=/);
      if (!m) { out.push(line); return; }
      if (aq.length) out.push(`access_filter_${n++}=${aq.shift().value}`);
      else if (iq.length) { const f = iq.shift(); out.push(`,${f.key}=${f.value}`); }
    });
    while (aq.length) out.push(`access_filter_${n++}=${aq.shift().value}`);
    while (iq.length) { const f = iq.shift(); out.push(`,${f.key}=${f.value}`); }
    await api.uploadText(PATHS.timeIni, out.join('\n'));
    toast('כללי הזמן נשמרו בהצלחה', 'success');
    load();
  }

  async function changeMode(mode) {
    if (mode === model.mode) return;
    const label = { open: 'לפתוח את המערכת לכולם', closed: 'לסגור את המערכת לכולם', filter: 'לחזור לסינון לפי שעות' }[mode];
    if (!(await confirmDialog({ title: 'שינוי מצב המערכת', danger: mode === 'closed', message: `האם ${label}?`, confirmText: 'אישור' }))) return;
    const lines = [...model.lines];
    const yi = lines.findIndex((l) => l.trim().replace(/^;/, '').startsWith('access_filter_yes_goto='));
    if (yi !== -1) lines.splice(yi, 1);
    let ci = lines.findIndex((l) => l.trim().startsWith('check_access_filter='));
    const val = mode === 'open' ? 'check_access_filter=no' : 'check_access_filter=yes';
    if (ci !== -1) lines[ci] = val; else { ci = lines.length; lines.push(val); }
    if (mode === 'closed') lines.splice(ci + 1, 0, 'access_filter_yes_goto=3');
    await api.uploadText(PATHS.timeIni, lines.join('\n'));
    toast('מצב המערכת עודכן', 'success');
    load();
  }

  box.addEventListener('input', () => { const n = box.querySelector('.dirty-note'); if (n) n.hidden = false; });
  box.addEventListener('change', () => { const n = box.querySelector('.dirty-note'); if (n) n.hidden = false; });
  el.addEventListener('click', async (e) => {
    const modeBtn = e.target.closest('[data-mode]');
    if (modeBtn) { withBusy(modeBtn, () => changeMode(modeBtn.dataset.mode).catch((er) => toast(er.message, 'error'))); return; }
    const del = e.target.closest('.r-del');
    if (del) {
      collect();
      const f = model.filters.find((x) => x.key === del.closest('.rule').dataset.key);
      if (f.isNew) model.filters.splice(model.filters.indexOf(f), 1); else f.deleted = !f.deleted;
      render();
      box.querySelector('.dirty-note').hidden = false;
      return;
    }
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    if (b.dataset.cmd === 'refresh') load();
    if (b.dataset.cmd === 'add-rule') {
      collect();
      const max = model.filters.reduce((mx, f) => Math.max(mx, parseInt(f.key.split('_')[2], 10) || 0), 0);
      const value = 'g.08:00-16:00.sun-sun.*.*.*.*.*.*.*';
      model.filters.push({ isNew: true, enabled: true, key: `access_filter_${max + 1}`, value, parsed: value.match(VALUE_RE) });
      render();
      box.querySelector('.dirty-note').hidden = false;
    }
    if (b.dataset.cmd === 'save') withBusy(b, () => saveRules().catch((er) => toast(`שגיאה בשמירה: ${er.message}`, 'error', 8000)), 'שומר...');
  });
  load();
}
