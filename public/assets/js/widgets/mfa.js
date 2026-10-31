// Two-step verification dialog (Yemot MFASession).
import { call } from '../core/api.js';
import { settings } from '../core/settings.js';
import { openModal, loadingHtml } from '../core/ui.js';
import { esc } from '../core/util.js';

const NIKE = {
  CREATE_PHONE: 'מנהל המערכת',
  RESET_MAIL: 'מייל שחזור',
  PROFILE: 'מהגדרות הפרופיל',
  MASTER_LOGIN: 'אימות מנהל (משווק)',
  BY_CUSTOMER: 'נוסף על ידי הלקוח',
};
const SEND = { CALL: 'שיחה קולית', SMS: 'הודעת SMS', EMAIL: 'הודעת מייל' };
const SEND_ICON = { CALL: 'fa-phone', SMS: 'fa-comment-sms', EMAIL: 'fa-envelope' };
const TYPE = { PHONE: ['אימות לטלפון', 'fa-mobile-screen'], EMAIL: ['אימות במייל', 'fa-envelope'] };

const mfaCall = (params) => call('MFASession', params);

/** Opens the dialog. Resolves true when verification succeeded. */
export function runMfa() {
  return new Promise((resolve) => {
    let success = false;
    const m = openModal({ title: 'אימות דו-שלבי', icon: 'fa-shield-halved', size: 'md', onClose: () => resolve(success) });
    let groups = new Map();
    let selected = null;

    const showError = (msg) => {
      m.setBody(`<div class="state state-error"><i class="fa-solid fa-triangle-exclamation"></i><p>${esc(msg)}</p></div>`);
      m.setFooter('<button class="btn btn-primary" data-act="retry"><i class="fa-solid fa-rotate"></i> נסו שוב</button>');
      m.footer.querySelector('[data-act=retry]').onclick = loadMethods;
    };

    async function loadMethods() {
      m.setTitle('אימות דו-שלבי');
      m.setBody(loadingHtml('טוען אפשרויות אימות...'));
      m.setFooter('');
      try {
        const data = await mfaCall({ action: 'getMFAMethods' });
        groups = new Map();
        (data.mfaMethods || []).forEach((method) => {
          method.validSendTypes = (Array.isArray(method.SEND_TYPE) ? method.SEND_TYPE : []).filter((t) => SEND[t]);
          const key = method.VALUE || 'default';
          if (!groups.has(key)) groups.set(key, { value: method.VALUE, status: method.STATUS, type: method.TYPE, methods: [] });
          groups.get(key).methods.push(method);
        });
        renderMethods();
      } catch (e) {
        showError(e.message);
      }
    }

    function renderMethods() {
      if (!groups.size) { showError('לא נמצאו שיטות אימות זמינות.'); return; }
      const cards = [...groups.entries()].map(([key, g]) => {
        const sendTypes = [...new Set(g.methods.flatMap((x) => x.validSendTypes))];
        const usable = g.status === 'ACTIVE' && sendTypes.length > 0;
        const [label, icon] = TYPE[g.type] || ['אימות', 'fa-user-shield'];
        const sources = [...new Set(g.methods.map((x) => NIKE[x.NIKE] || x.NIKE || 'אימות כללי'))].join(' · ');
        const status = g.status === 'PENDING' ? 'ממתין לאישור באתר ימות' : usable ? 'לחצו לבחירה' : 'לא ניתן לשלוח אימות';
        return `<button class="mfa-card" data-key="${esc(key)}" ${usable ? '' : 'disabled'}>
          <i class="fa-solid ${icon} mfa-card-icon"></i>
          <span class="mfa-card-main"><strong>${esc(label)}</strong><span dir="ltr">${esc(g.value)}</span><small>${esc(sources)}</small></span>
          <span class="mfa-card-tags">${sendTypes.map((s) => `<span class="tag"><i class="fa-solid ${SEND_ICON[s]}"></i> ${SEND[s]}</span>`).join('')}</span>
          <span class="mfa-card-status">${status}</span>
        </button>`;
      }).join('');
      m.setTitle('בחירת אמצעי אימות');
      m.setBody(`<p class="muted">כדי להמשיך יש לאמת את הכניסה. בחרו לאן לשלוח את קוד האימות:</p><div class="mfa-cards">${cards}</div>`);
      m.setFooter('');
      m.body.querySelectorAll('.mfa-card:not([disabled])').forEach((b) => (b.onclick = () => { selected = b.dataset.key; renderSend(); }));
    }

    function renderSend() {
      const g = groups.get(selected);
      const radios = g.methods.flatMap((method) => method.validSendTypes.map((s) => ({ id: method.ID, s })));
      m.setTitle('שליחת קוד אימות');
      m.setBody(`
        <p>הקוד יישלח אל <strong dir="ltr">${esc(g.value)}</strong></p>
        <div class="radio-list">
          ${radios.map((r, i) => `<label class="radio"><input type="radio" name="mfa-send" value="${esc(r.s)}" data-id="${esc(r.id)}" ${i === 0 ? 'checked' : ''}><i class="fa-solid ${SEND_ICON[r.s]}"></i> ${SEND[r.s]}</label>`).join('')}
        </div>
        <label class="check"><input type="checkbox" id="mfa-remember"> זכור מכשיר זה (לא יידרש אימות בפעם הבאה)</label>
        <label class="field"><span>כינוי למכשיר (רשות)</span><input class="input" id="mfa-note" disabled placeholder="לדוגמה: מחשב משרד"></label>`);
      m.setFooter('<button class="btn btn-ghost" data-act="back">חזרה</button><button class="btn btn-primary" data-act="send"><i class="fa-solid fa-paper-plane"></i> שלחו קוד</button>');
      const remember = m.body.querySelector('#mfa-remember');
      const note = m.body.querySelector('#mfa-note');
      remember.onchange = () => { note.disabled = !remember.checked; if (!remember.checked) note.value = ''; };
      m.footer.querySelector('[data-act=back]').onclick = renderMethods;
      m.footer.querySelector('[data-act=send]').onclick = async (e) => {
        const r = m.body.querySelector('input[name=mfa-send]:checked');
        if (!r) return;
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner spinner-sm"></span> שולח...';
        try {
          await mfaCall({ action: 'sendMFA', mfaId: r.dataset.id, mfaSendType: r.value });
          renderCode(g, remember.checked, note.value.trim());
        } catch (err) {
          showError(err.message);
        }
      };
    }

    function renderCode(g, rememberMe, rememberNote) {
      m.setTitle('הזנת קוד אימות');
      m.setBody(`
        <p>הקוד נשלח אל <strong dir="ltr">${esc(g.value)}</strong>.</p>
        <label class="field"><span>קוד אימות</span><input class="input input-code" id="mfa-code" inputmode="numeric" autocomplete="one-time-code" dir="ltr"></label>
        <p class="field-error" hidden></p>`);
      m.setFooter('<button class="btn btn-ghost" data-act="back">שליחה מחדש</button><button class="btn btn-primary" data-act="verify"><i class="fa-solid fa-check"></i> אימות</button>');
      const input = m.body.querySelector('#mfa-code');
      const err = m.body.querySelector('.field-error');
      setTimeout(() => input.focus(), 50);
      const verify = async () => {
        const code = input.value.trim();
        if (code.length < 4) { input.focus(); return; }
        const btn = m.footer.querySelector('[data-act=verify]');
        btn.disabled = true;
        err.hidden = true;
        try {
          const params = { action: 'validMFA', mfaCode: code };
          if (rememberMe) { params.mfaRememberMe = 1; if (rememberNote) params.mfaRememberNote = rememberNote; }
          const res = await mfaCall(params);
          if (res.mfa_valid_status === 'VALID') {
            success = true;
            m.setBody('<div class="state state-success"><i class="fa-solid fa-circle-check"></i><p>האימות הושלם בהצלחה!</p></div>');
            m.setFooter('');
            setTimeout(() => m.close(), 1200);
            return;
          }
          let msg = res.mfa_valid_message || 'הקוד שגוי.';
          if (res.mfa_valid_status !== 'OVERTRY' && res.mfa_valid_left > 0) msg += ` נותרו ${res.mfa_valid_left} ניסיונות.`;
          else { msg += ' לא נותרו ניסיונות, יש לשלוח קוד חדש.'; setTimeout(renderMethods, 1800); }
          err.textContent = msg;
          err.hidden = false;
          input.select();
        } catch (e2) {
          showError(e2.message);
        } finally {
          if (btn.isConnected) btn.disabled = false;
        }
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') verify(); };
      m.footer.querySelector('[data-act=verify]').onclick = verify;
      m.footer.querySelector('[data-act=back]').onclick = renderMethods;
    }

    if (!settings.token) showError('לא נמצא טוקן.'); else loadMethods();
  });
}
