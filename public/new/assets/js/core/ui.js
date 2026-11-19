// Shared UI building blocks: toasts, dialogs, states and a data table.
import { esc } from './util.js';

// ---------------- Toasts ----------------

let toastHost;
export function toast(message, type = 'success', ms = 4500) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${esc(message)}</span><button class="toast-x" aria-label="סגירה">&times;</button>`;
  const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  el.querySelector('.toast-x').onclick = remove;
  toastHost.appendChild(el);
  if (ms) setTimeout(remove, ms);
}

// ---------------- Modals ----------------

const openStack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openStack.length) {
    const top = openStack[openStack.length - 1];
    if (top.dismissible) top.close();
  }
});

/** Close every open dialog (used when navigating to another page). */
export function closeAllModals() {
  [...openStack].reverse().forEach((m) => { if (m.dismissible) m.close(); });
}

/**
 * Open a dialog. Returns a controller {el, body, footer, close, setBody, setFooter, setTitle}.
 */
export function openModal({ title = '', icon = '', body = '', footer = '', size = 'md', dismissible = true, onClose, className = '' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-${size} ${className}" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h2 class="modal-title">${icon ? `<i class="fa-solid ${icon}"></i>` : ''}<span></span></h2>
        ${dismissible ? '<button class="icon-btn modal-x" aria-label="סגירה"><i class="fa-solid fa-xmark"></i></button>' : ''}
      </header>
      <div class="modal-body"></div>
      <footer class="modal-foot"></footer>
    </div>`;
  const modal = overlay.querySelector('.modal');
  const bodyEl = overlay.querySelector('.modal-body');
  const footEl = overlay.querySelector('.modal-foot');
  const titleEl = overlay.querySelector('.modal-title span');

  let closed = false;
  const ctrl = {
    el: modal,
    body: bodyEl,
    footer: footEl,
    dismissible,
    setTitle(t) { titleEl.textContent = t; },
    setBody(content) { setContent(bodyEl, content); },
    setFooter(content) { setContent(footEl, content); footEl.hidden = !content; },
    close() {
      if (closed) return;
      closed = true;
      overlay.classList.remove('show');
      const i = openStack.indexOf(ctrl);
      if (i >= 0) openStack.splice(i, 1);
      setTimeout(() => overlay.remove(), 180);
      if (!openStack.length) document.body.classList.remove('modal-open');
      onClose && onClose();
    },
  };
  ctrl.setTitle(title);
  ctrl.setBody(body);
  ctrl.setFooter(footer);
  if (dismissible) {
    overlay.querySelector('.modal-x').onclick = () => ctrl.close();
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) ctrl.close(); });
  }
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  openStack.push(ctrl);
  requestAnimationFrame(() => overlay.classList.add('show'));
  return ctrl;
}

function setContent(el, content) {
  if (content instanceof Node) { el.innerHTML = ''; el.appendChild(content); }
  else el.innerHTML = content || '';
}

/** Confirmation dialog. Resolves true/false. `countdown` (seconds) delays enabling the confirm button. */
export function confirmDialog({ title = 'אישור פעולה', message = '', confirmText = 'אישור', cancelText = 'ביטול', danger = false, icon, countdown = 0, size = 'sm' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    let timer;
    const m = openModal({
      title, size,
      icon: icon || (danger ? 'fa-triangle-exclamation' : 'fa-circle-question'),
      className: danger ? 'modal-danger' : '',
      body: `<div class="confirm-msg">${message}</div>`,
      footer: `<button class="btn btn-ghost" data-act="cancel">${esc(cancelText)}</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmText)}</button>`,
      onClose: () => { clearInterval(timer); resolve(result); },
    });
    const ok = m.footer.querySelector('[data-act=ok]');
    m.footer.querySelector('[data-act=cancel]').onclick = () => m.close();
    ok.onclick = () => { result = true; m.close(); };
    if (countdown > 0) {
      let left = countdown;
      ok.disabled = true;
      ok.textContent = `המתינו ${left} שניות`;
      timer = setInterval(() => {
        left--;
        if (left <= 0) { clearInterval(timer); ok.disabled = false; ok.textContent = confirmText; }
        else ok.textContent = `המתינו ${left} שניות`;
      }, 1000);
    } else {
      setTimeout(() => ok.focus(), 50);
    }
  });
}

/** Text prompt. Resolves the string, or null when cancelled. */
export function promptDialog({ title, label = '', value = '', placeholder = '', hint = '', confirmText = 'אישור', validate } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const m = openModal({
      title, size: 'sm', icon: 'fa-pen',
      body: `<form class="form" novalidate>
               <label class="field"><span>${esc(label)}</span>
                 <input class="input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
               </label>
               ${hint ? `<p class="hint">${hint}</p>` : ''}
               <p class="field-error" hidden></p>
             </form>`,
      footer: `<button class="btn btn-ghost" data-act="cancel">ביטול</button><button class="btn btn-primary" data-act="ok">${esc(confirmText)}</button>`,
      onClose: () => resolve(result),
    });
    const input = m.body.querySelector('input');
    const err = m.body.querySelector('.field-error');
    const submit = () => {
      const v = input.value.trim();
      const problem = validate ? validate(v) : (v ? null : 'יש למלא ערך');
      if (problem) { err.textContent = problem; err.hidden = false; input.focus(); return; }
      result = v;
      m.close();
    };
    m.body.querySelector('form').onsubmit = (e) => { e.preventDefault(); submit(); };
    m.footer.querySelector('[data-act=ok]').onclick = submit;
    m.footer.querySelector('[data-act=cancel]').onclick = () => m.close();
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

// ---------------- States ----------------

export const loadingHtml = (text = 'טוען נתונים...') =>
  `<div class="state state-loading"><span class="spinner"></span><p>${esc(text)}</p></div>`;

export const emptyHtml = (text = 'אין נתונים להצגה', icon = 'fa-inbox') =>
  `<div class="state state-empty"><i class="fa-solid ${icon}"></i><p>${esc(text)}</p></div>`;

export const errorHtml = (err) =>
  `<div class="state state-error"><i class="fa-solid fa-triangle-exclamation"></i><p>${esc(err?.message || err || 'שגיאה')}</p></div>`;

/** Put a button into a busy state while an async action runs. */
export async function withBusy(btn, fn, busyText) {
  if (!btn) return fn();
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner spinner-sm"></span>${busyText ? ` ${esc(busyText)}` : ''}`;
  try {
    return await fn();
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; }
  }
}

// ---------------- Data table ----------------

/**
 * createTable(container, options)
 *  columns: [{ key, label, render?(row)->html, value?(row)->sortable value, className?, sortable? }]
 *  rows: array
 *  searchText?(row) -> string used by filter()
 *  selectable?: boolean, rowId(row)
 *  actions?(row) -> html (buttons with data-action attributes)
 *  onAction?(action, row, button)
 *  onSelect?(selectedRows)
 *  rowClass?(row) -> string
 */
export function createTable(container, opts) {
  const state = {
    rows: opts.rows || [],
    term: '',
    sortKey: opts.sortKey || null,
    sortDir: opts.sortDir || 1,
    selected: new Set(),
  };
  const colValue = (col, row) => (col.value ? col.value(row) : row[col.key]);
  const rowId = (row) => (opts.rowId ? opts.rowId(row) : state.rows.indexOf(row));
  const textOf = (row) => (opts.searchText ? opts.searchText(row) : opts.columns.map((c) => colValue(c, row)).join(' ')).toString().toLowerCase();

  function filtered() {
    let list = state.rows;
    if (state.term) {
      const terms = state.term.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((r) => { const t = textOf(r); return terms.every((x) => t.includes(x)); });
    }
    if (state.sortKey) {
      const col = opts.columns.find((c) => c.key === state.sortKey);
      if (col) {
        list = [...list].sort((a, b) => {
          const va = colValue(col, a); const vb = colValue(col, b);
          const na = typeof va === 'number' ? va : Number(va); const nb = typeof vb === 'number' ? vb : Number(vb);
          let cmp;
          if (va !== '' && vb !== '' && Number.isFinite(na) && Number.isFinite(nb)) cmp = na - nb;
          else cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'he', { numeric: true });
          return cmp * state.sortDir;
        });
      }
    }
    return list;
  }

  function render() {
    const list = filtered();
    if (!state.rows.length) { container.innerHTML = emptyHtml(opts.emptyText); return; }
    const head = opts.columns.map((c) => {
      const sortable = c.sortable !== false;
      const active = state.sortKey === c.key;
      const arrow = active ? (state.sortDir > 0 ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short') : 'fa-sort';
      return `<th class="${c.className || ''} ${sortable ? 'sortable' : ''} ${active ? 'sorted' : ''}" data-key="${esc(c.key)}">
                <span>${esc(c.label)}</span>${sortable ? `<i class="fa-solid ${arrow}"></i>` : ''}</th>`;
    }).join('');
    const body = list.length ? list.map((row) => {
      const id = rowId(row);
      const sel = state.selected.has(id);
      return `<tr data-id="${esc(id)}" class="${sel ? 'is-selected' : ''} ${opts.rowClass ? opts.rowClass(row) : ''}">
        ${opts.selectable ? `<td class="col-check"><input type="checkbox" class="row-check" ${sel ? 'checked' : ''} aria-label="בחירה"></td>` : ''}
        ${opts.columns.map((c) => `<td class="${c.className || ''}">${c.render ? c.render(row) : esc(colValue(c, row))}</td>`).join('')}
        ${opts.actions ? `<td class="col-actions">${opts.actions(row)}</td>` : ''}
      </tr>`;
    }).join('') : `<tr><td class="no-match" colspan="${opts.columns.length + (opts.selectable ? 1 : 0) + (opts.actions ? 1 : 0)}">לא נמצאו תוצאות לחיפוש</td></tr>`;

    const allVisibleSelected = list.length && list.every((r) => state.selected.has(rowId(r)));
    container.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            ${opts.selectable ? `<th class="col-check"><input type="checkbox" class="all-check" ${allVisibleSelected ? 'checked' : ''} aria-label="בחירת הכל"></th>` : ''}
            ${head}
            ${opts.actions ? '<th class="col-actions">פעולות</th>' : ''}
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
    opts.onRender && opts.onRender(list);
  }

  const byId = (id) => state.rows.find((r) => String(rowId(r)) === String(id));

  // Re-creating a table in the same container must not stack event handlers.
  if (container._tableCleanup) container._tableCleanup();

  const onClick = (e) => {
    const th = e.target.closest('th.sortable');
    if (th && container.contains(th)) {
      const k = th.dataset.key;
      if (state.sortKey === k) state.sortDir = -state.sortDir; else { state.sortKey = k; state.sortDir = 1; }
      render();
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (btn && opts.onAction) {
      const tr = btn.closest('tr');
      const row = byId(tr?.dataset.id);
      if (row) opts.onAction(btn.dataset.action, row, btn);
      return;
    }
    if (opts.selectable) {
      const tr = e.target.closest('tbody tr[data-id]');
      if (tr && !e.target.closest('button, a, input, select, label')) {
        const cb = tr.querySelector('.row-check');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  };

  const onChange = (e) => {
    if (e.target.classList.contains('row-check')) {
      const tr = e.target.closest('tr');
      const id = rowId(byId(tr.dataset.id));
      if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
      tr.classList.toggle('is-selected', e.target.checked);
      opts.onSelect && opts.onSelect(api.selected());
    } else if (e.target.classList.contains('all-check')) {
      filtered().forEach((r) => (e.target.checked ? state.selected.add(rowId(r)) : state.selected.delete(rowId(r))));
      render();
      opts.onSelect && opts.onSelect(api.selected());
    }
  };

  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container._tableCleanup = () => {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    container._tableCleanup = null;
  };

  const api = {
    setRows(rows) { state.rows = rows || []; const ids = new Set(state.rows.map(rowId)); [...state.selected].forEach((id) => { if (!ids.has(id)) state.selected.delete(id); }); render(); },
    filter(term) { state.term = term || ''; render(); },
    filtered,
    selected: () => state.rows.filter((r) => state.selected.has(rowId(r))),
    clearSelection() { state.selected.clear(); render(); opts.onSelect && opts.onSelect([]); },
    render,
  };
  render();
  return api;
}

/** Small reusable search box. */
export function searchBox(placeholder = 'חיפוש...') {
  return `<label class="search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" placeholder="${esc(placeholder)}" autocomplete="off"></label>`;
}

/** Simple dropdown menu toggling (buttons with .menu-toggle inside .menu). */
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('.menu-toggle');
  document.querySelectorAll('.menu.open').forEach((m) => { if (!toggle || !m.contains(toggle)) m.classList.remove('open'); });
  if (toggle) toggle.closest('.menu').classList.toggle('open');
});
