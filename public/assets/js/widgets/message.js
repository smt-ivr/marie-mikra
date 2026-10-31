// Developer announcement (same source as the old version), shown inside a sandboxed frame
// so its content can never access the stored token or password.
import { openModal } from '../core/ui.js';
import { storageJson, storageSet } from '../core/util.js';

const API_URL = 'https://smti.uk/marie-mikra/api/message';
const READ_KEY = 'smti_read_messages';

let current = null;

function show() {
  if (!current) return;
  const m = openModal({
    title: 'הודעת מערכת', icon: 'fa-bullhorn', size: 'lg',
    body: '<iframe class="msg-frame" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" src="message-frame.html" title="הודעת מערכת"></iframe>',
    footer: '<button class="btn btn-primary" data-act="read"><i class="fa-solid fa-check"></i> קראתי</button>',
  });
  const frame = m.body.querySelector('iframe');
  const html = current.message;
  frame.addEventListener('load', () => frame.contentWindow.postMessage({ type: 'mm-message', html }, '*'));
  const onResize = (e) => {
    if (e.source === frame.contentWindow && e.data?.type === 'mm-height') frame.style.height = `${Math.min(Math.max(e.data.h, 120), window.innerHeight * 0.7)}px`;
  };
  window.addEventListener('message', onResize);
  m.footer.querySelector('[data-act=read]').onclick = () => {
    if (current.id) {
      const read = storageJson(READ_KEY, []);
      if (!read.includes(current.id)) { read.push(current.id); storageSet(READ_KEY, JSON.stringify(read)); }
    }
    updateBadge();
    m.close();
  };
  const origClose = m.close;
  m.close = () => { window.removeEventListener('message', onResize); origClose(); };
}

let bell = null;
function updateBadge() {
  if (!bell) return;
  const unread = current && current.id && !storageJson(READ_KEY, []).includes(current.id);
  bell.hidden = !current;
  bell.classList.toggle('has-unread', !!unread);
}

export async function startMessages(button) {
  bell = button;
  bell.onclick = show;
  try {
    const res = await fetch(API_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.message || !String(data.message).trim()) return;
    current = { message: String(data.message), id: data.id_message ? String(data.id_message) : null };
    updateBadge();
    if (current.id && !storageJson(READ_KEY, []).includes(current.id)) show();
  } catch { /* message service unavailable */ }
}
