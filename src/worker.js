// Cloudflare Worker – "מארי מקרא" (בנוי כמו מסכת של שבת)
// נתיב הבסיס: /marie-mikra
//   /marie-mikra/            → האתר המקורי (העיצוב בדיוק כמו שהיה), עם מסך כניסה  ← הראשי
//   /marie-mikra/new/        → הממשק החדש                                           ← נגיש בכפתור
//   /marie-mikra/admin       → ניהול (מנהל בלבד): משתמשים, הגדרות, יומן כניסות, יומן פעולות
//   /marie-mikra/api/...     → כניסה, ניהול, ופניות למערכת דרך השרת (src/api)
//   /marie-mikra/api/message → שירות הודעת המערכת הקיים – עובר הלאה בלי שינוי
// הקבצים עצמם בתיקייה public (נטענים דרך ASSETS).
import { handleApi } from './api/router.js';
import { hasPagePermission } from './api/auth.js';
import { ensureSchema } from './api/schema.js';
import { getConfig } from './api/settings.js';
import { getPaths } from './api/yemot-paths.js';

const BASE = '/marie-mikra';

// ברירות המחדל של האתר המקורי (js/script.js) – מוחלפות בכתובות מהגדרות הניהול
const SCRIPT_DEFAULTS = {
  active_test: "'ivr2:/1/1/1/ExaminationAmericanLogOK.ymgr'",
  points_report: "'ivr2:/Points/Split/points_total.ymgr'",
  archive_folder: "'ivr2:/מבחנים-קודמים'",
};

const LOGO_URL = 'https://smti.uk/smt.png';

async function logo(env, request) {
  try {
    const res = await fetch(LOGO_URL, { cf: { cacheEverything: true, cacheTtl: 86400 } });
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.startsWith('image/')) {
      return new Response(res.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
    }
  } catch { /* נופל לסמל המובנה */ }
  return asset(env, request, '/new/assets/img/logo.svg');
}

async function asset(env, request, localPath) {
  const url = new URL(request.url);
  url.pathname = localPath;
  url.search = '';
  const res = await env.ASSETS.fetch(new Request(url.toString(), request));
  // הפניות של שרת הקבצים נשארות בתוך /marie-mikra
  const loc = res.headers.get('Location');
  if (loc && loc.startsWith('/') && !loc.startsWith(`${BASE}/`)) {
    const headers = new Headers(res.headers);
    headers.set('Location', BASE + loc);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const redirect = (to, status = 301) => Response.redirect(url.origin + to, status);

    if (path === '/' || !path.startsWith(BASE)) return redirect(`${BASE}/`, 302);
    if (path === BASE) return redirect(`${BASE}/`);

    // שירות הודעת המערכת (קיים בנפרד) – לא חלק מהאתר הזה
    if (path === `${BASE}/api/message` || path.startsWith(`${BASE}/api/message/`)) return fetch(request);

    // API של האתר
    if (path.startsWith(`${BASE}/api/`)) return handleApi(request, env, path.slice(`${BASE}/api/`.length));

    // ניהול
    if (path === `${BASE}/admin` || path === `${BASE}/admin/`) {
      const res = await asset(env, request, '/admin');
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Robots-Tag', 'noindex');
      return new Response(res.body, { status: res.status, headers });
    }

    // תאימות לאחור: הכתובת הקודמת של האתר המקורי
    if (path === `${BASE}/legacy` || path.startsWith(`${BASE}/legacy/`)) return redirect(`${BASE}/`);

    // הממשק החדש – רק למשתמש מחובר עם ההרשאה "ממשק חדש" (הכניסה דרך האתר הראשי)
    if (path === `${BASE}/new`) return redirect(`${BASE}/new/`);
    if (path === `${BASE}/new/` || path === `${BASE}/new/index.html`) {
      await ensureSchema(env);
      if (!(await hasPagePermission(request, env, 'new_site'))) return redirect(`${BASE}/`, 302);
      const res = await asset(env, request, '/new/');
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(res.body, { status: res.status, headers });
    }

    const local = path.slice(BASE.length) || '/';

    // הלוגו (smt.png) – גם הסמלון בלשונית הדפדפן. מוגש מאותה כתובת של האתר (בלי הפניה),
    // כי דפדפנים לא תמיד מציגים סמלון שמגיע בהפניה לכתובת אחרת
    if (local === '/smt.png' || local === '/favicon.ico') return logo(env, request);

    // האתר המקורי: הכתובות (ברירות המחדל שלו) נלקחות מהגדרות הניהול
    if (local === '/js/script.js') {
      const res = await asset(env, request, local);
      let js = await res.text();
      try {
        await ensureSchema(env);
        const p = getPaths((await getConfig(env)).yemot_paths);
        const q = (v) => `'ivr2:/${String(v).replace(/'/g, "\\'")}'`;
        js = js.replace(SCRIPT_DEFAULTS.active_test, q(p.active_test))
          .replace(SCRIPT_DEFAULTS.points_report, q(p.points_report))
          .replace(SCRIPT_DEFAULTS.archive_folder, q(p.archive_folder));
      } catch { /* ברירות המחדל המקוריות */ }
      return new Response(js, { status: 200, headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    return asset(env, request, local);
  },
};
