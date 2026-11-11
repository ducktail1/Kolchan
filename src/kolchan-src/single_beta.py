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
    // shared trips: the example trip already has two friends on the server
    const TR = window.__mockTrips = window.__mockTrips || { trips: [{ id: "tdemo1", owner: "u1", invite: "demo00000000000000000" }], members: null, recs: new Map() };
    if (!TR.members) {
      const a = window.__kolchanAccount && window.__kolchanAccount(), me = a && a.email ? String(a.email).split("@")[0] : "Я";
      TR.members = [{ trip_id: "tdemo1", user_id: "u1", name: me, joined_at: 1 }, { trip_id: "tdemo1", user_id: "u2", name: "Митяй", joined_at: 2 }, { trip_id: "tdemo1", user_id: "u3", name: "Костя", joined_at: 3 }];
    }
    const eq = (k) => { const v = u.searchParams.get(k); return v && v.startsWith("eq.") ? v.slice(3) : null; };
    const M = (opt && opt.method) || "GET", tok = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
    const owns = (t) => TR.trips.some(x => x.id === t && x.owner === "u1");
    const inTrip = (t) => TR.members.some(m => m.trip_id === t && m.user_id === "u1");
    if (p === "/rest/v1/trip_members") {
      if (M === "GET") return J(TR.members.filter(m => inTrip(m.trip_id)));
      if (M === "POST") { TR.members.push({ trip_id: body.trip_id, user_id: "u1", name: body.name, joined_at: Date.now() }); return new Response(null, { status: 201 }); }
      if (M === "DELETE") { TR.members = TR.members.filter(m => !(m.trip_id === eq("trip_id") && m.user_id === eq("user_id"))); return new Response(null, { status: 204 }); }
    }
    if (p === "/rest/v1/trips") {
      if (M === "GET") return J(TR.trips.filter(t => (!eq("id") || t.id === eq("id")) && (t.owner === "u1" || inTrip(t.id))).map(t => ({ id: t.id, owner: t.owner, invite: t.invite })));
      if (M === "POST") { TR.trips.push({ id: body.id, owner: "u1", invite: body.invite }); return new Response(null, { status: 201 }); }
      if (M === "DELETE") { const t = eq("id"); TR.trips = TR.trips.filter(x => x.id !== t); TR.members = TR.members.filter(m => m.trip_id !== t); return new Response(null, { status: 204 }); }
    }
    if (p === "/rest/v1/trip_records") {
      if (M === "GET") { const t = eq("trip_id"); return J([...TR.recs.values()].filter(r => r.trip_id === t)); }
      body.forEach(r => TR.recs.set(r.trip_id + "|" + r.coll + "|" + r.id, r)); return new Response(null, { status: 201 });
    }
    if (p === "/rest/v1/events") { (window.__mockEvents = window.__mockEvents || []).push(...body); return new Response(null, { status: 201 }); }
    if (p === "/rest/v1/rpc/trip_new_invite") { const t = TR.trips.find(x => x.id === body.p_trip && x.owner === "u1"); if (!t) return J(null); t.invite = tok(); return J(t.invite); }
    if (p === "/rest/v1/rpc/trip_kick") {
      if (!owns(body.p_trip) || body.p_user === "u1") return J(false);
      TR.members = TR.members.filter(m => !(m.trip_id === body.p_trip && m.user_id === body.p_user));
      TR.trips.find(x => x.id === body.p_trip).invite = tok(); return J(true);
    }
    if (p === "/rest/v1/rpc/join_trip") { const t = TR.trips.find(x => x.id === body.p_trip && x.invite === body.p_invite); if (!t) return J(false); TR.members.push({ trip_id: t.id, user_id: "u1", name: body.p_name, joined_at: Date.now() }); return J(true); }
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
# preview: already signed in as Алексей (the login screen is tested; it only gets in the way)
old = 'const s = await K.get("meta", "cloudSession");'
assert h.count(old) == 1
h = h.replace(old, 'let s = await K.get("meta", "cloudSession"); if (!(s && (s.access_token || s.none))) { s = { access_token: "AT", refresh_token: "RT", expires_at: Date.now() + 86400000, user: { id: "u1", email: "tg1@tg.kolchan.app", meta: { name: "Алексей", tg_id: 1, tg_username: "ducktail10" } } }; await K.put("meta", Object.assign({ key: "cloudSession" }, s)); }')
open(out, "w", encoding="utf-8").write(pre + h)
print("ok", len(pre + h))
