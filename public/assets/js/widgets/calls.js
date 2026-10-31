// Live calls indicator + dialog.
import { getIncomingCalls } from '../core/api.js';
import { PATHS } from '../core/settings.js';
import { openModal } from '../core/ui.js';
import { esc } from '../core/util.js';

const INTERVAL = 2000;
let calls = [];
let timer = null;
let modal = null;
let btn = null;
const listeners = new Set();

export const liveCalls = {
  get list() { return calls; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

function parseCaller(raw) {
  if (!raw) return { phone: '—', code: '—', name: '—' };
  if (!raw.includes(' זיהוי ')) return { phone: raw, code: '—', name: '—' };
  const [phone, rest = ''] = raw.split(' זיהוי ');
  const m = rest.trim().match(/^(\d+)\s+(.*)$/);
  if (m) return { phone: phone.trim(), code: m[1], name: m[2] };
  return /^\d+$/.test(rest.trim()) ? { phone: phone.trim(), code: rest.trim(), name: '—' } : { phone: phone.trim(), code: '—', name: rest.trim() };
}
const dur = (s) => `${String(Math.floor((s || 0) / 60)).padStart(2, '0')}:${String((s || 0) % 60).padStart(2, '0')}`;

function renderModal() {
  if (!modal) return;
  if (!calls.length) { modal.setBody('<div class="state state-empty"><i class="fa-solid fa-phone-slash"></i><p>אין שיחות פעילות כרגע</p></div>'); return; }
  modal.setBody(`<div class="table-wrap"><table class="data-table"><thead><tr><th>מתקשר</th><th>קוד</th><th>שם</th><th>מיקום במערכת</th><th>משך</th></tr></thead><tbody>
    ${calls.map((c) => { const p = parseCaller(c.callerIdNum); return `<tr><td class="ltr-cell"><span class="live-dot"></span> ${esc(p.phone)}</td><td class="mono">${esc(p.code)}</td>
      <td><strong>${esc(p.name)}</strong></td><td class="ltr-cell">${c.path ? esc(c.path) : '<span class="muted">בכניסה למערכת</span>'}</td><td class="mono">${dur(c.duration)}</td></tr>`; }).join('')}
    </tbody></table></div>`);
}

async function tick() {
  if (document.hidden) return;
  try {
    const raw = await getIncomingCalls();
    calls = raw.filter((c) => !PATHS.excludedDids.includes(c.did));
    if (btn) {
      btn.querySelector('.calls-n').textContent = calls.length;
      btn.classList.toggle('has-calls', calls.length > 0);
      btn.title = calls.length ? `${calls.length} שיחות פעילות` : 'אין שיחות פעילות';
    }
    listeners.forEach((fn) => fn(calls));
    renderModal();
  } catch { /* ignore polling errors */ }
}

export function startCalls(button) {
  btn = button;
  btn.hidden = false;
  btn.onclick = () => {
    modal = openModal({ title: 'שיחות פעילות בזמן אמת', icon: 'fa-tower-broadcast', size: 'lg', footer: '<span class="live-note"><span class="live-dot"></span> מתעדכן אוטומטית</span>', onClose: () => { modal = null; } });
    renderModal();
  };
  clearInterval(timer);
  tick();
  timer = setInterval(tick, INTERVAL);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
