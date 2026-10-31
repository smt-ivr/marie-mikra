// Professional grade editing for a single student record in a .ymgr report.
import { getText, uploadText, hasActiveCallsIn } from '../../core/api.js';
import { openModal, confirmDialog, toast } from '../../core/ui.js';
import { esc, parentPath, toNumber, fmtNum, storageJson, storageSet } from '../../core/util.js';
import { SCORE_KEY, FIELD_LABELS, lineToObject, parseLine, setField, replaceLineInText } from '../../core/ymgr.js';

// ---------------- Change history (kept in this browser) ----------------

const HISTORY_KEY = 'mm_grade_history';
const HISTORY_MAX = 300;

export const gradeHistory = {
  all() { return storageJson(HISTORY_KEY, []); },
  forPath(path) { return this.all().filter((h) => h.path === path); },
  add(entry) {
    const list = this.all();
    list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), ...entry });
    storageSet(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  },
  markUndone(id) {
    const list = this.all();
    const h = list.find((x) => x.id === id);
    if (h) { h.undone = Date.now(); storageSet(HISTORY_KEY, JSON.stringify(list)); }
  },
};

/**
 * Safely replace one line in a report file on the server.
 * Reads the file fresh, replaces the exact line, uploads, then reads back to verify.
 */
export async function writeLineChange(path, oldLine, newLine, occurrence = 0) {
  const fresh = await getText(path);
  if (fresh === null) throw new Error('קובץ הדוח לא נמצא בשרת.');
  const updated = replaceLineInText(fresh, oldLine, newLine, occurrence);
  if (updated === null) throw new Error('הרשומה השתנתה או נמחקה בינתיים בשרת. רעננו את הדוח ונסו שוב.');
  await uploadText(path, updated);
  const check = await getText(path);
  if (newLine !== null && (check === null || !check.includes(newLine))) {
    throw new Error('השמירה לא אומתה מול השרת. רעננו את הדוח ובדקו את הציון.');
  }
}

function studentSummary(obj) {
  const name = obj.ValName || 'ללא שם';
  const bits = [
    obj.School && `<span><i class="fa-solid fa-users"></i> ${esc(obj.School)}</span>`,
    obj.Phone && `<span dir="ltr"><i class="fa-solid fa-phone"></i> ${esc(obj.Phone)}</span>`,
    (obj.Date || obj.Time) && `<span dir="ltr"><i class="fa-regular fa-clock"></i> ${esc(obj.Date || '')} ${esc(obj.Time || '')}</span>`,
  ].filter(Boolean).join('');
  return `<div class="student-card"><div class="avatar">${esc(name.trim().charAt(0) || '?')}</div>
    <div><strong>${esc(name)}</strong><div class="student-meta">${bits}</div></div></div>`;
}

/**
 * Open the grade editor.
 * opts: { path, line, occurrence, isActive, onSaved }
 */
export function openGradeEditor({ path, line, occurrence = 0, isActive = false, onSaved }) {
  const obj = lineToObject(line);
  if (!(SCORE_KEY in obj)) {
    toast('ברשומה זו אין שדה ציון שניתן לערוך.', 'error');
    return;
  }
  const current = obj[SCORE_KEY];
  const curNum = toNumber(current);

  const fieldsRows = parseLine(line).filter((f) => !f.bare).map((f) =>
    `<tr class="${f.key === SCORE_KEY ? 'hl' : ''}"><th>${esc(FIELD_LABELS[f.key] || f.key)}</th><td dir="auto">${esc(f.value)}</td></tr>`).join('');

  const m = openModal({
    title: 'עריכת ציון במבחן',
    icon: 'fa-pen-to-square',
    size: 'md',
    body: `
      ${studentSummary(obj)}
      <div class="grade-editor">
        <div class="grade-box">
          <span class="grade-label">ציון נוכחי</span>
          <span class="grade-value">${esc(current === '' ? '—' : current)}</span>
        </div>
        <i class="fa-solid fa-arrow-left grade-arrow"></i>
        <div class="grade-box grade-box-new">
          <span class="grade-label">ציון חדש</span>
          <input class="grade-input" type="number" inputmode="decimal" step="any" value="${esc(current)}" aria-label="ציון חדש">
          <span class="grade-diff"></span>
        </div>
      </div>
      <div class="chips">
        ${[-10, -5, -1, 1, 5, 10].map((d) => `<button type="button" class="chip" data-d="${d}">${d > 0 ? '+' : ''}${d}</button>`).join('')}
        <button type="button" class="chip" data-set="100">100</button>
      </div>
      <label class="field"><span>סיבת השינוי (רשות, נשמרת ביומן השינויים)</span>
        <input class="input" id="grade-note" maxlength="200" placeholder="לדוגמה: תיקון שאלה 4 שנבדקה בטעות"></label>
      <details class="raw-details"><summary>כל נתוני הרשומה</summary>
        <table class="kv-table">${fieldsRows}</table></details>
      <p class="field-error" hidden></p>`,
    footer: `<button class="btn btn-ghost" data-act="cancel">ביטול</button>
             <button class="btn btn-primary" data-act="save" disabled><i class="fa-solid fa-floppy-disk"></i> שמירת הציון</button>`,
  });

  const input = m.body.querySelector('.grade-input');
  const diffEl = m.body.querySelector('.grade-diff');
  const saveBtn = m.footer.querySelector('[data-act=save]');
  const err = m.body.querySelector('.field-error');

  const refresh = () => {
    const v = input.value.trim();
    const n = toNumber(v);
    const changed = v !== String(current).trim() && v !== '';
    saveBtn.disabled = !changed || !Number.isFinite(n);
    if (changed && Number.isFinite(n) && Number.isFinite(curNum)) {
      const d = Math.round((n - curNum) * 100) / 100;
      diffEl.textContent = d === 0 ? '' : `${d > 0 ? '+' : ''}${fmtNum(d, 2)}`;
      diffEl.className = `grade-diff ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`;
    } else diffEl.textContent = '';
  };
  input.addEventListener('input', refresh);
  m.body.querySelectorAll('.chip').forEach((c) => (c.onclick = () => {
    const base = Number.isFinite(toNumber(input.value)) ? toNumber(input.value) : (Number.isFinite(curNum) ? curNum : 0);
    input.value = c.dataset.set ?? String(Math.round((base + Number(c.dataset.d)) * 100) / 100);
    refresh();
    input.focus();
  }));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !saveBtn.disabled) saveBtn.click(); });
  setTimeout(() => { input.focus(); input.select(); }, 60);
  m.footer.querySelector('[data-act=cancel]').onclick = () => m.close();

  saveBtn.onclick = async () => {
    err.hidden = true;
    const raw = input.value.trim();
    const n = toNumber(raw);
    if (!Number.isFinite(n)) { err.textContent = 'יש להזין ציון מספרי.'; err.hidden = false; return; }
    if (n < 0) { err.textContent = 'ציון לא יכול להיות שלילי.'; err.hidden = false; return; }
    if (n > 100 && !(Number.isFinite(curNum) && curNum > 100)) {
      const ok = await confirmDialog({ title: 'ציון מעל 100', message: `הציון שהוזן (${esc(raw)}) גבוה מ-100. להמשיך?`, confirmText: 'כן, שמור' });
      if (!ok) return;
    }
    const newValue = String(n);
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner spinner-sm"></span> שומר...';
    try {
      if (isActive && await hasActiveCallsIn(parentPath(path))) {
        const go = await confirmDialog({
          title: 'יש כעת תלמידים בתוך המבחן', danger: true, countdown: 5,
          message: 'זוהתה פעילות בשלוחת המבחן ברגע זה. שמירה בזמן שתלמיד מסיים מבחן עלולה לגרום לאובדן התוצאה שלו.<br><br>מומלץ להמתין מעט ולנסות שוב.',
          confirmText: 'שמור בכל זאת',
        });
        if (!go) throw new Error('השמירה בוטלה.');
      }
      const newLine = setField(line, SCORE_KEY, newValue);
      await writeLineChange(path, line, newLine, occurrence);
      gradeHistory.add({
        path, name: obj.ValName || '', phone: obj.Phone || '', school: obj.School || '',
        from: current, to: newValue, oldLine: line, newLine,
        note: m.body.querySelector('#grade-note').value.trim(),
      });
      m.close();
      toast(`הציון של ${obj.ValName || 'התלמיד'} עודכן מ-${current} ל-${newValue}`, 'success');
      onSaved && onSaved();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> שמירת הציון';
    }
  };
}

/** Change log dialog for a report, with undo. */
export function openHistory(path, onChanged) {
  const m = openModal({ title: 'יומן שינויי ציונים', icon: 'fa-clock-rotate-left', size: 'lg' });
  const render = () => {
    const list = gradeHistory.forPath(path);
    if (!list.length) {
      m.setBody('<div class="state state-empty"><i class="fa-solid fa-clock-rotate-left"></i><p>עדיין לא נערכו ציונים בדוח זה מהמחשב הזה.</p></div>');
      return;
    }
    m.setBody(`<p class="muted">היומן נשמר בדפדפן במחשב זה בלבד. ניתן לבטל שינוי כל עוד הרשומה לא השתנתה מאז.</p>
      <div class="table-wrap"><table class="data-table"><thead><tr>
        <th>מתי</th><th>תלמיד</th><th>שינוי</th><th>סיבה</th><th></th></tr></thead><tbody>
      ${list.map((h) => `<tr class="${h.undone ? 'is-muted' : ''}">
        <td dir="ltr" class="nowrap">${esc(new Date(h.ts).toLocaleString('he-IL'))}</td>
        <td><strong>${esc(h.name || '—')}</strong>${h.school ? `<div class="muted small">${esc(h.school)}</div>` : ''}</td>
        <td class="nowrap"><span class="badge">${esc(h.from)}</span> <i class="fa-solid fa-arrow-left small"></i> <span class="badge badge-primary">${esc(h.to)}</span></td>
        <td>${esc(h.note || '')}</td>
        <td>${h.undone ? '<span class="muted small">בוטל</span>' : `<button class="btn btn-sm btn-ghost" data-undo="${esc(h.id)}"><i class="fa-solid fa-rotate-left"></i> ביטול שינוי</button>`}</td>
      </tr>`).join('')}</tbody></table></div>`);
    m.body.querySelectorAll('[data-undo]').forEach((b) => (b.onclick = async () => {
      const h = gradeHistory.all().find((x) => x.id === b.dataset.undo);
      if (!h) return;
      const ok = await confirmDialog({ title: 'ביטול שינוי', message: `להחזיר את הציון של <strong>${esc(h.name)}</strong> מ-${esc(h.to)} ל-${esc(h.from)}?`, confirmText: 'כן, החזר' });
      if (!ok) return;
      b.disabled = true;
      try {
        await writeLineChange(path, h.newLine, h.oldLine, 0);
        gradeHistory.markUndone(h.id);
        gradeHistory.add({ path, name: h.name, phone: h.phone, school: h.school, from: h.to, to: h.from, oldLine: h.newLine, newLine: h.oldLine, note: 'ביטול שינוי קודם' });
        toast('השינוי בוטל והציון הוחזר.', 'success');
        render();
        onChanged && onChanged();
      } catch (e) {
        toast(e.message, 'error', 8000);
        b.disabled = false;
      }
    }));
  };
  render();
}
