// Actions on tests: lock status, questions viewer, close (archive), import, delete records.
import * as api from '../../core/api.js';
import { settings, PATHS } from '../../core/settings.js';
import { openModal, confirmDialog, promptDialog, toast, loadingHtml, errorHtml, emptyHtml } from '../../core/ui.js';
import { esc, parentPath, splitKeep, joinKeep } from '../../core/util.js';
import { lineToObject, recordId } from '../../core/ymgr.js';

const QUESTION_DIR = (d) => /^\d{3}$/.test(d.name) && d.name !== '000';
const BLOCK_VALUE = '2019-07-09-18-52-30';

// ---------------- Lock status ----------------

/** Returns true when the test extension is currently blocked. */
export async function getLockState() {
  const text = await api.getText(PATHS.testLockIni);
  const m = (text || '').match(/enter_foldar_end_time=(.*)/);
  if (!m) return false;
  const d = m[1].trim().match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (!d) return false;
  return new Date(d[1], d[2] - 1, d[3], d[4], d[5], d[6]) < new Date();
}

export async function setLocked(locked) {
  await api.updateExtension(PATHS.testLockExt, { enter_foldar_end_time: locked ? BLOCK_VALUE : 'no' });
}

export async function toggleLockDialog(currentlyLocked) {
  const action = currentlyLocked ? 'לפתוח' : 'לחסום';
  const ok = await confirmDialog({
    title: 'שינוי סטטוס המבחן',
    icon: currentlyLocked ? 'fa-lock-open' : 'fa-lock',
    danger: !currentlyLocked,
    message: `<p><strong>המנגנון עובד אוטומטית:</strong> סגירת מבחן דרך הממשק נועלת אותו, וייבוא/הקלטת שאלות פותחת אותו.</p>
              <p>האם ${action} את המבחן באופן ידני?</p>
              <p class="note">החסימה אינה קשורה לזמני המבחן — זו חסימה טכנית של שלוחת המבחן בלבד, למניעת דוחות שגויים.</p>`,
    confirmText: `כן, ${action}`,
  });
  if (!ok) return false;
  await setLocked(!currentlyLocked);
  toast(currentlyLocked ? 'המבחן נפתח' : 'המבחן נחסם', 'success');
  return true;
}

// ---------------- Questions viewer ----------------

export async function showQuestions(reportPath, title) {
  const m = openModal({ title: `שאלות: ${title}`, icon: 'fa-list-ol', size: 'lg', body: loadingHtml('טוען שאלות...') });
  m.body.addEventListener('play', (e) => {
    if (e.target.tagName === 'AUDIO') m.body.querySelectorAll('audio').forEach((a) => { if (a !== e.target) a.pause(); });
  }, true);
  try {
    const dir = await api.listDir(parentPath(reportPath));
    const qDirs = dir.dirs.filter(QUESTION_DIR).sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));
    if (!qDirs.length) { m.setBody(emptyHtml('לא נמצאו שאלות במבחן זה.', 'fa-list-ol')); return; }
    const questions = await Promise.all(qDirs.map(async (d) => {
      const c = await api.listDir(d.what);
      const files = {};
      c.files.forEach((f) => { files[f.name.split('.')[0].toUpperCase()] = f.what; });
      return { name: d.name, files };
    }));
    const player = (p) => (p ? `<audio controls preload="none" src="${esc(api.downloadUrl(p))}"></audio>` : '<span class="muted small">אין קובץ</span>');
    m.setBody(`<div class="questions">${questions.map((q) => `
      <div class="q-card">
        <h3>שאלה ${parseInt(q.name, 10)}</h3>
        <div class="q-row"><span><i class="fa-solid fa-circle-question"></i> שאלה</span>${player(q.files.Q)}</div>
        <div class="q-row ok"><span><i class="fa-solid fa-circle-check"></i> תשובה נכונה</span>${player(q.files.A)}</div>
        ${['B', 'C', 'D'].filter((k) => q.files[k]).map((k, i) => `<div class="q-row bad"><span><i class="fa-solid fa-circle-xmark"></i> מסיח ${i + 1}</span>${player(q.files[k])}</div>`).join('')}
      </div>`).join('')}</div>`);
  } catch (e) {
    m.setBody(api.isNotFound(e) ? emptyHtml('לא נמצאו שאלות במבחן זה.', 'fa-list-ol') : errorHtml(e));
  }
  return m;
}

// ---------------- Close (archive) the active test ----------------

export async function closeActiveTest(onDone) {
  const activePath = settings.activeTestPath;
  const basePath = parentPath(activePath);
  const archivePath = settings.previousTestsPath;

  let nextNumber;
  let activeDir;
  try {
    const archive = await api.listDir(archivePath);
    const last = archive.dirs.reduce((max, d) => { const mm = d.name.match(/^(\d+)/); return mm ? Math.max(max, parseInt(mm[1], 10)) : max; }, 0);
    nextNumber = last + 1;
    activeDir = await api.listDir(basePath);
  } catch (e) {
    toast(`שגיאה בקריאת התיקיות: ${e.message}`, 'error', 8000);
    return;
  }

  const name = await promptDialog({
    title: 'סגירת מבחן והעברה לארכיון',
    label: 'שם תיאורי למבחן',
    placeholder: 'לדוגמה: פרשת-וירא',
    hint: `המספר הסידורי הבא בארכיון: <strong>${nextNumber}</strong>`,
    confirmText: 'המשך',
    validate: (v) => (!v ? 'יש להזין שם' : /[\\/:*?"<>|%#]/.test(v) ? 'השם מכיל תווים אסורים' : null),
  });
  if (!name) return;
  const folderName = `${String(nextNumber).padStart(2, '0')}-${name.replace(/\s+/g, '-')}`;
  const newPath = `${archivePath}/${folderName}`;

  const has = (list, n) => list.some((f) => f.name === n);
  const checks = {
    logIniCopy: has(activeDir.ini, 'ExaminationAmericanLogOK.ini'),
    logYmgr: has(activeDir.files, 'ExaminationAmericanLogOK.ymgr'),
    middleIni: has(activeDir.ini, 'ExaminationAmericanMiddle.ini'),
  };
  const qDirs = activeDir.dirs.filter(QUESTION_DIR);
  const st = (ok) => (ok ? '<span class="ok"><i class="fa-solid fa-check"></i> נמצא</span>' : '<span class="bad"><i class="fa-solid fa-xmark"></i> לא נמצא</span>');

  const ok = await confirmDialog({
    title: 'אישור סגירת מבחן', icon: 'fa-box-archive', size: 'md', confirmText: 'אשר וסגור מבחן',
    message: `<p>תיווצר בארכיון תיקייה בשם <strong>${esc(folderName)}</strong>, והמבחן הפעיל יינעל.</p>
      <div class="checklist">
        <h4>יועתק (יישאר גם במקור)</h4>
        <div>ExaminationAmericanLogOK.ini ${st(checks.logIniCopy)}</div>
        <h4>יועבר לארכיון</h4>
        <div>ExaminationAmericanLogOK.ymgr (דוח התוצאות) ${st(checks.logYmgr)}</div>
        <div>ExaminationAmericanMiddle.ini ${st(checks.middleIni)}</div>
        <div>תיקיות שאלות ${st(qDirs.length > 0)} ${qDirs.length ? `<span class="muted small">(${qDirs.map((d) => esc(d.name)).join(', ')})</span>` : ''}</div>
      </div>`,
  });
  if (!ok) return;

  const ops = [];
  if (checks.logIniCopy) ops.push({ type: 'copy', name: 'ExaminationAmericanLogOK.ini' });
  if (checks.logYmgr) ops.push({ type: 'move', name: 'ExaminationAmericanLogOK.ymgr' });
  if (checks.middleIni) ops.push({ type: 'move', name: 'ExaminationAmericanMiddle.ini' });
  qDirs.forEach((d) => ops.push({ type: 'move', name: d.name, what: d.what }));

  const steps = [
    { id: 'mkdir', label: 'יצירת תיקייה בארכיון' },
    { id: 'lock', label: 'נעילת המבחן' },
    ...ops.map((o, i) => ({ id: `op${i}`, label: `${o.type === 'copy' ? 'העתקת' : 'העברת'} ${o.name}` })),
  ];
  const m = openModal({ title: 'סוגר מבחן...', icon: 'fa-gears', size: 'md', dismissible: false,
    body: `<p>מעביר לארכיון: <strong>${esc(folderName)}</strong></p><ul class="steps">${steps.map((s) => `<li data-step="${s.id}"><i class="fa-regular fa-clock"></i> ${esc(s.label)} <span class="step-msg"></span></li>`).join('')}</ul>` });
  const mark = (id, state, msg = '') => {
    const li = m.body.querySelector(`[data-step="${id}"]`);
    const icon = { run: '<span class="spinner spinner-sm"></span>', ok: '<i class="fa-solid fa-circle-check ok"></i>', fail: '<i class="fa-solid fa-circle-xmark bad"></i>' }[state];
    li.className = `step-${state}`;
    li.firstElementChild.outerHTML = icon;
    li.querySelector('.step-msg').textContent = msg;
  };
  const finish = (title) => {
    m.setTitle(title);
    m.setFooter('<button class="btn btn-primary" data-act="close">סגירה</button>');
    m.footer.querySelector('[data-act=close]').onclick = () => { m.close(); onDone && onDone(); };
  };

  try {
    mark('mkdir', 'run');
    await api.updateExtension(newPath);
    mark('mkdir', 'ok');
  } catch (e) {
    mark('mkdir', 'fail', e.message);
    finish('סגירת המבחן נכשלה');
    return;
  }
  try { mark('lock', 'run'); await setLocked(true); mark('lock', 'ok'); } catch (e) { mark('lock', 'fail', e.message); }
  let failures = 0;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    mark(`op${i}`, 'run');
    try {
      await api.fileAction(o.type, o.what || `${basePath}/${o.name}`, newPath);
      mark(`op${i}`, 'ok');
    } catch (e) {
      failures++;
      mark(`op${i}`, 'fail', e.message);
    }
  }
  finish(failures ? `הסגירה הסתיימה עם ${failures} שגיאות` : 'המבחן נסגר והועבר לארכיון בהצלחה');
}

// ---------------- Import questions from a previous test ----------------

export async function importQuestions(onDone) {
  const target = parentPath(settings.activeTestPath);
  try {
    const dir = await api.listDir(target);
    if (dir.dirs.some(QUESTION_DIR)) {
      await confirmDialog({ title: 'לא ניתן לייבא שאלות', danger: true, message: 'המבחן הפעיל כבר מכיל שאלות. יש לסגור את המבחן הפעיל לפני ייבוא.', confirmText: 'הבנתי', cancelText: 'סגירה' });
      return;
    }
  } catch (e) {
    if (!api.isNotFound(e)) { toast(e.message, 'error'); return; }
  }

  let base = PATHS.importSources[0].path;
  let current = base;
  const m = openModal({
    title: 'ייבוא שאלות ממבחן קודם', icon: 'fa-file-import', size: 'md',
    body: `<div class="toolbar">
        <select class="input" id="imp-src">${PATHS.importSources.map((s) => `<option value="${esc(s.path)}">${esc(s.label)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" id="imp-up"><i class="fa-solid fa-turn-up"></i> למעלה</button>
      </div>
      <div class="path-line" dir="ltr" id="imp-path"></div>
      <div id="imp-list" class="folder-list"></div>`,
  });
  const listEl = m.body.querySelector('#imp-list');
  const norm = (p) => (p || '').replace(/^ivr2:\/?/, 'ivr2:/').replace(/\/+$/, '');

  async function load(path) {
    current = path;
    m.body.querySelector('#imp-path').textContent = path;
    m.body.querySelector('#imp-up').disabled = norm(path) === norm(base);
    listEl.innerHTML = loadingHtml();
    try {
      const res = await api.listDir(path);
      const folders = res.dirs.sort((a, b) => a.name.localeCompare(b.name, 'he', { numeric: true }));
      if (!folders.length) { listEl.innerHTML = emptyHtml('אין כאן מבחנים', 'fa-folder-open'); return; }
      listEl.innerHTML = folders.map((f) => `<div class="folder-row" data-what="${esc(f.what)}">
          <button class="folder-open"><i class="fa-solid fa-folder"></i> ${esc(f.name)}</button>
          <button class="btn btn-sm btn-primary folder-pick"><i class="fa-solid fa-download"></i> בחר</button></div>`).join('');
    } catch (e) {
      listEl.innerHTML = errorHtml(e);
    }
  }
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.folder-row');
    if (!row) return;
    if (e.target.closest('.folder-pick')) validateAndImport(row.dataset.what);
    else if (e.target.closest('.folder-open')) load(row.dataset.what);
  });
  m.body.querySelector('#imp-src').onchange = (e) => { base = e.target.value; load(base); };
  m.body.querySelector('#imp-up').onclick = () => {
    if (norm(current) === norm(base)) return;
    const parent = current.substring(0, current.lastIndexOf('/'));
    load(norm(parent).length < norm(base).length ? base : parent);
  };

  async function validateAndImport(src) {
    listEl.innerHTML = loadingHtml('בודק את תקינות המבחן...');
    try {
      const dir = await api.listDir(src);
      const q = dir.dirs.filter(QUESTION_DIR).sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));
      if (!q.length) throw new Error('לא נמצאו תיקיות שאלות במבחן הנבחר.');
      for (let i = 0; i < q.length; i++) {
        const expected = String(i + 1).padStart(3, '0');
        if (q[i].name !== expected) throw new Error(i === 0 ? `המבחן חייב להתחיל מתיקייה 001 (נמצאה ${q[0].name}).` : `חסרה תיקיית שאלה ${expected} ברצף.`);
        listEl.innerHTML = loadingHtml(`בודק קבצי שמע בשאלה ${expected}...`);
        const qd = await api.listDir(q[i].what);
        const hasQ = qd.files.some((f) => f.name.toLowerCase().startsWith('q.'));
        const hasA = qd.files.some((f) => f.name.toLowerCase().startsWith('a.'));
        if (!hasQ || !hasA) throw new Error(`בשאלה ${expected} חסר קובץ שאלה (Q) או תשובה נכונה (A).`);
      }
      load(current);
      const ok = await confirmDialog({ title: 'אישור ייבוא', message: `המבחן תקין (${q.length} שאלות).<br>לייבא אותן כעת? <strong>בסיום המבחן ייפתח אוטומטית.</strong>`, confirmText: 'ייבוא ופתיחה' });
      if (!ok) return;
      listEl.innerHTML = loadingHtml('מעתיק שאלות...');
      for (let i = 0; i < q.length; i++) {
        listEl.innerHTML = loadingHtml(`מעתיק שאלה ${i + 1} מתוך ${q.length}...`);
        await api.fileAction('copy', q[i].what, `${target}/${q[i].name}`);
      }
      try { await setLocked(false); } catch { /* imported anyway */ }
      m.close();
      toast(`יובאו ${q.length} שאלות והמבחן נפתח`, 'success');
      onDone && onDone();
    } catch (e) {
      listEl.innerHTML = errorHtml(e);
      setTimeout(() => load(current), 4000);
    }
  }
  load(base);
}

// ---------------- Delete records (allow a retest) ----------------

/**
 * Delete the given raw lines from a report and clean the student's internal
 * answers history, so they can take the test again.
 */
export async function deleteRecords(reportPath, lines, { isActive = false } = {}) {
  if (!lines.length) return false;
  const objs = lines.map(lineToObject);
  const busy = isActive && await api.hasActiveCallsIn(parentPath(reportPath));
  const ok = await confirmDialog({
    title: busy ? 'עצרו! יש תלמידים במבחן כעת' : 'מחיקת מבחנים',
    danger: true, size: 'md', countdown: busy ? 15 : 0,
    confirmText: busy ? 'אני מבין ומוחק בכל זאת' : `כן, מחק ${lines.length} מבחנים`,
    message: `${busy ? '<div class="alert alert-danger"><strong>זוהתה פעילות בשלוחת המבחן ברגע זה.</strong> מחיקה עכשיו עלולה לגרום לאובדן נתונים של תלמידים שנבחנים.</div>' : ''}
      <p>יימחקו המבחנים של:</p>
      <ul class="names">${objs.map((o) => `<li>${esc(o.ValName || 'ללא שם')} ${o.QuestionScoreTotal ? `<span class="muted small">(ציון ${esc(o.QuestionScoreTotal)})</span>` : ''}</li>`).join('')}</ul>
      <div class="alert alert-warning">הפעולה מוחקת גם את היסטוריית התשובות הפנימית, והתלמיד יוכל <strong>להיבחן מחדש</strong>.</div>`,
  });
  if (!ok) return false;

  // 1) clean internal answers file
  const ids = new Set(objs.map(recordId).filter(Boolean));
  if (ids.size) {
    const iniPath = `${parentPath(reportPath)}/ExaminationAmericanMiddle.ini`;
    try {
      const content = await api.getText(iniPath);
      if (content) {
        const parts = splitKeep(content);
        const keep = { lines: [], seps: [] };
        parts.lines.forEach((l, i) => {
          const mm = l.match(/^list_all_information-([^-]+)-/);
          if (mm && ids.has(mm[1])) return;
          keep.lines.push(l);
          keep.seps.push(parts.seps[i]);
        });
        if (keep.lines.length !== parts.lines.length) await api.uploadText(iniPath, joinKeep(keep));
      }
    } catch (e) {
      console.warn('internal answers cleanup failed', e);
    }
  }

  // 2) remove lines from the report (multiset: each selected line once)
  const fresh = await api.getText(reportPath);
  if (fresh === null) throw new Error('קובץ הדוח לא נמצא.');
  const want = new Map();
  lines.forEach((l) => want.set(l.trim(), (want.get(l.trim()) || 0) + 1));
  const parts = splitKeep(fresh);
  const out = { lines: [], seps: [] };
  parts.lines.forEach((l, i) => {
    const k = l.trim();
    if (k && want.get(k) > 0) { want.set(k, want.get(k) - 1); return; }
    out.lines.push(l);
    out.seps.push(parts.seps[i]);
  });
  await api.uploadText(reportPath, joinKeep(out));
  toast(`נמחקו ${lines.length} מבחנים. התלמידים יוכלו להיבחן מחדש.`, 'success');
  return true;
}
