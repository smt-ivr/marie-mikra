// Serves the static site from ./public, both at the root (workers.dev)
// and under the /marie-mikra path on smti.uk (Worker route).
//
//   /marie-mikra            -> redirect to /marie-mikra/ (so relative links work)
//   /marie-mikra/api/...    -> passed through untouched (existing message API)
//   /marie-mikra/<file>     -> served from ./public/<file>
//   /<file>                 -> served from ./public/<file>

const PREFIX = '/marie-mikra';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === PREFIX) {
      url.pathname = `${PREFIX}/`;
      return Response.redirect(url.toString(), 301);
    }

    if (path.startsWith(`${PREFIX}/api/`)) {
      // Not part of this site: let the request continue to its usual destination.
      return fetch(request);
    }

    if (path.startsWith(`${PREFIX}/`)) {
      url.pathname = path.slice(PREFIX.length) || '/';
      const res = await env.ASSETS.fetch(new Request(url.toString(), request));
      // Keep redirects issued by the asset server inside the /marie-mikra prefix.
      const loc = res.headers.get('Location');
      if (loc && loc.startsWith('/') && !loc.startsWith(`${PREFIX}/`)) {
        const headers = new Headers(res.headers);
        headers.set('Location', PREFIX + loc);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      }
      return res;
    }

    return env.ASSETS.fetch(request);
  },
};
