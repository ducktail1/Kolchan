// Поддельный Supabase в памяти для QA: таблицы, правила доступа как на сервере, вход и выход.
// Подключается к контексту Playwright: ctx.route(/supabase\.co/, mock.handle)
function createMock() {
  const db = { records: [], trips: [], trip_members: [], trip_records: [], events: [] };
  const users = new Map();      // id → { id, email, password, name }
  const tokens = new Map();     // access → uid
  const refresh = new Map();    // refresh → uid
  let down = false, n = 0;
  const log = [];

  function addUser(id, email, password, name) { users.set(id, { id, email, password, name }); return users.get(id); }
  function session(uid) {
    const u = users.get(uid), a = "acc-" + uid + "-" + (++n), r = "ref-" + uid + "-" + n;
    tokens.set(a, uid); refresh.set(r, uid);
    return { access_token: a, refresh_token: r, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: u.email, user_metadata: { name: u.name } } };
  }
  // the same as supabase/trips-owner.sql trip_record_ok
  const recordOk = (r) => ["places", "bags", "items", "quivers"].includes(r.coll) && r.id && r.id.length <= 64 && JSON.stringify(r.data || {}).length <= 65536 &&
    (r.deleted || (r.coll === "quivers" ? r.id === r.trip_id && r.data && r.data.kind === "trip" : r.data && r.data.q === r.trip_id));
  const member = (uid, t) => db.trip_members.some(m => m.trip_id === t && m.user_id === uid);

  async function handle(route) {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const J = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: b === null ? "" : JSON.stringify(b) });
    if (down) return route.abort("connectionrefused");
    const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch (e) { return null; } })() : null;
    const p = url.pathname;
    log.push(method + " " + p + url.search);
    // ---- auth ----
    if (p === "/auth/v1/token") {
      const g = url.searchParams.get("grant_type");
      if (g === "password") { const u = [...users.values()].find(x => x.email === body.email && x.password === body.password); return u ? J(session(u.id)) : J({ msg: "Invalid login credentials" }, 400); }
      if (g === "refresh_token") { const uid = refresh.get(body.refresh_token); if (!uid) return J({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }, 400); refresh.delete(body.refresh_token); return J(session(uid)); }
    }
    if (p === "/auth/v1/logout") {
      const uid = tokens.get((req.headers()["authorization"] || "").replace("Bearer ", ""));
      if (uid && url.searchParams.get("scope") !== "local") { for (const [k, v] of [...refresh]) if (v === uid) refresh.delete(k); }   // global: every device of the user
      return J(null, 204);
    }
    if (p.startsWith("/auth/v1/")) return J({});
    if (!p.startsWith("/rest/v1/")) return J({});
    const path = p.slice("/rest/v1/".length);
    const f = {}; url.searchParams.forEach((v, k) => { if (v.startsWith("eq.")) f[k] = v.slice(3); });
    const match = (r) => Object.entries(f).every(([k, v]) => String(r[k]) === v);
    const tok = (req.headers()["authorization"] || "").replace("Bearer ", ""), me = tokens.get(tok);
    if (path === "events" && method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      if (!me && rows.some(e => !["login_error", "login_fail", "error"].includes(e.kind))) return J({ message: "rls" }, 403);
      rows.forEach(e => db.events.push(Object.assign({ user_id: me || null }, e))); return J(null, 201);
    }
    if (!me) return J({ message: "JWT expired" }, 401);
    if (path === "records") {
      if (method === "GET") { const all = db.records.filter(r => r.user_id === me); const rg = (req.headers()["range"] || "0-999").split("-").map(Number); return J(all.slice(rg[0], rg[1] + 1)); }
      for (const r of body) { const i = db.records.findIndex(x => x.user_id === me && x.coll === r.coll && x.id === r.id); const row = Object.assign({}, r, { user_id: me }); if (i >= 0) db.records[i] = row; else db.records.push(row); }
      return J(null, 201);
    }
    if (path === "trip_members") {
      if (method === "GET") return J(db.trip_members.filter(m => member(me, m.trip_id)).filter(match));
      if (method === "POST") { const t = db.trips.find(x => x.id === body.trip_id); if (!t || t.owner !== me) return J({ message: "rls" }, 403); db.trip_members.push({ trip_id: body.trip_id, user_id: me, name: body.name, joined_at: Date.now() }); return J(null, 201); }
      if (method === "DELETE") { db.trip_members = db.trip_members.filter(m => !(m.user_id === me && match(m))); return J(null, 204); }
    }
    if (path === "trips") {
      if (method === "GET") return J(db.trips.filter(t => t.owner === me || member(me, t.id)).filter(match));
      if (method === "POST") { db.trips.push({ id: body.id, invite: body.invite, owner: me }); return J(null, 201); }
      if (method === "DELETE") { const ids = db.trips.filter(t => t.owner === me && match(t)).map(t => t.id); db.trips = db.trips.filter(t => !ids.includes(t.id)); db.trip_members = db.trip_members.filter(m => !ids.includes(m.trip_id)); db.trip_records = db.trip_records.filter(r => !ids.includes(r.trip_id)); return J(null, 204); }
    }
    if (path === "trip_records") {
      if (method === "GET") return J(member(me, f.trip_id) ? db.trip_records.filter(match) : []);
      for (const r of body) {
        if (!member(me, r.trip_id) || !recordOk(r)) return J({ message: "new row violates row-level security policy for table \"trip_records\"" }, 403);
      }
      for (const r of body) { const i = db.trip_records.findIndex(x => x.trip_id === r.trip_id && x.coll === r.coll && x.id === r.id); if (i >= 0) db.trip_records[i] = r; else db.trip_records.push(r); }
      return J(null, 201);
    }
    if (path === "rpc/join_trip") { const t = db.trips.find(x => x.id === body.p_trip && x.invite === body.p_invite); if (!t) return J(false); if (!member(me, t.id)) db.trip_members.push({ trip_id: t.id, user_id: me, name: body.p_name, joined_at: Date.now() }); return J(true); }
    if (path === "rpc/trip_new_invite") { const t = db.trips.find(x => x.id === body.p_trip && x.owner === me); if (!t) return J(null); t.invite = Math.random().toString(36).slice(2, 22); return J(t.invite); }
    if (path === "rpc/trip_kick") { const t = db.trips.find(x => x.id === body.p_trip && x.owner === me); if (!t || body.p_user === me) return J(false); db.trip_members = db.trip_members.filter(m => !(m.trip_id === t.id && m.user_id === body.p_user)); t.invite = Math.random().toString(36).slice(2, 22); return J(true); }
    return J({ message: "unknown " + path }, 404);
  }
  return { db, users, addUser, session, handle, log, setDown: (v) => { down = v; } };
}
module.exports = { createMock };
