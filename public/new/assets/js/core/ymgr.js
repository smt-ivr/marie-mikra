// Reading and editing raw .ymgr report lines.
// A line looks like:  ValName#ישראל%Phone#0501234567%QuestionScoreTotal#90%Date#...%Time#...
// Editing replaces ONE value and keeps every other byte of the line exactly as it was.
import { splitKeep, joinKeep } from './util.js';

export const SCORE_KEY = 'QuestionScoreTotal';

export const FIELD_LABELS = {
  ValName: 'שם',
  Phone: 'טלפון',
  QuestionScoreTotal: 'ציון',
  School: 'כיתה',
  Date: 'תאריך',
  Time: 'שעה',
  Id: 'מזהה',
  EnterId: 'קוד כניסה',
};

export function parseLine(line) {
  return String(line).split('%').map((seg) => {
    const i = seg.indexOf('#');
    return i < 0 ? { key: seg, value: '', bare: true } : { key: seg.slice(0, i), value: seg.slice(i + 1) };
  });
}

export function lineToObject(line) {
  const o = {};
  parseLine(line).forEach((f) => { if (!f.bare && !(f.key in o)) o[f.key] = f.value; });
  return o;
}

/** Return a new line with `key` set to `value`. Throws if the key does not exist. */
export function setField(line, key, value) {
  if (/[%#\r\n]/.test(String(value))) throw new Error('הערך מכיל תווים אסורים (% או #)');
  const segs = String(line).split('%');
  let found = false;
  const out = segs.map((seg) => {
    const i = seg.indexOf('#');
    if (!found && i >= 0 && seg.slice(0, i) === key) {
      found = true;
      return `${key}#${value}`;
    }
    return seg;
  });
  if (!found) throw new Error(`השדה ${key} לא נמצא ברשומה`);
  return out.join('%');
}

/** Student identifier used by the internal answers file (same order as the old version). */
export function recordId(obj) {
  return obj.Id || obj.EnterId || obj.Phone || '';
}

/** Non-empty raw report lines (same filtering the old version used). */
export function reportLines(text) {
  return String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
}

/**
 * Replace the n-th exact occurrence of `oldLine` inside `text` with `newLine`
 * (or remove it when newLine === null). Everything else stays byte-identical.
 * Returns the new text, or null when that occurrence no longer exists.
 */
export function replaceLineInText(text, oldLine, newLine, occurrence = 0) {
  const parts = splitKeep(text);
  let seen = 0;
  for (let i = 0; i < parts.lines.length; i++) {
    if (parts.lines[i] === oldLine || parts.lines[i].trim() === oldLine.trim()) {
      if (seen === occurrence) {
        if (newLine === null) {
          parts.lines.splice(i, 1);
          parts.seps.splice(i, 1);
        } else {
          parts.lines[i] = newLine;
        }
        return joinKeep(parts);
      }
      seen++;
    }
  }
  return null;
}

/** Which occurrence (0-based) of `line` is at index `idx` within `lines`. */
export function occurrenceIndex(lines, idx) {
  let n = 0;
  for (let i = 0; i < idx; i++) if (lines[i] === lines[idx]) n++;
  return n;
}

const ANSWER_RE = /^(ענה נכון|לא נכון|מסיח.*|לא ענה|-)$/;
export const isAnswerValue = (v) => ANSWER_RE.test(String(v ?? '').trim());
export const isCorrectValue = (v) => String(v ?? '').trim() === 'ענה נכון';

/**
 * Pair rows returned by RenderYMGRFile (Hebrew headers) with raw lines,
 * so every row in the table knows the exact line to edit.
 * Returns array of { row, line, lineIndex } (line may be null if no match).
 */
export function pairRowsWithLines(rows, lines) {
  const objs = lines.map(lineToObject);
  const rowVals = rows.map((r) => new Set(Object.values(r).map((v) => String(v ?? '').trim())));
  const matches = (ri, li) => {
    const o = objs[li];
    const keys = ['Phone', 'Date', 'Time', 'ValName'].filter((k) => o[k]);
    if (!keys.length) return false;
    return keys.every((k) => rowVals[ri].has(String(o[k]).trim()));
  };

  // Fast path: same count and same order.
  if (rows.length === lines.length) {
    let ok = 0;
    for (let i = 0; i < rows.length; i++) if (matches(i, i)) ok++;
    if (ok === rows.length || (rows.length > 0 && ok / rows.length >= 0.9)) {
      return rows.map((row, i) => ({ row, line: lines[i], lineIndex: i }));
    }
  }

  // Fallback: match each row to the first unused matching line.
  const used = new Set();
  return rows.map((row, ri) => {
    for (let li = 0; li < lines.length; li++) {
      if (!used.has(li) && matches(ri, li)) {
        used.add(li);
        return { row, line: lines[li], lineIndex: li };
      }
    }
    return { row, line: null, lineIndex: -1 };
  });
}
