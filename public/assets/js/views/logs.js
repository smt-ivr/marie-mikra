// Logs: password log and EnterID log.
import * as api from '../core/api.js';
import { PATHS } from '../core/settings.js';
import { createTable, searchBox, loadingHtml, errorHtml, emptyHtml } from '../core/ui.js';
import { esc, debounce, exportCsv } from '../core/util.js';

function parsePasswordLog(text) {
  const rows = [];
  String(text || '').split('\n').forEach((line) => {
    if (!line.trim()) return;
    const date = line.match(/Date-([\d-]+)/);
    if (!date) return;
    const dp = date[1].split('-');
    const status = (line.match(/Password-(OK|ERROR)/) || [])[1] || 'UNKNOWN';
    const phone = (line.match(/Phone-(\d+)/) || [])[1] || '—';
    const time = (line.match(/\.(\d{2}:\d{2}:\d{2})/) || [])[1] || '00:00:00';
    const raw = (line.match(/^([^.]+)\./) || [])[1] || '?';
    const path = raw.includes('-') ? raw.split('-').slice(1).join('-') : raw;
    rows.push({ date: dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : date[1], sortKey: `${date[1]} ${time}`, time, phone, status, path });
  });
  return rows.reverse();
}

const toTs = (d, t) => {
  const p = String(d || '').split('/');
  if (p.length < 3) return 0;
  const tp = String(t || '00:00:00').split(':');
  return new Date(p[2], p[1] - 1, p[0], tp[0], tp[1], tp[2] || 0).getTime();
};

export function mount(el, ctx) {
  const type = ctx.sub === 'enterid' ? 'enterid' : 'password';
  el.innerHTML = `
    <div class="page-head"><div><h1>צפייה בלוגים</h1><p class="page-sub" id="lg-meta"></p></div>
      <div class="page-actions"><button class="btn btn-ghost icon-only" data-cmd="refresh" title="רענון"><i class="fa-solid fa-rotate"></i></button></div></div>
    <nav class="tabs"><a href="#/logs" class="${type === 'password' ? 'active' : ''}"><i class="fa-solid fa-key"></i> לוג סיסמאות</a>
      <a href="#/logs/enterid" class="${type === 'enterid' ? 'active' : ''}"><i class="fa-solid fa-id-card"></i> לוג כניסות</a></nav>
    <section class="panel"><div class="toolbar">${searchBox('חיפוש חופשי (שם, טלפון, שלוחה)...')}
      ${type === 'password'
        ? '<select class="input input-sm" id="lg-status"><option value="">כל הסטטוסים</option><option value="OK">כניסה אושרה</option><option value="ERROR">סיסמה שגויה</option></select>'
        : '<input class="input input-sm" id="lg-id" placeholder="סינון לפי קוד תלמיד" inputmode="numeric">'}
      <div class="toolbar-spacer"></div><button class="btn btn-ghost btn-sm" data-cmd="csv"><i class="fa-solid fa-file-excel"></i> ייצוא</button></div>
      <div id="lg-table">${loadingHtml()}</div></section>`;
  const box = el.querySelector('#lg-table');
  const meta = el.querySelector('#lg-meta');
  let rows = [];
  let table;
  let columns;

  async function load() {
    box.innerHTML = loadingHtml();
    try {
      if (type === 'password') {
        const { contents, file } = await api.getTextWithMeta(PATHS.passwordLog);
        rows = parsePasswordLog(contents);
        meta.textContent = `${rows.length} רשומות${file?.mtime ? ` · עודכן ${file.mtime}` : ''}`;
        columns = [
          { key: 'date', label: 'תאריך', value: (r) => r.date, className: 'nowrap ltr-cell' },
          { key: 'time', label: 'שעה', className: 'ltr-cell' },
          { key: 'phone', label: 'טלפון', className: 'ltr-cell' },
          { key: 'status', label: 'סטטוס', render: (r) => (r.status === 'OK' ? '<span class="badge badge-ok"><i class="fa-solid fa-check"></i> כניסה אושרה</span>' : '<span class="badge badge-bad"><i class="fa-solid fa-xmark"></i> סיסמה שגויה</span>') },
          { key: 'path', label: 'שלוחה' },
        ];
      } else {
        try { rows = await api.renderYmgr(PATHS.enterIdLog); } catch (e) { if (api.isNotFound(e)) rows = []; else throw e; }
        rows.sort((a, b) => toTs(b['תאריך'], b['שעה']) - toTs(a['תאריך'], a['שעה']));
        meta.textContent = `${rows.length} רשומות`;
        columns = ['תאריך', 'שעה', 'שם', 'טלפון', 'סוג זיהוי', 'מספר זיהוי', 'שלוחה'].map((h) => ({
          key: h, label: h, value: (r) => r[h] ?? '', className: /תאריך|שעה|טלפון/.test(h) ? 'ltr-cell nowrap' : '',
          render: h === 'שם' ? (r) => `<strong>${esc(r[h] || '')}</strong>` : undefined,
        }));
      }
      if (!rows.length) { box.innerHTML = emptyHtml('אין רשומות בלוג.', 'fa-file-lines'); return; }
      table = createTable(box, { rows, columns });
      apply();
    } catch (e) { box.innerHTML = errorHtml(e); }
  }

  const search = el.querySelector('.search input');
  const status = el.querySelector('#lg-status');
  const idFilter = el.querySelector('#lg-id');
  function apply() {
    if (!table) return;
    let list = rows;
    if (status && status.value) list = list.filter((r) => r.status === status.value);
    if (idFilter && idFilter.value.trim()) list = list.filter((r) => String(r['מספר זיהוי'] || '').includes(idFilter.value.trim()));
    table.setRows(list);
    table.filter(search.value);
  }
  search.addEventListener('input', debounce(apply, 120));
  if (status) status.onchange = apply;
  if (idFilter) idFilter.addEventListener('input', debounce(apply, 120));
  el.querySelector('[data-cmd=refresh]').onclick = load;
  el.querySelector('[data-cmd=csv]').onclick = () => {
    if (!table) return;
    exportCsv(columns.map((c) => c.label), table.filtered().map((r) => columns.map((c) => (c.value ? c.value(r) : r[c.key]))), type === 'password' ? 'לוג סיסמאות' : 'לוג כניסות');
  };
  load();
}
