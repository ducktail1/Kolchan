"""Pack the beta (kolchan-beta/) into one HTML for a Claude artifact preview, with a pretend server."""
import json, re, sys, os
base, out, seed = sys.argv[1], sys.argv[2], sys.argv[3]
B = os.path.join(base, sys.argv[4] if len(sys.argv) > 4 else "kolchan-beta")
TITLE = sys.argv[5] if len(sys.argv) > 5 else "kolchan.beta"
h = open(os.path.join(B, "index.html"), encoding="utf-8").read()
for f in ["local.js", "friends.js", "cloud.js"]:
    js = open(os.path.join(B, f), encoding="utf-8").read()
    js = js.replace('if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});', '')
    h = h.replace('<script src="' + f + '"></script>', '<script>\n' + js + '\n</script>')
for pat in [r'<!doctype html>\n', r'<html lang="ru">\n', r'<head>\n', r'</head>\n', r'<body>\n', r'</body>\n', r'</html>\n',
            r'<meta charset="utf-8">\n', r'<meta name="viewport"[^>]*>\n', r'<meta name="(apple-mobile|mobile)[^>]*>\n',
            r'<link rel="(manifest|apple-touch-icon|icon)"[^>]*>\n', r'<title>[^<]*</title>\n']:
    h = re.sub(pat, '', h)
data = json.load(open(seed, encoding="utf-8"))
data = {k: data.get(k, []) for k in ("places", "bags", "items", "quivers")}
mock = r'''<script>
// Preview only: a pretend Supabase so the screens can be tried inside Claude (any e-mail and password work).
(function () {
  const C = window.__CLOUD; const real = window.fetch.bind(window); const rows = new Map();
  const J = (j, s) => new Response(JSON.stringify(j), { status: s || 200, headers: { "Content-Type": "application/json" } });
  window.fetch = async (url, opt) => {
    url = String(url); if (!url.startsWith(C.url)) return real(url, opt);
    const u = new URL(url), p = u.pathname, body = opt && opt.body ? JSON.parse(opt.body) : null;
    await new Promise(r => setTimeout(r, 250));
    if (p === "/auth/v1/signup" || p === "/auth/v1/token") {
      if (u.searchParams.get("grant_type") === "refresh_token") return J({ access_token: "AT", refresh_token: "RT", expires_in: 3600, user: { id: "u1", email: "preview@kolchan" } });
      return J({ access_token: "AT", refresh_token: "RT", expires_in: 3600, user: { id: "u1", email: body.email } });
    }
    if (p === "/auth/v1/logout") return new Response(null, { status: 204 });
    if (p === "/functions/v1/tg-auth") {   // pretend the bot confirmed after a few seconds
      window.__tgPolls = (window.__tgPolls || 0) + 1;
      if (window.__tgPolls < 3) return J({ pending: true });
      window.__tgPolls = 0;
      const meta = { name: "Алексей", tg_id: 1, tg_username: "ducktail10", phone: body.link ? undefined : "+79990000000" };
      if (body.link) return J({ linked: true, user_metadata: meta });
      return J({ session: { access_token: "AT", refresh_token: "RT", expires_in: 3600, user: { id: "u1", email: "tg1@tg.kolchan.app", user_metadata: meta } } });
    }
    if (p === "/rest/v1/records") {
      if (!opt || !opt.method || opt.method === "GET") return J([...rows.values()]);
      body.forEach(r => rows.set(r.coll + "|" + r.id, { coll: r.coll, id: r.id, data: r.data, deleted: r.deleted })); return new Response(null, { status: 201 });
    }
    return J({}, 404);
  };
})();
</script>
'''
pre = ('<title>' + TITLE + '</title>\n<script>window.__KOLCHAN_PREVIEW = true; window.__KOLCHAN_SEED = '
       + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + ';</script>\n')
# the pretend server must be in place before cloud.js runs: put it right after the __CLOUD config
h = h.replace('<script>\n// Колчан: аккаунт', mock + '<script>\n// Колчан: аккаунт', 1)
assert 'pretend Supabase' in h
open(out, "w", encoding="utf-8").write(pre + h)
print("ok", len(pre + h))
