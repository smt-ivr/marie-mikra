// Small shared helpers.

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape any value for safe insertion into HTML text or attributes. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return NaN;
  return Number(s);
}

export function fmtNum(n, digits = 0) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('he-IL', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Parent folder of an ivr2 path ("ivr2:/1/1/x.ymgr" -> "ivr2:/1/1"). */
export function parentPath(path) {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.substring(0, i) : path;
}

export function baseName(path) {
  return path.split('/').pop();
}

/** Split text into lines while keeping the exact separators, so a file can be
 *  rebuilt byte-for-byte after changing a single line. */
export function splitKeep(text) {
  const parts = String(text ?? '').split(/(\r?\n)/);
  const lines = [];
  const seps = [];
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i]);
    seps.push(parts[i + 1] ?? '');
  }
  return { lines, seps };
}

export function joinKeep({ lines, seps }) {
  let out = '';
  for (let i = 0; i < lines.length; i++) out += lines[i] + (seps[i] ?? '');
  return out;
}

/** Detect the dominant line ending of a text. */
export function eolOf(text) {
  return /\r\n/.test(text || '') ? '\r\n' : '\n';
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Export an array of plain objects (or {headers, rows}) to a CSV that Excel opens in Hebrew. */
export function exportCsv(headers, rows, filename) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(q).join(',')];
  rows.forEach((r) => lines.push(r.map(q).join(',')));
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), safeFileName(filename) + '.csv');
}

export function safeFileName(name) {
  return String(name || 'export').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export';
}

export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function storageGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function storageJson(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
