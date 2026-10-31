// Tests: active test report, past tests browser, archived report.
import * as api from '../../core/api.js';
import { settings } from '../../core/settings.js';
import { createTable, searchBox, loadingHtml, errorHtml, emptyHtml, toast, withBusy } from '../../core/ui.js';
import { esc, debounce, exportCsv, fmtNum, toNumber } from '../../core/util.js';
import {
  SCORE_KEY, FIELD_LABELS, reportLines, lineToObject, pairRowsWithLines, occurrenceIndex,
  isAnswerValue, isCorrectValue,
} from '../../core/ymgr.js';
import { openGradeEditor, openHistory, gradeHistory } from './grade-editor.js';
import { getLockState, toggleLockDialog, showQuestions, closeActiveTest, importQuestions, deleteRecords } from './test-actions.js';

export const REPORT_FILE = 'ExaminationAmericanLogOK.ymgr';

export function mount(el, ctx) {
  if (ctx.sub === 'archive') return mountArchive(el, ctx);
  if (ctx.sub === 'view' && ctx.query.get('path')) {
    return mountReport(el, ctx, { path: ctx.query.get('path'), title: ctx.query.get('title') || 'מבחן מהארכיון', isActive: false });
  }
  return mountReport(el, ctx, { path: settings.activeTestPath, title: 'המבחן הפעיל', isActive: true });
}

// ---------------- Report ----------------

async function loadReport(path) {
  const [rendered, rawText, mtime] = await Promise.all([
    api.renderYmgr(path).catch((e) => ({ error: e })),
    api.getText(path).catch((e) => ({ error: e })),
    api.fileMTime(path),
  ]);
  const rawOk = typeof rawText === 'string';
  const renderedErr = rendered && rendered.error;
  const rawErr = rawText && typeof rawText === 'object' ? rawText.error : null;
  if (rawText === null && (renderedErr || !rendered.length)) return { missing: true };
  if (renderedErr && api.isNotFound(renderedErr) && !rawOk) return { missing: true };
  if (renderedErr && !rawOk) throw renderedErr || rawErr;

  const lines = rawOk ? reportLines(rawText) : [];
  let rows;
  let headers;
  if (!rendered.error && Array.isArray(rendered)) {
    rows = rendered;
    headers = rows.length ? Object.keys(rows[0]) : [];
  } else {
    // Fallback: build the table from raw lines.
    rows = lines.map((l) => {
      const o = lineToObject(l);
      const r = {};
      Object.entries(o).forEach(([k, v]) => { r[FIELD_LABELS[k] || k] = v; });
      return r;
    });
    headers = rows.length ? Object.keys(rows[0]) : [];
  }

  const pairs = rawOk ? pairRowsWithLines(rows, lines) : rows.map((row) => ({ row, line: null, lineIndex: -1 }));
  const records = pairs.map((p, i) => {
    const obj = p.line ? lineToObject(p.line) : {};
    return {
      _id: i,
      row: p.row,
      line: p.line,
      occurrence: p.line ? occurrenceIndex(lines, p.lineIndex) : 0,
      obj,
      score: p.line && SCORE_KEY in obj ? toNumber(obj[SCORE_KEY]) : NaN,
    };
  });

  // Which rendered column holds the grade / name.
  const detect = (key) => headers.find((h) => {
    const withVal = records.filter((r) => r.obj[key] !== undefined && r.obj[key] !== '');
    if (!withVal.length) return false;
    const hits = withVal.filter((r) => String(r.row[h] ?? '').trim() === String(r.obj[key]).trim()).length;
    return hits / withVal.length >= 0.9;
  }) || null;
  let gradeCol = detect(SCORE_KEY);
  if (!gradeCol) gradeCol = headers.find((h) => /ציון/.test(h)) || null;
  if (gradeCol) records.forEach((r) => { if (!Number.isFinite(r.score)) r.score = toNumber(r.row[gradeCol]); });
  const nameCol = detect('ValName') || headers.find((h) => /שם/.test(h)) || headers[0];

  // Answer columns: all values look like answers.
  const answerCols = headers.filter((h) => h !== gradeCol && records.length && records.every((r) => {
    const v = r.row[h];
    return v === undefined || v === '' || isAnswerValue(v);
  }) && records.some((r) => isAnswerValue(r.row[h]) && String(r.row[h]).trim() !== '-'));

  return { rows, records, headers, gradeCol, nameCol, answerCols, mtime, lines, rawOk };
}

function statsOf(records) {
  const s = records.map((r) => r.score).filter(Number.isFinite);
  if (!s.length) return null;
  const sum = s.reduce((a, b) => a + b, 0);
  const sorted = [...s].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { count: s.length, avg: sum / s.length, max: sorted[sorted.length - 1], min: sorted[0], median, scores: s };
}

function histogram(scores) {
  if (!scores.length || Math.max(...scores) > 100) return '';
  const buckets = [
    { label: '0–54', test: (x) => x < 55, cls: 'b1' },
    { label: '55–64', test: (x) => x >= 55 && x < 65, cls: 'b2' },
    { label: '65–74', test: (x) => x >= 65 && x < 75, cls: 'b3' },
    { label: '75–84', test: (x) => x >= 75 && x < 85, cls: 'b4' },
    { label: '85–94', test: (x) => x >= 85 && x < 95, cls: 'b5' },
    { label: '95–100', test: (x) => x >= 95, cls: 'b6' },
  ].map((b) => ({ ...b, n: scores.filter(b.test).length }));
  const max = Math.max(...buckets.map((b) => b.n), 1);
  return `<div class="hist" role="img" aria-label="התפלגות ציונים">
    ${buckets.map((b) => `<div class="hist-col" title="${b.n} תלמידים"><span class="hist-n">${b.n || ''}</span>
      <div class="hist-bar ${b.cls}" style="height:${Math.round((b.n / max) * 100)}%"></div><span class="hist-l">${b.label}</span></div>`).join('')}
  </div>`;
}

function gradeClass(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 90) return 'g-a';
  if (n >= 75) return 'g-b';
  if (n >= 55) return 'g-c';
  return 'g-d';
}

function mountReport(el, ctx, { path, title, isActive }) {
  let data = null;
  let table = null;
  let showAnswers = false;
  let alive = true;

  el.innerHTML = `
    <div class="page-head">
      <div>
        ${isActive ? '' : '<a class="back-link" href="#/tests/archive"><i class="fa-solid fa-arrow-right"></i> חזרה למבחנים קודמים</a>'}
        <h1>${esc(title)}</h1>
        <p class="page-sub" id="rep-meta"></p>
      </div>
      <div class="page-actions">
        ${isActive ? `
          <span class="lock-pill" id="lock-pill" hidden></span>
          <div class="menu">
            <button class="btn btn-ghost menu-toggle"><i class="fa-solid fa-ellipsis"></i> פעולות מבחן</button>
            <div class="menu-list">
              <button data-cmd="questions"><i class="fa-solid fa-list-ol"></i> הצגת שאלות המבחן</button>
              <button data-cmd="import"><i class="fa-solid fa-file-import"></i> ייבוא שאלות ממבחן קודם</button>
              <button data-cmd="close" class="danger"><i class="fa-solid fa-box-archive"></i> סגירת מבחן והעברה לארכיון</button>
            </div>
          </div>
          <a class="btn btn-ghost" href="#/tests/archive"><i class="fa-solid fa-clock-rotate-left"></i> מבחנים קודמים</a>`
        : '<button class="btn btn-ghost" data-cmd="questions"><i class="fa-solid fa-list-ol"></i> שאלות המבחן</button>'}
        <button class="btn btn-ghost icon-only" data-cmd="refresh" title="רענון"><i class="fa-solid fa-rotate"></i></button>
      </div>
    </div>
    <div id="rep-body">${loadingHtml('טוען את דוח המבחן...')}</div>`;

  const body = el.querySelector('#rep-body');
  const meta = el.querySelector('#rep-meta');

  const reload = async () => {
    body.innerHTML = loadingHtml('טוען את דוח המבחן...');
    try {
      data = await loadReport(path);
      if (!alive) return;
      render();
    } catch (e) {
      if (alive) body.innerHTML = errorHtml(e);
    }
  };

  async function refreshLock() {
    const pill = el.querySelector('#lock-pill');
    if (!pill) return;
    try {
      const locked = await getLockState();
      pill.hidden = false;
      pill.className = `lock-pill ${locked ? 'locked' : 'open'}`;
      pill.innerHTML = `<i class="fa-solid ${locked ? 'fa-lock' : 'fa-lock-open'}"></i> ${locked ? 'המבחן חסום' : 'המבחן פתוח'}
        <button class="pill-btn" title="שינוי סטטוס ידני">${locked ? 'פתיחה' : 'חסימה'}</button>`;
      pill.querySelector('.pill-btn').onclick = async () => {
        try { if (await toggleLockDialog(locked)) refreshLock(); } catch (e) { toast(e.message, 'error'); }
      };
    } catch {
      pill.hidden = true;
    }
  }

  function render() {
    if (data.missing) {
      meta.textContent = '';
      body.innerHTML = emptyHtml(isActive ? 'אין כעת מבחן פעיל — עדיין לא נבחנו תלמידים.' : 'לא נמצא דוח במבחן זה.', 'fa-clipboard-list');
      return;
    }
    const { records, headers, gradeCol, nameCol, answerCols } = data;
    const st = statsOf(records);
    const editable = records.some((r) => r.line);
    meta.innerHTML = `${records.length} נבחנים${data.mtime ? ` · עודכן ${esc(data.mtime)}` : ''} · <span dir="ltr" class="mono">${esc(path)}</span>`;

    const qStats = answerCols.map((h) => {
      const answered = records.filter((r) => String(r.row[h] ?? '').trim() && String(r.row[h]).trim() !== '-');
      const correct = answered.filter((r) => isCorrectValue(r.row[h])).length;
      return { h, pct: answered.length ? Math.round((correct / answered.length) * 100) : 0, n: answered.length };
    });

    body.innerHTML = `
      ${st ? `<section class="stats">
        <div class="stat"><span class="stat-l">נבחנים</span><span class="stat-v">${records.length}</span></div>
        <div class="stat"><span class="stat-l">ממוצע</span><span class="stat-v">${fmtNum(st.avg, 1)}</span></div>
        <div class="stat"><span class="stat-l">חציון</span><span class="stat-v">${fmtNum(st.median, 1)}</span></div>
        <div class="stat"><span class="stat-l">הגבוה ביותר</span><span class="stat-v ok">${fmtNum(st.max, 1)}</span></div>
        <div class="stat"><span class="stat-l">הנמוך ביותר</span><span class="stat-v bad">${fmtNum(st.min, 1)}</span></div>
        <div class="stat stat-wide">${histogram(st.scores) || '<span class="muted small">התפלגות ציונים תוצג כשהציונים בטווח 0–100</span>'}</div>
      </section>` : ''}
      ${qStats.length ? `<details class="panel q-analysis"><summary><i class="fa-solid fa-chart-column"></i> ניתוח שאלות — אחוז תשובות נכונות</summary>
        <div class="q-bars">${qStats.map((q) => `<div class="q-bar" title="${q.n} ענו"><span class="q-bar-l">${esc(q.h)}</span>
          <span class="q-bar-track"><span class="q-bar-fill ${q.pct >= 75 ? 'ok' : q.pct >= 50 ? 'mid' : 'bad'}" style="width:${q.pct}%"></span></span>
          <span class="q-bar-v">${q.pct}%</span></div>`).join('')}</div></details>` : ''}
      <section class="panel">
        <div class="toolbar">
          ${searchBox('חיפוש תלמיד, כיתה, טלפון...')}
          <div class="toolbar-spacer"></div>
          <span class="sel-bar" hidden><span class="sel-count"></span>
            <button class="btn btn-danger btn-sm" data-cmd="delete-selected"><i class="fa-solid fa-rotate-right"></i> מחיקה לצורך מבחן חוזר</button></span>
          ${answerCols.length ? `<label class="switch"><input type="checkbox" id="toggle-answers"><span></span> פירוט תשובות מלא</label>` : ''}
          ${editable ? `<button class="btn btn-ghost btn-sm" data-cmd="history"><i class="fa-solid fa-clock-rotate-left"></i> יומן שינויים <span class="count-badge">${gradeHistory.forPath(path).filter((h) => !h.undone).length || ''}</span></button>` : ''}
          <div class="menu">
            <button class="btn btn-ghost btn-sm menu-toggle"><i class="fa-solid fa-download"></i> ייצוא</button>
            <div class="menu-list">
              <button data-cmd="csv"><i class="fa-solid fa-file-excel"></i> Excel (CSV)</button>
              <button data-cmd="print"><i class="fa-solid fa-print"></i> הדפסה / PDF</button>
            </div>
          </div>
        </div>
        ${!editable && data.records.length ? '<div class="alert alert-warning small">לא ניתן היה לקרוא את קובץ הדוח הגולמי, ולכן עריכת ציונים אינה זמינה בדוח זה.</div>' : ''}
        <div id="rep-table"></div>
      </section>`;

    const otherCols = headers.filter((h) => !answerCols.includes(h) && h !== gradeCol);
    const buildColumns = () => {
      const cols = [];
      otherCols.forEach((h) => cols.push({
        key: h, label: h, value: (r) => r.row[h],
        render: h === nameCol ? (r) => `<strong>${esc(r.row[h])}</strong>` : undefined,
        className: /תאריך|שעה|טלפון|זמן/.test(h) ? 'nowrap ltr-cell' : '',
      }));
      if (gradeCol || records.some((r) => Number.isFinite(r.score))) {
        cols.push({
          key: '__grade', label: gradeCol || 'ציון', value: (r) => (Number.isFinite(r.score) ? r.score : ''),
          className: 'col-grade',
          render: (r) => {
            const shown = gradeCol ? r.row[gradeCol] : r.obj[SCORE_KEY];
            return `<span class="grade ${gradeClass(r.score)}">${esc(shown ?? '')}</span>${r.line ? '<button class="icon-btn edit-grade" data-action="grade" title="עריכת ציון"><i class="fa-solid fa-pen"></i></button>' : ''}`;
          },
        });
      }
      if (answerCols.length) {
        if (showAnswers) {
          answerCols.forEach((h) => cols.push({
            key: h, label: h, value: (r) => r.row[h], className: 'nowrap',
            render: (r) => { const v = r.row[h]; return `<span class="ans ${isCorrectValue(v) ? 'ans-ok' : v && v !== '-' ? 'ans-bad' : ''}">${esc(v ?? '')}</span>`; },
          }));
        } else {
          cols.push({
            key: '__answers', label: 'תשובות', sortable: true,
            value: (r) => answerCols.filter((h) => isCorrectValue(r.row[h])).length,
            render: (r) => `<span class="dots">${answerCols.map((h, i) => {
              const v = r.row[h];
              const c = isCorrectValue(v) ? 'ok' : v && String(v).trim() !== '-' ? 'bad' : 'none';
              return `<i class="dot ${c}" title="${esc(h)}: ${esc(v || 'לא ענה')}">${i + 1}</i>`;
            }).join('')}</span>`,
          });
        }
      }
      return cols;
    };

    const selBar = body.querySelector('.sel-bar');
    const mkTable = () => {
      selBar.hidden = true;
      table = createTable(body.querySelector('#rep-table'), {
        rows: records,
        rowId: (r) => r._id,
        columns: buildColumns(),
        selectable: editable,
        searchText: (r) => Object.values(r.row).join(' '),
        actions: editable ? (r) => (r.line ? `<button class="btn btn-sm btn-ghost" data-action="grade"><i class="fa-solid fa-pen-to-square"></i> ציון</button>` : '') : null,
        emptyText: 'אין נבחנים בדוח זה',
        onSelect: (sel) => {
          const usable = sel.filter((r) => r.line);
          selBar.hidden = !usable.length;
          selBar.querySelector('.sel-count').textContent = `${usable.length} נבחרו`;
        },
        onAction: (action, r) => {
          if (action === 'grade' && r.line) {
            openGradeEditor({ path, line: r.line, occurrence: r.occurrence, isActive, onSaved: reload });
          }
        },
      });
    };
    mkTable();

    const search = body.querySelector('.search input');
    search.addEventListener('input', debounce(() => table.filter(search.value), 120));
    const tgl = body.querySelector('#toggle-answers');
    if (tgl) tgl.onchange = () => { showAnswers = tgl.checked; mkTable(); table.filter(search.value); };
  }

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'refresh') { reload(); refreshLock(); }
    else if (cmd === 'questions') showQuestions(path, title);
    else if (cmd === 'import') importQuestions(() => { reload(); refreshLock(); });
    else if (cmd === 'close') withBusy(btn, () => closeActiveTest(() => { reload(); refreshLock(); }));
    else if (cmd === 'history') openHistory(path, reload);
    else if (cmd === 'csv' && data && !data.missing) {
      const list = table ? table.filtered() : data.records;
      exportCsv(data.headers, list.map((r) => data.headers.map((h) => r.row[h])), title);
    } else if (cmd === 'print') window.print();
    else if (cmd === 'delete-selected' && table) {
      const sel = table.selected().filter((r) => r.line);
      try {
        if (await deleteRecords(path, sel.map((r) => r.line), { isActive })) reload();
      } catch (err) { toast(err.message, 'error', 8000); }
    }
  });

  reload();
  refreshLock();
  return () => { alive = false; };
}

// ---------------- Past tests browser ----------------

function mountArchive(el) {
  const base = settings.previousTestsPath;
  el.innerHTML = `
    <div class="page-head">
      <div><a class="back-link" href="#/tests"><i class="fa-solid fa-arrow-right"></i> חזרה למבחן הפעיל</a>
        <h1>מבחנים קודמים</h1><p class="page-sub" dir="ltr">${esc(base)}</p></div>
      <div class="page-actions">${searchBox('חיפוש מבחן...')}</div>
    </div>
    <div id="arc">${loadingHtml('טוען את רשימת המבחנים...')}</div>`;
  const box = el.querySelector('#arc');
  let dirs = [];
  const render = (term = '') => {
    const list = dirs.filter((d) => d.name.toLowerCase().includes(term.toLowerCase()));
    if (!dirs.length) { box.innerHTML = emptyHtml('הארכיון ריק.', 'fa-box-archive'); return; }
    if (!list.length) { box.innerHTML = emptyHtml('לא נמצאו מבחנים מתאימים', 'fa-magnifying-glass'); return; }
    box.innerHTML = `<div class="card-grid">${list.map((d) => {
      const mm = d.name.match(/^(\d+)-?(.*)$/);
      const num = mm ? mm[1] : '';
      const label = mm ? (mm[2] || d.name).replace(/-/g, ' ') : d.name;
      const href = `#/tests/view?path=${encodeURIComponent(`${d.what}/${REPORT_FILE}`)}&title=${encodeURIComponent(`מבחן: ${d.name}`)}`;
      return `<a class="folder-card" href="${href}">${num ? `<span class="folder-num">${esc(num)}</span>` : '<i class="fa-solid fa-folder"></i>'}
        <span class="folder-name">${esc(label)}</span>${d.mtime ? `<span class="muted small" dir="ltr">${esc(d.mtime)}</span>` : ''}</a>`;
    }).join('')}</div>`;
  };
  api.listDir(base).then((res) => {
    dirs = res.dirs.sort((a, b) => b.name.localeCompare(a.name, 'he', { numeric: true }));
    render();
  }).catch((e) => { box.innerHTML = errorHtml(e); });
  el.querySelector('.search input').addEventListener('input', debounce((e) => render(e.target.value), 100));
}
