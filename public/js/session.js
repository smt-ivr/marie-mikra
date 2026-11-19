// ============================================================
//  session.js — מסך הכניסה (אותה לוגיקה של מסכת של שבת, סיסמה בלבד)
//  כניסה שמורה → האתר נפתח מיד (מסך הכניסה לא מוצג), והכניסה נבדקת מול השרת ברקע.
//  אחרת: הטופס פתוח מיד, ובמקביל בדיקת IP מורשית (כניסה אוטומטית רק אם עוד לא הקלידו).
//  החיבור עצמו בעוגייה מאובטחת בשרת. בדפדפן נשמר רק שם המשתמש לתצוגה (mm_user) – לא טוקנים.
//  בכניסה: טוקנים וסיסמאות ישנים נמחקים מהדפדפן, והשרת מקבל דיווח מה נמצא ונמחק.
//  אין עדיין אף משתמש? → הגדרה ראשונית: טוקן + סיסמת מנהל.
//  אזור אישי: פרטי המשתמש, ויצירה / החלפה של הסיסמה (בכפוף להרשאה "יצירת והחלפת סיסמה אישית").
// ============================================================

const MsSession = (() => {
    const API = '/marie-mikra/api/';
    const USER_KEY = 'mm_user';
    const CLEAN_FLAG = 'mmBrowserCleanupReported';
    // מפתחות שבהם האתר שמר בעבר טוקן וסיסמה
    const LEGACY_KEYS = ['api_token', 'username', 'password'];
    const ALL_PERMS = ['tests_view', 'tests_edit', 'points_view', 'points_edit', 'students_view', 'students_edit',
        'times_view', 'times_edit', 'tzintuk_view', 'tzintuk_edit', 'logs_view', 'new_site', 'self_password', 'admin'];
    const PROMPT_FLAG = 'mmPasswordPromptShown';

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    };

    let user = null;
    let resolveReady;
    const readyPromise = new Promise((r) => { resolveReady = r; });
    const rawFetch = window.fetch.bind(window);
    const $ = (id) => document.getElementById(id);

    // timeoutMs — הבדיקות ברקע לא נתקעות לעולם
    async function call(method, path, body, timeoutMs = 15000) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        let res;
        try {
            res = await rawFetch(API + path, {
                method, credentials: 'same-origin', signal: ctrl.signal,
                headers: body ? { 'Content-Type': 'application/json' } : {},
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (e) {
            throw new Error(e.name === 'AbortError' ? 'השרת לא ענה בזמן, נסו שוב' : 'אין חיבור לשרת');
        } finally {
            clearTimeout(timer);
        }
        const data = await res.json().catch(() => null);
        if (!data || !data.ok) {
            const e = new Error(data && data.error ? data.error.message : 'אין חיבור לשרת');
            e.status = res.status;
            throw e;
        }
        return data.data;
    }

    function clearSession() { store.del(USER_KEY); }
    function saveSession(u) { store.set(USER_KEY, JSON.stringify(u)); }

    // ===== ניקוי הדפדפן =====
    async function cleanBrowser() {
        const found = LEGACY_KEYS.filter((k) => store.get(k) !== null);
        found.forEach((k) => store.del(k));
        // מדווחים תמיד כשנמצא משהו, ופעם אחת לכל דפדפן גם כשהוא נקי
        if (!found.length && store.get(CLEAN_FLAG) === '1') return;
        try {
            await call('POST', 'client/browser-cleanup', { found }, 8000);
            store.set(CLEAN_FLAG, '1');
        } catch (e) { /* ננסה בכניסה הבאה */ }
    }

    // ===== פס משתמש קטן בשורת הלשוניות: שם (אזור אישי), ממשק חדש, ניהול, יציאה =====
    function renderUserBar() {
        let bar = $('mmUserBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'mmUserBar';
            // בשורת הלשוניות, בקצה השמאלי שלה (המקום הפנוי). בלי לשוניות – בפינה
            const tabs = document.querySelector('#main-content nav.tabs');
            bar.className = tabs ? 'mm-userbar mm-inline' : 'mm-userbar';
            (tabs || document.body).appendChild(bar);
        }
        const ip = user.method === 'ip';
        bar.innerHTML = `
            <button class="mm-name" id="mmBarMe" type="button" title="אזור אישי"><i class="fa fa-circle-user"></i><strong></strong></button>
            <span class="mm-sep"></span>
            <a id="mmBarNew" href="/marie-mikra/new/" title="מעבר לממשק החדש"><i class="fa fa-wand-magic-sparkles"></i><span class="mm-label">ממשק חדש</span></a>
            <a id="mmBarAdmin" href="/marie-mikra/admin" target="_blank" rel="noopener" title="ניהול משתמשים, הגדרות ויומנים"><i class="fa fa-users"></i><span class="mm-label">ניהול</span></a>
            <button id="mmBarOut" type="button" title="${ip ? 'נכנסתם לפי כתובת IP. לחצו כדי להתחבר עם סיסמה' : 'יציאה מהמערכת'}">
                <i class="fa ${ip ? 'fa-key' : 'fa-right-from-bracket'}"></i><span class="mm-label">${ip ? 'התחברות עם סיסמה' : 'יציאה'}</span></button>`;
        bar.querySelector('strong').textContent = user.name || '';
        $('mmBarOut').onclick = ip ? openPasswordLogin : logout;
        $('mmBarMe').onclick = () => openPersonalArea();
    }

    // ===== אזור אישי =====
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const METHOD_NAMES = { password: 'סיסמה', ip: 'כתובת IP מורשית', google: 'Google' };

    function openPersonalArea(opts = {}) {
        if (!user) return;
        const old = $('mmPersonal');
        if (old) old.remove();
        const hasPw = !!user.has_password;
        const allowed = can('self_password');
        // אימות הסיסמה הנוכחית: רק כשיש סיסמה, ולא כשנכנסו עכשיו עם Google
        const needCurrent = hasPw && user.method !== 'google';
        const wrap = document.createElement('div');
        wrap.id = 'mmPersonal';
        wrap.className = 'mm-pa-overlay';
        wrap.innerHTML = `
            <div class="mm-pa" role="dialog" aria-labelledby="mmPaTitle">
                <div class="mm-pa-head">
                    <h2 id="mmPaTitle"><i class="fa fa-circle-user"></i> אזור אישי</h2>
                    <button type="button" class="mm-pa-x" aria-label="סגירה">&times;</button>
                </div>
                ${opts.prompt ? '<div class="mm-pa-note"><i class="fa fa-key"></i> עדיין אין לכם סיסמה. אפשר ליצור סיסמה עכשיו, כדי להיכנס גם מכל מחשב אחר.</div>' : ''}
                <dl class="mm-pa-info">
                    <dt>שם</dt><dd>${esc(user.name)}</dd>
                    ${user.email ? `<dt>מייל</dt><dd dir="ltr">${esc(user.email)}</dd>` : ''}
                    <dt>נכנסתם עם</dt><dd>${esc(METHOD_NAMES[user.method] || user.method || '—')}</dd>
                    <dt>סיסמה</dt><dd>${hasPw ? 'מוגדרת' : 'עדיין אין'}</dd>
                </dl>
                ${allowed ? `
                <form class="mm-pa-form" autocomplete="off">
                    <h3>${hasPw ? 'החלפת סיסמה' : 'יצירת סיסמה'}</h3>
                    ${needCurrent ? '<label>סיסמה נוכחית<input type="password" name="current" dir="ltr" autocomplete="current-password"></label>' : ''}
                    <label>${hasPw ? 'סיסמה חדשה' : 'סיסמה'} (לפחות 4 תווים, אפשר גם 4 ספרות)<input type="password" name="next" dir="ltr" autocomplete="new-password"></label>
                    <label>אימות הסיסמה<input type="password" name="next2" dir="ltr" autocomplete="new-password"></label>
                    <div class="mm-pa-msg" role="alert"></div>
                    <div class="mm-pa-actions">
                        ${opts.prompt ? '<button type="button" class="mm-pa-later">אחר כך</button>' : ''}
                        <button type="submit" class="mm-pa-save">${hasPw ? 'החלפת סיסמה' : 'יצירת סיסמה'}</button>
                    </div>
                </form>` : `<p class="mm-pa-muted">${hasPw ? 'להחלפת הסיסמה' : 'ליצירת סיסמה'} יש לפנות למנהל המערכת.</p>`}
            </div>`;
        document.body.appendChild(wrap);
        const close = () => wrap.remove();
        wrap.querySelector('.mm-pa-x').onclick = close;
        wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
        // "אחר כך" – נשמר בחשבון בשרת: ההצעה לא תופיע יותר, עד שהמנהל יאפס בדף הניהול
        const later = wrap.querySelector('.mm-pa-later');
        if (later) later.onclick = () => {
            close();
            user.password_prompt_dismissed = true;
            saveSession(user);
            call('POST', 'auth/password-prompt/dismiss', {}, 8000).catch(() => {});
        };
        const form = wrap.querySelector('form');
        if (!form) return;
        const msg = wrap.querySelector('.mm-pa-msg');
        const show = (text, ok) => { msg.textContent = text; msg.className = 'mm-pa-msg ' + (ok ? 'ok' : 'err'); };
        setTimeout(() => (form.current || form.next).focus(), 50);
        form.onsubmit = async (e) => {
            e.preventDefault();
            const next = form.next.value;
            if (next.length < 4) return show('הסיסמה חייבת להכיל לפחות 4 תווים');
            if (next !== form.next2.value) return show('הסיסמאות אינן זהות');
            if (needCurrent && !form.current.value) return show('יש להזין את הסיסמה הנוכחית');
            const btn = form.querySelector('.mm-pa-save');
            btn.disabled = true;
            try {
                await call('POST', 'auth/password', { current: needCurrent ? form.current.value : undefined, password: next }, 15000);
                user.has_password = true;
                saveSession(user);
                form.innerHTML = `<div class="mm-pa-msg ok"><i class="fa fa-circle-check"></i> ${hasPw ? 'הסיסמה הוחלפה' : 'הסיסמה נוצרה'}. מעכשיו אפשר להיכנס איתה מכל מחשב.</div>
                    <div class="mm-pa-actions"><button type="button" class="mm-pa-save">סגירה</button></div>`;
                form.querySelector('.mm-pa-save').onclick = close;
            } catch (er) {
                show(er.message);
                btn.disabled = false;
            }
        };
    }

    // משתמש בלי סיסמה, עם ההרשאה – מוצעת לו יצירת סיסמה.
    // "אחר כך" נשמר בשרת (המנהל יכול לאפס). סגירה ב-X – רק עד שהדפדפן נסגר.
    function maybePromptPassword(u) {
        if (!u || u.has_password !== false || u.password_prompt_dismissed || !can('self_password')) return;
        if ($('mmPersonal')) return;
        try { if (sessionStorage.getItem(PROMPT_FLAG) === '1') return; sessionStorage.setItem(PROMPT_FLAG, '1'); } catch (e) { /* ignore */ }
        openPersonalArea({ prompt: true });
    }

    function showSite() {
        const overlay = $('auth-overlay');
        if (overlay) overlay.style.display = 'none';
        document.documentElement.classList.remove('ms-auth-pending');
        document.body.classList.remove('ms-locked');
    }

    // חזרה למסך הכניסה (כניסה שפגה באמצע העבודה)
    let loginAgainShown = false;
    function showLoginAgain(message) {
        if (loginAgainShown) return;
        loginAgainShown = true;
        clearSession();
        const flicker = $('noFlickerStyle');
        if (flicker) flicker.remove();
        document.documentElement.classList.add('ms-auth-pending');
        document.body.classList.add('ms-locked');
        const overlay = $('auth-overlay');
        overlay.style.display = '';
        $('lgCancel').classList.add('hidden');
        $('authMessage').innerHTML = `<i class="fa fa-lock"></i>${message}`;
        resetButton();
        $('passwordInput').value = '';
        $('passwordInput').focus();
        // אחרי כניסה מחדש – טוענים את האתר מחדש כדי שהנתונים יעלו נקי
        reloadAfterLogin = true;
        // קודם בודקים IP מורשה – אם המחשב מורשה, נכנסים שוב אוטומטית
        call('POST', 'auth/login', {}, 8000)
            .then((r) => { if (r.authorized && !$('passwordInput').value) finish(r.user); })
            .catch(() => {});
    }

    // מסך הכניסה מעל האתר, כשכבר מחוברים (לפי IP) – כניסה בסיסמה, עם אפשרות ביטול
    function openPasswordLogin() {
        const overlay = $('auth-overlay');
        const flicker = $('noFlickerStyle');
        if (flicker) flicker.remove();
        overlay.style.display = '';
        document.body.classList.add('ms-locked');
        $('authMessage').innerHTML = `<i class="fa fa-lock"></i>מחוברים לפי כתובת IP כ"${user.name}". הזינו סיסמה כדי להתחבר בסיסמה`;
        $('loginError').classList.add('hidden');
        $('lgCancel').classList.remove('hidden');
        resetButton();
        $('passwordInput').value = '';
        $('passwordInput').focus();
        reloadAfterLogin = true;
    }
    function closePasswordLogin() {
        $('auth-overlay').style.display = 'none';
        document.body.classList.remove('ms-locked');
        $('lgCancel').classList.add('hidden');
        reloadAfterLogin = false;
    }

    let reloadAfterLogin = false;
    let done = false;

    function finish(u) {
        user = u;
        saveSession(u);
        applyPermissions();
        if (reloadAfterLogin) return location.reload();
        if (done) { renderUserBar(); maybePromptPassword(u); return; }
        done = true;
        renderUserBar();
        showSite();
        resolveReady(u);
        cleanBrowser();
        maybePromptPassword(u);
    }

    // ===== הרשאות: מה שאין למשתמש הרשאה אליו מוסתר באתר (והשרת חוסם ממילא) =====
    function applyPermissions() {
        const have = new Set((user && user.permissions) || []);
        const root = document.documentElement;
        ALL_PERMS.forEach((p) => root.classList.toggle('ms-no-' + p, !have.has(p)));
    }
    const can = (p) => !!(user && user.permissions && user.permissions.includes(p));

    // הלשונית הראשונה שיש עליה הרשאה (בלי צפייה במבחנים – לא נפתחת לשונית המבחנים)
    const TAB_PERMS = { 'tests-view': 'tests_view', 'points-view': 'points_view', 'students-view': 'students_view',
        'time-view': 'times_view', 'tzintuk-view': 'tzintuk_view', 'logs-view': 'logs_view' };
    function firstAllowedTab() {
        return Object.keys(TAB_PERMS).find((v) => can(TAB_PERMS[v])) || null;
    }

    function resetButton() {
        const btn = $('loginBtn');
        btn.disabled = false;
        btn.innerHTML = '<span>כניסה</span><i class="fa fa-arrow-left"></i>';
    }

    async function logout() {
        try { await call('POST', 'auth/logout', null, 8000); } catch (e) { /* ignore */ }
        clearSession();
        location.reload();
    }

    // ===== כניסה עם Google =====
    async function setupGoogle(showError, clientId) {
        if (!clientId) return;
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client?hl=he';
            s.async = true;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        }).catch(() => null);
        if (!window.google || !google.accounts || !google.accounts.id) return;
        google.accounts.id.initialize({
            client_id: clientId,
            ux_mode: 'popup',
            callback: async (resp) => {
                $('loginError').classList.add('hidden');
                try { finish((await call('POST', 'auth/google', { credential: resp.credential })).user); }
                catch (e) { showError(e.message); }
            },
        });
        const slot = $('googleSlot');
        google.accounts.id.renderButton(slot, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: 'he', width: Math.min(360, slot.clientWidth || 320) });
        slot.classList.remove('hidden');
        $('googleOr').classList.remove('hidden');
    }

    // ===== הגדרה ראשונית: אין עדיין אף משתמש =====
    function showSetup(showError) {
        $('lgTitle').textContent = 'הגדרה ראשונית';
        $('authMessage').innerHTML = '<i class="fa fa-gear"></i>מזינים את הטוקן פעם אחת, ובוחרים סיסמת מנהל';
        $('loginForm').classList.add('hidden');
        const form = $('setupForm');
        form.classList.remove('hidden');
        $('setupToken').focus();
        form.onsubmit = async (e) => {
            e.preventDefault();
            $('loginError').classList.add('hidden');
            const token = $('setupToken').value.trim();
            const p1 = $('setupPass').value;
            if (!token) return showError('יש להזין טוקן');
            if (p1.length < 4) return showError('הסיסמה חייבת להכיל לפחות 4 תווים');
            if (p1 !== $('setupPass2').value) return showError('הסיסמאות אינן זהות');
            const btn = $('setupBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i><span>בודק את הטוקן...</span>';
            try {
                finish((await call('POST', 'auth/setup', { token, password: p1 }, 30000)).user);
            } catch (er) {
                showError(er.message);
                btn.disabled = false;
                btn.innerHTML = '<span>שמירה וכניסה</span><i class="fa fa-arrow-left"></i>';
            }
        };
    }

    function setupLogin() {
        const pass = $('passwordInput'), btn = $('loginBtn'), msg = $('authMessage');
        const showError = (text) => { $('loginErrorText').textContent = text; $('loginError').classList.remove('hidden'); };
        $('lgCancel').onclick = closePasswordLogin;

        // הצגת סיסמה + Caps Lock
        $('lgEye').onclick = () => {
            const show = pass.type === 'password';
            pass.type = show ? 'text' : 'password';
            $('lgEye').innerHTML = `<i class="fa ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
            pass.focus();
        };
        const caps = (e) => { if (e.getModifierState) $('lgCaps').classList.toggle('hidden', !e.getModifierState('CapsLock')); };
        pass.addEventListener('keydown', caps);
        pass.addEventListener('keyup', caps);

        // כניסה בסיסמה
        $('loginForm').onsubmit = async (e) => {
            e.preventDefault();
            $('loginError').classList.add('hidden');
            if (!pass.value) return showError('יש להזין סיסמה');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i><span>מאמת...</span>';
            try {
                const r = await call('POST', 'auth/login', { password: pass.value });
                finish(r.user);
            } catch (er) {
                showError(er.message);
                resetButton();
                pass.select();
            }
        };

        const options = call('GET', 'auth/options', null, 8000).catch(() => ({}));
        options.then((o) => setupGoogle(showError, o && o.google_client_id));

        // כניסה שמורה בזיכרון — האתר נפתח מיד, והכניסה נבדקת מול השרת ברקע.
        // אם היא כבר לא תקפה – חוזרים למסך הכניסה.
        let saved = null;
        try { saved = JSON.parse(store.get(USER_KEY) || 'null'); } catch (e) { /* ignore */ }
        if (saved) {
            finish(saved);
            call('GET', 'auth/me', null, 8000)
                .then((r) => finish(r.user))
                .catch((e) => { if (e.status === 401) showLoginAgain('הכניסה פגה — הזינו סיסמה'); });
            return;
        }

        // אין כניסה שמורה: הטופס פתוח מיד, ובדיקת ה-IP רצה במקביל.
        // כניסה אוטומטית לפי IP — רק אם עוד לא התחילו להקליד.
        document.body.classList.add('ms-locked');
        pass.focus();
        const typing = () => pass.value || !btn.querySelector('.fa-arrow-left');
        (async () => {
            // חיבור קיים בעוגייה (למשל אחרי ניקוי הזיכרון בדפדפן)
            try { return finish((await call('GET', 'auth/me', null, 8000)).user); } catch (e) { /* לא מחובר */ }
            const o = await options;
            if (o && o.setup_needed) return showSetup(showError);
            try {
                const r = await call('POST', 'auth/login', {}, 8000);
                if (r.authorized && !typing()) return finish(r.user);
                if (!done) msg.innerHTML = '<i class="fa fa-lock"></i>כתובת ה-IP אינה מורשית — הזינו סיסמה';
            } catch (e) {
                if (!done) msg.innerHTML = '<i class="fa fa-lock"></i>הזינו סיסמה';
            }
        })();
    }

    // כניסה שפגה באמצע העבודה → חוזרים למסך הכניסה
    window.fetch = async (input, init) => {
        const res = await rawFetch(input, init);
        const url = typeof input === 'string' ? input : input && input.url;
        if (res.status === 401 && done && url && url.includes('/marie-mikra/api/') && !url.includes('/marie-mikra/api/auth/')) {
            showLoginAgain('הכניסה פגה — הזינו סיסמה');
        }
        return res;
    };

    // ===== מספר גרסה בקטן בתחתית (לא מפריע: שקוף ולא לוכד לחיצות) =====
    async function showVersion() {
        try {
            const v = await call('GET', 'version', null, 8000);
            const el = document.createElement('div');
            el.className = 'mm-version';
            const when = v.deployed_at ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(v.deployed_at)) : '';
            el.textContent = `גרסה ${v.release}${when ? ` · עלתה ${when}` : ''}`;
            el.title = [v.note, v.id ? `מזהה פריסה: ${v.id}` : ''].filter(Boolean).join('\n');
            document.body.appendChild(el);
        } catch (e) { /* ignore */ }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { setupLogin(); showVersion(); });
    else { setupLogin(); showVersion(); }

    return {
        ready: () => readyPromise,
        user: () => user,
        can,
        firstAllowedTab,
        openPersonalArea,
        logout,
    };
})();
