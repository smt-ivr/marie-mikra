// Tzintukim: scheduled tasks and the tzintuk list.
import { call } from '../core/api.js';
import { PATHS } from '../core/settings.js';
import { createTable, loadingHtml, errorHtml, emptyHtml, toast, openModal, confirmDialog } from '../core/ui.js';
import { esc } from '../core/util.js';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const STATUS = { PENDING: 'ממתין', RUNNING: 'בריצה', DONE: 'הסתיים', ERROR: 'שגיאה', NOT_ACTIVE: 'לא פעיל' };
const TYPES = { RunTzintuk: 'צינתוק', SendSMS: 'שליחת SMS', MoveOnFile: 'העברת קובץ' };
const LIST_TYPES = { tzl: 'צינתוקים חינמיים', tpl: 'רשימת תפוצה' };
const LOG_TYPES = {
  AddToListTzintuk: ['הוספה לרשימה', 'ok'], RunTzintuk: ['הפעלת צינתוק', 'info'],
  RemovingToListTzintuk: ['הסרה מהרשימה', 'bad'], AdminRemovingToListTzintuk: ['הסרה ע"י מנהל', 'bad'], ResetToListTzintuk: ['איפוס רשימה', 'muted'],
};

const pad = (n) => String(n ?? 0).padStart(2, '0');
function daysText(daysStr, ifAnyDay) {
  const days = daysStr ? String(daysStr).split(',').filter(Boolean) : [];
  const any = ifAnyDay !== undefined && ifAnyDay !== null ? !!Number(ifAnyDay) || ifAnyDay === true : days.length === 0 || days.length === 7;
  if (any) return 'כל יום';
  return days.length ? days.map(Number).sort((a, b) => a - b).map((d) => DAYS[d]).join(', ') : 'לא מוגדר';
}
function daysForApi(daysStr) {
  const days = daysStr ? String(daysStr).split(',') : [];
  const o = {};
  for (let i = 0; i < 7; i++) o[i] = days.includes(String(i)) ? 1 : 0;
  return JSON.stringify(o);
}

export function mount(el, ctx) {
  const tab = ctx.sub === 'list' ? 'list' : 'tasks';
  el.innerHTML = `
    <div class="page-head"><div><h1>ניהול צינתוקים</h1></div>
      <div class="page-actions"><button class="btn btn-ghost icon-only" data-cmd="refresh" title="רענון"><i class="fa-solid fa-rotate"></i></button></div></div>
    <nav class="tabs"><a href="#/tzintuk" class="${tab === 'tasks' ? 'active' : ''}"><i class="fa-solid fa-calendar-check"></i> משימות מתוזמנות</a>
      <a href="#/tzintuk/list" class="${tab === 'list' ? 'active' : ''}"><i class="fa-solid fa-list"></i> רשימת צינתוקים</a></nav>
    <div id="tz"></div>`;
  const box = el.querySelector('#tz');
  const load = tab === 'tasks' ? () => tasksView(box) : () => listView(box);
  el.querySelector('[data-cmd=refresh]').onclick = load;
  load();
}

// ---------------- Tasks ----------------

async function tasksView(box) {
  box.innerHTML = loadingHtml('טוען משימות...');
  let tasks = [];
  try {
    const res = await call('GetTasks');
    tasks = await Promise.all((res.tasks || []).map((t) => call('GetTasksData', { TaskId: t.id })));
  } catch (e) { box.innerHTML = errorHtml(e); return; }
  if (!tasks.length) { box.innerHTML = emptyHtml('לא נמצאו משימות מתוזמנות.', 'fa-calendar'); return; }
  box.innerHTML = '<section class="panel"><div id="tz-table"></div></section>';
  createTable(box.querySelector('#tz-table'), {
    rows: tasks, rowId: (t) => t.id,
    columns: [
      { key: 'id', label: 'מזהה', className: 'mono' },
      { key: 'description', label: 'תיאור', render: (t) => `<strong>${esc(t.description)}</strong>` },
      { key: 'type', label: 'סוג', value: (t) => TYPES[t.type] || t.type },
      { key: 'status', label: 'סטטוס', render: (t) => `<span class="badge st-${esc(t.status)}">${esc(STATUS[t.status] || t.status)}</span>` },
      { key: 'time', label: 'שעה', value: (t) => `${pad(t.hour)}:${pad(t.minute)}`, className: 'ltr-cell' },
      { key: 'days', label: 'ימים', value: (t) => daysText(t.days_of_week, t.ifAnyDay) },
      { key: 'nextRun', label: 'ריצה הבאה', value: (t) => t.nextRun || '—', className: 'ltr-cell nowrap' },
      { key: 'active', label: 'פעילה', sortable: false, render: (t) => `<label class="switch"><input type="checkbox" class="t-active" ${t.active ? 'checked' : ''}><span></span></label>` },
    ],
    actions: () => `<button class="icon-btn" data-action="details" title="פרטים"><i class="fa-solid fa-eye"></i></button>
      <button class="icon-btn" data-action="edit" title="עריכה"><i class="fa-solid fa-pen"></i></button>
      <button class="icon-btn" data-action="log" title="יומן ריצה"><i class="fa-solid fa-clock-rotate-left"></i></button>`,
    onAction: (a, t) => { if (a === 'details') details(t); if (a === 'edit') edit(t, () => tasksView(box)); if (a === 'log') log(t); },
  });
  box.onchange = async (e) => {
    if (!e.target.classList.contains('t-active')) return;
    const id = e.target.closest('tr').dataset.id;
    const t = tasks.find((x) => String(x.id) === id);
    e.target.disabled = true;
    try {
      await updateTask(t, { active: e.target.checked ? 1 : 0 });
      toast(e.target.checked ? 'המשימה הופעלה' : 'המשימה הושבתה', 'success');
      tasksView(box);
    } catch (er) {
      toast(er.message, 'error');
      e.target.checked = !e.target.checked;
      e.target.disabled = false;
    }
  };
}

function updateTask(t, overrides = {}) {
  const anyDay = t.ifAnyDay !== undefined && t.ifAnyDay !== null ? (t.ifAnyDay ? 1 : 0) : 0;
  const params = {
    TaskId: t.id, description: t.description, hour: t.hour, minute: t.minute, year: t.year, day: t.day, month: t.month,
    mailInEnd: t.sendMailInEnd ? 1 : 0, mailInError: t.sendMailInError ? 1 : 0, ifAnyDay: anyDay, active: t.active ? 1 : 0,
    ...(anyDay ? {} : { days: daysForApi(t.days_of_week) }),
    ...overrides,
  };
  return call('UpdateTask', params);
}

function details(t) {
  let ad = {};
  try { ad = JSON.parse(t.action_data || '{}'); } catch { /* ignore */ }
  const item = (k, v, ltr) => `<div class="kv"><span>${k}</span><strong ${ltr ? 'dir="ltr"' : ''}>${esc(v ?? '—')}</strong></div>`;
  let action = '';
  if (t.type === 'RunTzintuk') action = item('זיהוי יוצא', ad.FROM, 1) + item('מזהה רשימה', ad.LIST) + item('סוג רשימה', `${LIST_TYPES[ad.MODE] || ad.MODE || '—'}`);
  else if (t.type === 'SendSMS') action = item('זיהוי יוצא', ad.FROM, 1) + item('רשימת תפוצה', ad.LIST) + `<div class="kv kv-wide"><span>תוכן</span><pre>${esc(ad.MESSAGE || '')}</pre></div>`;
  else if (t.type === 'MoveOnFile') action = item('תיקיית מקור', ad.FOLDER, 1) + item('תיקיית יעד', ad.TARGET, 1) + item('סוג קובץ', ad.TYPE);
  else action = `<div class="kv kv-wide"><pre dir="ltr">${esc(JSON.stringify(ad, null, 2))}</pre></div>`;
  openModal({ title: `פרטי משימה: ${t.description}`, icon: 'fa-circle-info', size: 'md', body: `
    <div class="kv-grid">${item('מזהה', t.id)}${item('סוג', TYPES[t.type] || t.type)}${item('סטטוס', STATUS[t.status] || t.status)}${item('פעילה', t.active ? 'כן' : 'לא')}
      ${item('שעה', `${pad(t.hour)}:${pad(t.minute)}`, 1)}${item('ימים', daysText(t.days_of_week, t.ifAnyDay))}${item('ריצה הבאה', t.nextRun, 1)}${item('ריצה אחרונה', t.lastRun, 1)}
      ${item('נוצרה', t.createTs, 1)}${item('עודכנה', t.updateTs, 1)}${item('מונע ריצה בשבת', t.check_is_kodesh ? 'כן' : 'לא')}
      ${item('מייל בסיום', t.sendMailInEnd ? 'כן' : 'לא')}${item('מייל בשגיאה', t.sendMailInError ? 'כן' : 'לא')}</div>
    <h4>פרטי הפעולה</h4><div class="kv-grid">${action}</div>` });
}

function edit(t, onSaved) {
  const days = t.days_of_week ? String(t.days_of_week).split(',') : [];
  const anyDay = t.ifAnyDay !== undefined && t.ifAnyDay !== null ? !!t.ifAnyDay : days.length === 0 || days.length === 7;
  const m = openModal({
    title: `עריכת משימה`, icon: 'fa-pen', size: 'md',
    body: `<form class="form" novalidate>
      <label class="field"><span>תיאור</span><input class="input" name="description" value="${esc(t.description)}" required></label>
      <label class="field"><span>שעת ריצה</span><input class="input" type="time" name="time" value="${pad(t.hour)}:${pad(t.minute)}" required></label>
      <div class="field"><span>ימים</span><div class="day-picker">${DAYS.map((d, i) => `<label><input type="checkbox" value="${i}" ${!anyDay && days.includes(String(i)) ? 'checked' : ''} ${anyDay ? 'disabled' : ''}><span>${d}</span></label>`).join('')}</div>
        <label class="check"><input type="checkbox" name="anyDay" ${anyDay ? 'checked' : ''}> כל הימים</label></div>
      <label class="check"><input type="checkbox" name="mailInEnd" ${t.sendMailInEnd ? 'checked' : ''}> מייל בכל הצלחה</label>
      <label class="check"><input type="checkbox" name="mailInError" ${t.sendMailInError ? 'checked' : ''}> מייל בכל כישלון</label>
      <p class="field-error" hidden></p></form>`,
    footer: '<button class="btn btn-ghost" data-act="cancel">ביטול</button><button class="btn btn-primary" data-act="save"><i class="fa-solid fa-floppy-disk"></i> שמירה</button>',
  });
  const f = m.body.querySelector('form');
  f.anyDay.onchange = () => m.body.querySelectorAll('.day-picker input').forEach((i) => { i.disabled = f.anyDay.checked; });
  m.footer.querySelector('[data-act=cancel]').onclick = () => m.close();
  m.footer.querySelector('[data-act=save]').onclick = async (e) => {
    const btn = e.currentTarget;
    const [hour, minute] = f.time.value.split(':').map((x) => parseInt(x, 10));
    const params = {
      TaskId: t.id, description: f.description.value.trim(), hour, minute,
      mailInEnd: f.mailInEnd.checked ? 1 : 0, mailInError: f.mailInError.checked ? 1 : 0,
      ifAnyDay: f.anyDay.checked ? 1 : 0, active: t.active ? 1 : 0,
    };
    if (!f.anyDay.checked) {
      const o = {};
      m.body.querySelectorAll('.day-picker input').forEach((i) => { o[i.value] = i.checked ? 1 : 0; });
      params.days = JSON.stringify(o);
    }
    btn.disabled = true;
    try {
      await call('UpdateTask', params);
      m.close();
      toast('המשימה עודכנה', 'success');
      onSaved();
    } catch (er) {
      const err = m.body.querySelector('.field-error');
      err.textContent = er.message;
      err.hidden = false;
      btn.disabled = false;
    }
  };
}

async function log(t) {
  const m = openModal({ title: `יומן ריצה: ${t.description}`, icon: 'fa-clock-rotate-left', size: 'lg', body: loadingHtml() });
  try {
    const res = await call('GetTasksLogs', { TaskId: t.id });
    const logs = res.logs || [];
    if (!logs.length) { m.setBody(emptyHtml('אין רישומים ביומן.')); return; }
    m.setBody('<div id="lg"></div>');
    createTable(m.body.querySelector('#lg'), {
      rows: logs, rowId: (l) => l.id,
      columns: [
        { key: 'id', label: 'מזהה ריצה', className: 'mono' },
        { key: 'ts', label: 'זמן', className: 'ltr-cell nowrap' },
        { key: 'succeeded', label: 'תוצאה', render: (l) => (l.succeeded ? '<span class="badge badge-ok">הצלחה</span>' : '<span class="badge badge-bad">כישלון</span>') },
        { key: 'error_message', label: 'פירוט' },
      ],
    });
  } catch (e) { m.setBody(errorHtml(e)); }
}

// ---------------- List ----------------

async function listView(box) {
  box.innerHTML = loadingHtml();
  const listId = PATHS.tzintukListId;
  try {
    const [list, logRes] = await Promise.all([
      call('TzintukimListManagement', { action: 'getlistEnteres', TzintukimList: listId }),
      call('TzintukimListManagement', { action: 'getLogList', TzintukimList: listId }),
    ]);
    box.innerHTML = `
      <section class="stats">
        <div class="stat"><span class="stat-l">סה"כ ברשימה</span><span class="stat-v">${esc(list.countSubscribers || 0)}</span></div>
        <div class="stat"><span class="stat-l">פעילים</span><span class="stat-v ok">${esc(list.countsActive || 0)}</span></div>
        <div class="stat"><span class="stat-l">חסומים</span><span class="stat-v bad">${esc(list.countsBlocked || 0)}</span></div>
        <div class="stat stat-action"><button class="btn btn-primary" data-cmd="run"><i class="fa-solid fa-bell"></i> הפעלת צינתוק עכשיו</button></div>
      </section>
      <div class="two-col">
        <section class="panel"><div class="panel-head"><h3><i class="fa-solid fa-users"></i> מספרים ברשימה</h3></div><div id="tz-subs"></div></section>
        <section class="panel"><div class="panel-head"><h3><i class="fa-solid fa-clock-rotate-left"></i> יומן פעולות</h3></div><div id="tz-log"></div></section>
      </div>`;
    createTable(box.querySelector('#tz-subs'), {
      rows: list.enteres || [], emptyText: 'אין מספרים ברשימה',
      columns: [
        { key: 'phone', label: 'טלפון', className: 'ltr-cell' },
        { key: 'name', label: 'שם' },
        { key: 'active', label: 'סטטוס', render: (s) => (s.active ? '<span class="badge badge-ok">פעיל</span>' : '<span class="badge badge-bad">חסום</span>') },
      ],
    });
    createTable(box.querySelector('#tz-log'), {
      rows: (logRes.events || []).slice().reverse(), emptyText: 'אין אירועים ביומן',
      columns: [
        { key: 'Date', label: 'תאריך', className: 'ltr-cell nowrap' },
        { key: 'Time', label: 'שעה', className: 'ltr-cell' },
        { key: 'TypeOperation', label: 'פעולה', render: (ev) => { const [l, c] = LOG_TYPES[ev.TypeOperation] || [ev.TypeOperation, 'muted']; return `<span class="badge badge-${c}">${esc(l)}</span>`; } },
        { key: 'phone', label: 'טלפון', value: (ev) => ev.PhoneAction || ev.Phone, className: 'ltr-cell' },
      ],
    });
    box.querySelector('[data-cmd=run]').onclick = () => runTzintuk(listId, () => listView(box));
  } catch (e) { box.innerHTML = errorHtml(e); }
}

function runTzintuk(defaultList, onDone) {
  const m = openModal({
    title: 'הפעלת צינתוק', icon: 'fa-bell', size: 'sm',
    body: `<form class="form"><label class="field"><span>מזהה רשימת צינתוקים</span><input class="input" name="list" value="${esc(defaultList)}"></label>
      <label class="field"><span>זמן צלצול (1–16 שניות)</span><input class="input" type="number" name="timeout" min="1" max="16" value="16"></label>
      <p class="field-error" hidden></p></form>`,
    footer: '<button class="btn btn-ghost" data-act="cancel">ביטול</button><button class="btn btn-primary" data-act="run"><i class="fa-solid fa-play"></i> הפעלה</button>',
  });
  const f = m.body.querySelector('form');
  const err = m.body.querySelector('.field-error');
  m.footer.querySelector('[data-act=cancel]').onclick = () => m.close();
  m.footer.querySelector('[data-act=run]').onclick = async (e) => {
    const btn = e.currentTarget;
    const list = f.list.value.trim();
    const timeout = parseInt(f.timeout.value, 10);
    if (!list || !(timeout >= 1 && timeout <= 16)) { err.textContent = 'יש למלא מזהה רשימה וזמן צלצול בין 1 ל-16.'; err.hidden = false; return; }
    if (!(await confirmDialog({ title: 'אישור הפעלה', message: `להפעיל צינתוק לרשימה ${esc(list)} עכשיו?`, confirmText: 'הפעלה' }))) return;
    btn.disabled = true;
    try {
      const r = await call('RunTzintuk', { TzintukTimeOut: timeout, phones: `tzl:${list}` });
      m.close();
      openModal({ title: 'הצינתוק הופעל', icon: 'fa-circle-check', size: 'sm', body: `<div class="kv-grid">
        <div class="kv"><span>מזהה קמפיין</span><strong>${esc(r.campaignId)}</strong></div>
        <div class="kv"><span>סה"כ שיחות</span><strong>${esc(r.callsCount)}</strong></div>
        <div class="kv"><span>עלות</span><strong>${esc(r.biling)}</strong></div></div>` });
      onDone();
    } catch (er) {
      err.textContent = er.message;
      err.hidden = false;
      btn.disabled = false;
    }
  };
}
