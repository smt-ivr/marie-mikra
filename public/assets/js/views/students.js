// Students: list, add, edit, activate/deactivate, delete (single & bulk).
import * as api from '../core/api.js';
import { PATHS } from '../core/settings.js';
import { createTable, searchBox, loadingHtml, errorHtml, emptyHtml, toast, openModal, confirmDialog } from '../core/ui.js';
import { esc, debounce, exportCsv, eolOf } from '../core/util.js';

const DEFAULT_HEADERS = ['קוד', 'סטטוס', 'שם', 'משפחה', 'הערה', 'כיתה'];

function parse(content) {
  const lines = String(content || '').split(/\r?\n/);
  const headerParts = (lines[0] || '').trim().split(',');
  const headers = headerParts.length >= 6 ? headerParts : [...DEFAULT_HEADERS, ...headerParts.slice(6)];
  const students = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const p = line.split(',');
    if (!p[0]) continue;
    students.push({ id: p[0], status: p[1] || '1', firstName: p[2] || '', lastName: p[3] || '', note: p[4] || '', school: p[5] || '', extra: p.slice(6) });
  }
  return { headers, students, headerLine: lines[0] || DEFAULT_HEADERS.join(','), eol: eolOf(content) };
}

function serialize(model) {
  const out = [model.headerLine];
  model.students.forEach((s) => out.push([s.id, s.status, s.firstName, s.lastName, s.note, s.school, ...(s.extra || [])].join(',')));
  out.push('');
  return out.join(model.eol);
}

// The file is a plain comma-separated list, so commas/new lines inside values are not allowed.
const clean = (v) => String(v ?? '').replace(/[,\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

export function mount(el) {
  let model = null;
  let table = null;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>ניהול תלמידים</h1><p class="page-sub" id="st-meta"></p></div>
      <div class="page-actions">
        <button class="btn btn-primary" data-cmd="add"><i class="fa-solid fa-user-plus"></i> תלמיד חדש</button>
        <button class="btn btn-ghost icon-only" data-cmd="refresh" title="רענון"><i class="fa-solid fa-rotate"></i></button>
      </div>
    </div>
    <div id="st-body">${loadingHtml('טוען רשימת תלמידים...')}</div>`;
  const body = el.querySelector('#st-body');

  async function load() {
    body.innerHTML = loadingHtml('טוען רשימת תלמידים...');
    try {
      const [content, mtime] = await Promise.all([api.getText(PATHS.studentsIni), api.fileMTime(PATHS.studentsIni)]);
      if (content === null) { body.innerHTML = emptyHtml('לא נמצא קובץ תלמידים.', 'fa-users'); return; }
      model = parse(content);
      const active = model.students.filter((s) => s.status === '1').length;
      el.querySelector('#st-meta').textContent = `${model.students.length} תלמידים · ${active} פעילים${mtime ? ` · עודכן ${mtime}` : ''}`;
      render();
    } catch (e) {
      body.innerHTML = errorHtml(e);
    }
  }

  function render() {
    const h = model.headers;
    const classes = [...new Set(model.students.map((s) => s.school).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he', { numeric: true }));
    body.innerHTML = `
      <section class="panel">
        <div class="toolbar">
          ${searchBox('חיפוש תלמיד...')}
          <select class="input input-sm" id="st-class"><option value="">כל הכיתות</option>${classes.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
          <select class="input input-sm" id="st-status"><option value="">כל הסטטוסים</option><option value="1">פעילים</option><option value="0">מושבתים</option></select>
          <div class="toolbar-spacer"></div>
          <span class="sel-bar" hidden><span class="sel-count"></span>
            <button class="btn btn-sm btn-success" data-cmd="bulk-on"><i class="fa-solid fa-user-check"></i> הפעלה</button>
            <button class="btn btn-sm btn-ghost" data-cmd="bulk-off"><i class="fa-solid fa-user-slash"></i> השבתה</button>
            <button class="btn btn-sm btn-danger" data-cmd="bulk-del"><i class="fa-solid fa-trash"></i> מחיקה</button></span>
          <button class="btn btn-ghost btn-sm" data-cmd="csv"><i class="fa-solid fa-file-excel"></i> ייצוא</button>
        </div>
        <div id="st-table"></div>
      </section>`;
    const selBar = body.querySelector('.sel-bar');
    table = createTable(body.querySelector('#st-table'), {
      rows: model.students, rowId: (s) => s.id, selectable: true,
      columns: [
        { key: 'id', label: h[0] || 'קוד', className: 'mono' },
        { key: 'firstName', label: h[2] || 'שם', render: (s) => `<strong>${esc(s.firstName)}</strong>` },
        { key: 'lastName', label: h[3] || 'משפחה' },
        { key: 'school', label: h[5] || 'כיתה' },
        { key: 'note', label: h[4] || 'הערה' },
        { key: 'status', label: 'סטטוס', render: (s) => (s.status === '1' ? '<span class="badge badge-ok">פעיל</span>' : '<span class="badge badge-bad">מושבת</span>') },
      ],
      searchText: (s) => `${s.id} ${s.firstName} ${s.lastName} ${s.school} ${s.note}`,
      actions: (s) => `<button class="icon-btn" data-action="edit" title="עריכה"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn" data-action="toggle" title="${s.status === '1' ? 'השבתה' : 'הפעלה'}"><i class="fa-solid ${s.status === '1' ? 'fa-user-slash' : 'fa-user-check'}"></i></button>
        <button class="icon-btn danger" data-action="delete" title="מחיקה"><i class="fa-solid fa-trash"></i></button>`,
      onSelect: (sel) => { selBar.hidden = !sel.length; selBar.querySelector('.sel-count').textContent = `${sel.length} נבחרו`; },
      onAction: (a, s) => {
        if (a === 'edit') editStudent(s);
        if (a === 'toggle') mutate(`${s.status === '1' ? 'השבתת' : 'הפעלת'} ${s.firstName}`, (list) => list.forEach((x) => { if (x.id === s.id) x.status = x.status === '1' ? '0' : '1'; }));
        if (a === 'delete') confirmDialog({ title: 'מחיקת תלמיד', danger: true, message: `למחוק לצמיתות את <strong>${esc(`${s.firstName} ${s.lastName}`)}</strong> (קוד ${esc(s.id)})?`, confirmText: 'מחיקה' })
          .then((ok) => ok && mutate('התלמיד נמחק', (list) => list.splice(list.findIndex((x) => x.id === s.id), 1)));
      },
    });
    const s = body.querySelector('.search input');
    const cls = body.querySelector('#st-class');
    const status = body.querySelector('#st-status');
    const applyFilter = () => {
      const rows = model.students.filter((x) => (!cls.value || x.school === cls.value) && (!status.value || (status.value === '1' ? x.status === '1' : x.status !== '1')));
      table.setRows(rows);
      table.filter(s.value);
    };
    s.addEventListener('input', debounce(() => table.filter(s.value), 120));
    cls.onchange = applyFilter;
    status.onchange = applyFilter;
  }

  /** Re-read the file, apply the change to fresh data and save (avoids overwriting others' changes). */
  async function mutate(successMsg, fn) {
    try {
      const fresh = parse(await api.getText(PATHS.studentsIni) ?? '');
      fn(fresh.students);
      await api.uploadText(PATHS.studentsIni, serialize(fresh));
      toast(successMsg, 'success');
      await load();
      return true;
    } catch (e) {
      toast(`שגיאה בשמירה: ${e.message}`, 'error', 8000);
      return false;
    }
  }

  function editStudent(student) {
    const isNew = !student;
    const s = student || { id: '', firstName: '', lastName: '', note: '', school: '', status: '1' };
    const h = model.headers;
    const classes = [...new Set(model.students.map((x) => x.school).filter(Boolean))];
    const m = openModal({
      title: isNew ? 'הוספת תלמיד חדש' : 'עריכת פרטי תלמיד', icon: isNew ? 'fa-user-plus' : 'fa-user-pen', size: 'md',
      body: `<form class="form form-grid" novalidate>
          <label class="field"><span>${esc(h[0] || 'קוד')} *</span><input class="input" name="id" inputmode="numeric" value="${esc(s.id)}" required></label>
          <label class="field"><span>סטטוס</span><select class="input" name="status"><option value="1" ${s.status === '1' ? 'selected' : ''}>פעיל</option><option value="0" ${s.status !== '1' ? 'selected' : ''}>מושבת</option></select></label>
          <label class="field"><span>${esc(h[2] || 'שם')} *</span><input class="input" name="firstName" value="${esc(s.firstName)}" required></label>
          <label class="field"><span>${esc(h[3] || 'משפחה')}</span><input class="input" name="lastName" value="${esc(s.lastName)}"></label>
          <label class="field"><span>${esc(h[5] || 'כיתה')} *</span><input class="input" name="school" list="class-list" value="${esc(s.school)}" required>
            <datalist id="class-list">${classes.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
          <label class="field"><span>${esc(h[4] || 'הערה')}</span><input class="input" name="note" value="${esc(s.note)}"></label>
          <div class="alert alert-warning small span-2" id="id-warn" hidden><i class="fa-solid fa-triangle-exclamation"></i> שינוי קוד התלמיד אינו מעביר את הנקודות שצבר לקוד החדש. להעברת נקודות יש לפנות ל-S.M.T.</div>
          <p class="field-error span-2" hidden></p>
        </form>`,
      footer: '<button class="btn btn-ghost" data-act="cancel">ביטול</button><button class="btn btn-primary" data-act="save"><i class="fa-solid fa-floppy-disk"></i> שמירה</button>',
    });
    const form = m.body.querySelector('form');
    const err = m.body.querySelector('.field-error');
    if (!isNew) form.id.addEventListener('input', () => { m.body.querySelector('#id-warn').hidden = form.id.value.trim() === s.id; });
    m.footer.querySelector('[data-act=cancel]').onclick = () => m.close();
    const submit = async () => {
      const v = Object.fromEntries(['id', 'status', 'firstName', 'lastName', 'school', 'note'].map((k) => [k, clean(form[k].value)]));
      const problem = !v.id ? 'חובה להזין קוד תלמיד.' : !/^\d+$/.test(v.id) ? 'קוד התלמיד חייב להכיל ספרות בלבד.'
        : !v.firstName ? 'חובה להזין שם.' : !v.school ? 'חובה להזין כיתה.'
        : model.students.some((x) => x.id === v.id && (isNew || x.id !== s.id)) ? `הקוד ${v.id} כבר קיים במערכת.` : null;
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      const btn = m.footer.querySelector('[data-act=save]');
      btn.disabled = true;
      const ok = await mutate(isNew ? 'התלמיד נוסף' : 'פרטי התלמיד נשמרו', (list) => {
        if (list.some((x) => x.id === v.id && (isNew || x.id !== s.id))) throw new Error(`הקוד ${v.id} כבר קיים במערכת.`);
        if (isNew) list.push({ ...v, extra: [] });
        else {
          const i = list.findIndex((x) => x.id === s.id);
          if (i < 0) throw new Error('התלמיד לא נמצא בקובץ (אולי נמחק בינתיים).');
          list[i] = { ...list[i], ...v };
        }
      });
      if (ok) m.close(); else btn.disabled = false;
    };
    form.onsubmit = (e) => { e.preventDefault(); submit(); };
    m.footer.querySelector('[data-act=save]').onclick = submit;
    setTimeout(() => form[isNew ? 'id' : 'firstName'].focus(), 50);
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    const cmd = b.dataset.cmd;
    if (cmd === 'refresh') load();
    if (cmd === 'add' && model) editStudent(null);
    if (cmd === 'csv' && model) exportCsv(['קוד', 'שם', 'משפחה', 'כיתה', 'הערה', 'סטטוס'], (table ? table.filtered() : model.students).map((s) => [s.id, s.firstName, s.lastName, s.school, s.note, s.status === '1' ? 'פעיל' : 'מושבת']), 'תלמידים');
    if (cmd.startsWith('bulk-') && table) {
      const ids = new Set(table.selected().map((s) => s.id));
      if (!ids.size) return;
      const label = { 'bulk-on': 'להפעיל', 'bulk-off': 'להשבית', 'bulk-del': 'למחוק לצמיתות' }[cmd];
      const ok = await confirmDialog({ title: 'פעולה על תלמידים מסומנים', danger: cmd === 'bulk-del', message: `${label} ${ids.size} תלמידים מסומנים?`, confirmText: 'אישור' });
      if (!ok) return;
      mutate('הפעולה בוצעה', (list) => {
        if (cmd === 'bulk-del') { for (let i = list.length - 1; i >= 0; i--) if (ids.has(list[i].id)) list.splice(i, 1); }
        else list.forEach((x) => { if (ids.has(x.id)) x.status = cmd === 'bulk-on' ? '1' : '0'; });
      });
    }
  });
  load();
}
