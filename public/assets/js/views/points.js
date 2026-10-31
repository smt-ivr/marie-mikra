// Points: current report, adjust a student's points, archive & reset, past reports.
import * as api from '../core/api.js';
import { PATHS } from '../core/settings.js';
import { createTable, searchBox, loadingHtml, errorHtml, emptyHtml, toast, openModal, confirmDialog, promptDialog } from '../core/ui.js';
import { esc, debounce, exportCsv, fmtNum, splitKeep, joinKeep } from '../core/util.js';

export function mount(el, ctx) {
  if (ctx.sub === 'archive') return mountArchive(el);
  if (ctx.sub === 'view' && ctx.query.get('path')) return mountReport(el, { folder: ctx.query.get('path'), title: ctx.query.get('title') || 'דוח נקודות מהארכיון' });
  return mountReport(el, { folder: null, title: 'דוח נקודות' });
}

/** students file -> Map(id -> {name, school}) */
export function parseStudentsMap(content) {
  const map = new Map();
  String(content || '').split(/\r?\n/).forEach((line) => {
    const p = line.trim().split(',');
    if (p.length >= 3 && p[0] && !isNaN(p[0])) {
      map.set(p[0], { name: [p[2], p[3]].filter(Boolean).join(' ').trim() || 'ללא שם', school: (p[5] || '').trim() || '—' });
    }
  });
  return map;
}

export function parsePoints(content, students) {
  const rows = [];
  String(content || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line.startsWith('list_all_information-')) return;
    const [left, right] = line.split('=');
    if (right === undefined) return;
    const id = left.split('-')[1];
    const points = parseInt(right, 10);
    if (!id || isNaN(points)) return;
    const s = students.get(id);
    rows.push({ id, name: s ? s.name : 'אין נתון', school: s ? s.school : 'אין נתון', points });
  });
  return rows;
}

function mountReport(el, { folder, title }) {
  const isActive = !folder;
  const iniPath = isActive ? PATHS.pointsIni : `${folder}/points_total.ini`;
  let table;
  let rows = [];

  el.innerHTML = `
    <div class="page-head">
      <div>${isActive ? '' : '<a class="back-link" href="#/points/archive"><i class="fa-solid fa-arrow-right"></i> חזרה לדוחות קודמים</a>'}
        <h1>${esc(title)}</h1><p class="page-sub" id="pts-meta"></p></div>
      <div class="page-actions">
        ${isActive ? `<a class="btn btn-ghost" href="#/points/archive"><i class="fa-solid fa-clock-rotate-left"></i> דוחות קודמים</a>
          <button class="btn btn-ghost" data-cmd="archive"><i class="fa-solid fa-box-archive"></i> ארכוב ואיפוס</button>` : ''}
        <button class="btn btn-ghost icon-only" data-cmd="refresh" title="רענון"><i class="fa-solid fa-rotate"></i></button>
      </div>
    </div>
    <div id="pts-body">${loadingHtml()}</div>`;
  const body = el.querySelector('#pts-body');

  async function load() {
    body.innerHTML = loadingHtml();
    try {
      const [studentsText, pointsText, mtime] = await Promise.all([
        api.getText(PATHS.studentsIni).catch(() => null),
        api.getText(iniPath),
        api.fileMTime(iniPath),
      ]);
      if (pointsText === null) { body.innerHTML = emptyHtml(isActive ? 'לא נמצא דוח נקודות פעיל.' : 'לא נמצא קובץ נקודות בארכיון זה.', 'fa-star'); return; }
      rows = parsePoints(pointsText, parseStudentsMap(studentsText));
      const total = rows.reduce((a, r) => a + r.points, 0);
      el.querySelector('#pts-meta').textContent = `${rows.length} תלמידים${mtime ? ` · עודכן ${mtime}` : ''}`;
      const top = [...rows].sort((a, b) => b.points - a.points).slice(0, 3);
      body.innerHTML = `
        <section class="stats">
          <div class="stat"><span class="stat-l">תלמידים</span><span class="stat-v">${rows.length}</span></div>
          <div class="stat"><span class="stat-l">סה"כ נקודות</span><span class="stat-v">${fmtNum(total)}</span></div>
          <div class="stat"><span class="stat-l">ממוצע לתלמיד</span><span class="stat-v">${fmtNum(rows.length ? total / rows.length : 0, 1)}</span></div>
          <div class="stat stat-wide"><span class="stat-l">מובילים</span><span class="leaders">${top.map((r, i) => `<span><b>${i + 1}.</b> ${esc(r.name)} <span class="muted">(${fmtNum(r.points)})</span></span>`).join('') || '—'}</span></div>
        </section>
        <section class="panel">
          <div class="toolbar">${searchBox('חיפוש לפי שם או קוד...')}<div class="toolbar-spacer"></div>
            <button class="btn btn-ghost btn-sm" data-cmd="csv"><i class="fa-solid fa-file-excel"></i> ייצוא</button>
            <button class="btn btn-ghost btn-sm" data-cmd="print"><i class="fa-solid fa-print"></i> הדפסה</button></div>
          <div id="pts-table"></div>
        </section>`;
      table = createTable(body.querySelector('#pts-table'), {
        rows, rowId: (r) => r.id, sortKey: 'points', sortDir: -1,
        columns: [
          { key: 'id', label: 'קוד', className: 'mono' },
          { key: 'name', label: 'שם', render: (r) => `<strong>${esc(r.name)}</strong>` },
          { key: 'school', label: 'כיתה' },
          { key: 'points', label: 'סה"כ נקודות', render: (r) => `<span class="points-val"><i class="fa-solid fa-star"></i> ${fmtNum(r.points)}</span>` },
        ],
        actions: isActive ? () => '<button class="btn btn-sm btn-ghost" data-action="edit"><i class="fa-solid fa-sliders"></i> עדכון נקודות</button>' : null,
        onAction: (a, r) => { if (a === 'edit') editPoints(r, iniPath, load); },
      });
      const s = body.querySelector('.search input');
      s.addEventListener('input', debounce(() => table.filter(s.value), 120));
    } catch (e) {
      body.innerHTML = errorHtml(e);
    }
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    if (b.dataset.cmd === 'refresh') load();
    if (b.dataset.cmd === 'print') window.print();
    if (b.dataset.cmd === 'csv') exportCsv(['קוד', 'שם', 'כיתה', 'סה"כ נקודות'], (table ? table.filtered() : rows).map((r) => [r.id, r.name, r.school, r.points]), title);
    if (b.dataset.cmd === 'archive') archivePoints(load);
  });
  load();
}

function editPoints(row, iniPath, onSaved) {
  let preview = row.points;
  const m = openModal({
    title: `עדכון נקודות: ${row.name}`, icon: 'fa-star', size: 'sm',
    body: `<div class="points-editor">
        <div class="grade-box"><span class="grade-label">נקודות כעת</span><span class="grade-value">${fmtNum(row.points)}</span></div>
        <label class="field"><span>כמות</span><input class="input input-lg" type="number" min="1" step="1" id="pts-amount" placeholder="לדוגמה: 50"></label>
        <div class="seg">
          <button class="btn btn-danger" data-op="sub"><i class="fa-solid fa-minus"></i> הפחתה</button>
          <button class="btn btn-success" data-op="add"><i class="fa-solid fa-plus"></i> הוספה</button>
          <button class="btn btn-ghost" data-op="set"><i class="fa-solid fa-equals"></i> קביעת סכום</button>
        </div>
        <div class="preview" hidden></div>
        <p class="field-error" hidden></p>
      </div>`,
    footer: '<button class="btn btn-ghost" data-act="cancel">ביטול</button><button class="btn btn-primary" data-act="save" disabled><i class="fa-solid fa-floppy-disk"></i> שמירה</button>',
  });
  const amount = m.body.querySelector('#pts-amount');
  const prev = m.body.querySelector('.preview');
  const save = m.footer.querySelector('[data-act=save]');
  const err = m.body.querySelector('.field-error');
  setTimeout(() => amount.focus(), 50);
  m.body.querySelectorAll('[data-op]').forEach((b) => (b.onclick = () => {
    const n = parseInt(amount.value, 10);
    if (isNaN(n) || (b.dataset.op !== 'set' && n <= 0) || n < 0) { amount.classList.add('shake'); setTimeout(() => amount.classList.remove('shake'), 400); return; }
    preview = b.dataset.op === 'add' ? row.points + n : b.dataset.op === 'sub' ? row.points - n : n;
    const d = preview - row.points;
    prev.hidden = false;
    prev.innerHTML = `נקודות חדשות: <strong>${fmtNum(preview)}</strong> <span class="${d >= 0 ? 'ok' : 'bad'}">(${d > 0 ? '+' : ''}${fmtNum(d)})</span>`;
    save.disabled = d === 0;
  }));
  m.footer.querySelector('[data-act=cancel]').onclick = () => m.close();
  save.onclick = async () => {
    save.disabled = true;
    save.innerHTML = '<span class="spinner spinner-sm"></span> שומר...';
    try {
      const fresh = await api.getText(iniPath);
      if (fresh === null) throw new Error('קובץ הנקודות לא נמצא.');
      const prefix = `list_all_information-${row.id}-points_total=`;
      const parts = splitKeep(fresh);
      const i = parts.lines.findIndex((l) => l.trim().startsWith(prefix));
      if (i < 0) throw new Error('התלמיד לא נמצא בקובץ הנקודות.');
      const serverPoints = parseInt(parts.lines[i].split('=')[1], 10);
      let target = preview;
      if (serverPoints !== row.points) {
        // someone earned points meanwhile – apply the same difference to the fresh value
        target = serverPoints + (preview - row.points);
      }
      parts.lines[i] = `${prefix}${target}`;
      await api.uploadText(iniPath, joinKeep(parts));
      m.close();
      toast(`הנקודות של ${row.name} עודכנו ל-${fmtNum(target)}`, 'success');
      onSaved();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      save.disabled = false;
      save.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> שמירה';
    }
  };
}

async function archivePoints(onDone) {
  const name = await promptDialog({
    title: 'ארכוב ואיפוס נקודות', label: 'שם לדוח הנוכחי', placeholder: 'לדוגמה: חודש-תשרי', confirmText: 'המשך',
    validate: (v) => (!v ? 'יש להזין שם' : /[\\/:*?"<>|%#]/.test(v) ? 'השם מכיל תווים אסורים' : null),
  });
  if (!name) return;
  const ok = await confirmDialog({
    title: 'אזהרה חמורה', danger: true, countdown: 3, size: 'md', confirmText: 'כן, אני מבין ומאשר',
    message: `<p>כל נתוני הנקודות הנוכחיים יועברו לארכיון תחת השם <strong>${esc(name)}</strong> ותתחיל צבירה חדשה מאפס.</p>
      <div class="alert alert-danger">יש לוודא שאף משתמש אינו נמצא במערכת בתהליך צבירת נקודות בזמן הפעולה. התעלמות מכך עלולה לשבש את מנגנון הנקודות.</div>`,
  });
  if (!ok) return;
  try {
    await api.fileAction('move', PATHS.pointsSplitDir, `${PATHS.pointsArchiveTarget}/${name}`);
    toast('הארכוב והאיפוס הושלמו בהצלחה', 'success');
    onDone();
  } catch (e) {
    toast(`שגיאה: ${e.message}`, 'error', 8000);
  }
}

function mountArchive(el) {
  el.innerHTML = `
    <div class="page-head"><div><a class="back-link" href="#/points"><i class="fa-solid fa-arrow-right"></i> חזרה לדוח הפעיל</a>
      <h1>דוחות נקודות קודמים</h1></div></div>
    <div id="pa">${loadingHtml()}</div>`;
  const box = el.querySelector('#pa');
  api.listDir(PATHS.pointsArchiveBase).then((res) => {
    const dirs = res.dirs.filter((d) => d.name !== 'Split').sort((a, b) => b.name.localeCompare(a.name, 'he', { numeric: true }));
    if (!dirs.length) { box.innerHTML = emptyHtml('לא נמצאו דוחות נקודות בארכיון.', 'fa-box-archive'); return; }
    box.innerHTML = `<div class="card-grid">${dirs.map((d) => `<a class="folder-card" href="#/points/view?path=${encodeURIComponent(d.what)}&title=${encodeURIComponent(`דוח נקודות: ${d.name}`)}">
      <i class="fa-solid fa-folder-open"></i><span class="folder-name">${esc(d.name)}</span></a>`).join('')}</div>`;
  }).catch((e) => { box.innerHTML = errorHtml(e); });
}
