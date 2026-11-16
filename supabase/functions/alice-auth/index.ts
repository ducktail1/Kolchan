// @ts-nocheck — код без типов, чтобы его можно было проверять и в Node
// Колчан: вход в Колчан для навыка Алисы (OAuth 2.0, «привязка аккаунта» в Яндекс Диалогах).
// Supabase → Edge Functions → alice-auth. В настройках функции выключить «Verify JWT».
// Секреты (Edge Functions → Secrets): ALICE_CLIENT_ID, ALICE_CLIENT_SECRET — те же, что в настройках навыка.
// Необязательно: ALICE_APP_URL — страница Колчана, где человек входит (по умолчанию бета).
//
//  1. Яндекс открывает …/alice-auth/authorize?client_id&redirect_uri&state → перекидываем в Колчан (?alice=…).
//  2. Человек входит в Колчан и жмёт «Подключить». Колчан зовёт …/alice-auth/code со своим входом →
//     получает адрес Яндекса с одноразовым кодом и переходит туда.
//  3. Яндекс меняет код на токен: POST …/alice-auth/token. Токен потом приходит в навык (функция alice).
// Код написан без типов TypeScript, чтобы его можно было проверить и в Node (qa/alice.test.mjs).

const env = (k, d = "") => (globalThis.Deno ? Deno.env.get(k) : globalThis.process && process.env[k]) || d;
const TTL_CODE = 10 * 60 * 1000;
const YEAR = 365 * 24 * 3600;

export function makeAuth(cfg) {
  const { url, key, clientId, clientSecret, appUrl } = cfg;
  const fetchFn = cfg.fetch || fetch;
  const H = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  const rest = (p, o = {}) => fetchFn(url + "/rest/v1/" + p, Object.assign({}, o, { headers: Object.assign({}, H, o.headers || {}) }));
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: Object.assign({}, cors, { "Content-Type": "application/json", "Cache-Control": "no-store" }) });
  const oerr = (code, s = 400) => J({ error: code }, s);
  const rnd = (n = 32) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => b.toString(36).padStart(2, "0")).join("").slice(0, n + 8); };
  const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), b => b.toString(16).padStart(2, "0")).join("");
  // Яндекс отдаёт код только на свой адрес
  const okRedirect = (r) => { try { const u = new URL(r); return u.protocol === "https:" && /(^|\.)yandex\.(net|ru|com)$/.test(u.hostname); } catch (e) { return false; } };

  async function issue(user_id) {
    const access = "ka_" + rnd(40), refresh = "kr_" + rnd(40);
    const r = await rest("alice_links", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id, token_hash: await sha(access), refresh_hash: await sha(refresh) }) });
    if (!r.ok) throw new Error("links " + r.status);
    return { access_token: access, token_type: "bearer", expires_in: YEAR, refresh_token: refresh };
  }

  return async function handle(req) {
    const u = new URL(req.url), path = u.pathname;
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    // 1. Яндекс → вход в Колчан
    if (path.endsWith("/authorize")) {
      const q = u.searchParams;
      if (q.get("client_id") !== clientId) return new Response("Неизвестный client_id", { status: 400 });
      if (!okRedirect(q.get("redirect_uri") || "")) return new Response("Неверный redirect_uri", { status: 400 });
      const to = new URL(appUrl);
      to.searchParams.set("alice", "1");
      to.searchParams.set("redirect_uri", q.get("redirect_uri"));
      to.searchParams.set("state", q.get("state") || "");
      return new Response(null, { status: 302, headers: { Location: to.toString() } });
    }

    // 2. Колчан (человек вошёл и нажал «Подключить») → одноразовый код
    if (path.endsWith("/code") && req.method === "POST") {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const ur = await fetchFn(url + "/auth/v1/user", { headers: { apikey: key, Authorization: "Bearer " + jwt } });
      if (!ur.ok) return oerr("unauthorized", 401);
      const user = await ur.json();
      const b = await req.json().catch(() => ({}));
      if (!okRedirect(b.redirect_uri || "")) return oerr("invalid_redirect_uri");
      const code = rnd(32);
      const r = await rest("alice_codes", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ code_hash: await sha(code), user_id: user.id, redirect_uri: b.redirect_uri, expires_at: new Date(Date.now() + TTL_CODE).toISOString() }) });
      if (!r.ok) return oerr("server_error", 500);
      const back = new URL(b.redirect_uri);
      back.searchParams.set("code", code);
      if (b.state) back.searchParams.set("state", b.state);
      return J({ url: back.toString() });
    }

    // 3. Яндекс меняет код (или refresh) на токен
    if (path.endsWith("/token") && req.method === "POST") {
      const ct = req.headers.get("content-type") || "";
      const raw = await req.text();
      const p = ct.includes("json") ? (() => { try { return JSON.parse(raw); } catch (e) { return {}; } })() : Object.fromEntries(new URLSearchParams(raw));
      let id = p.client_id, secret = p.client_secret;
      const basic = (req.headers.get("authorization") || "").match(/^Basic\s+(.+)$/i);
      if (basic) { const d = atob(basic[1]); const i = d.indexOf(":"); id = decodeURIComponent(d.slice(0, i)); secret = decodeURIComponent(d.slice(i + 1)); }
      if (!clientSecret || id !== clientId || secret !== clientSecret) return oerr("invalid_client", 401);

      if (p.grant_type === "authorization_code") {
        const h = await sha(String(p.code || ""));
        const r = await rest("alice_codes?code_hash=eq." + h + "&select=user_id,redirect_uri,expires_at");
        const row = r.ok ? (await r.json())[0] : null;
        await rest("alice_codes?code_hash=eq." + h, { method: "DELETE" });     // код одноразовый
        if (!row || Date.parse(row.expires_at) < Date.now()) return oerr("invalid_grant");
        if (p.redirect_uri && p.redirect_uri !== row.redirect_uri) return oerr("invalid_grant");
        return J(await issue(row.user_id));
      }
      if (p.grant_type === "refresh_token") {
        const h = await sha(String(p.refresh_token || ""));
        const r = await rest("alice_links?refresh_hash=eq." + h + "&select=id,user_id");
        const row = r.ok ? (await r.json())[0] : null;
        if (!row) return oerr("invalid_grant");
        await rest("alice_links?id=eq." + row.id, { method: "DELETE" });
        return J(await issue(row.user_id));
      }
      return oerr("unsupported_grant_type");
    }
    return oerr("not_found", 404);
  };
}

if (globalThis.Deno) {
  Deno.serve(makeAuth({
    url: env("SUPABASE_URL"), key: env("SUPABASE_SERVICE_ROLE_KEY"),
    clientId: env("ALICE_CLIENT_ID"), clientSecret: env("ALICE_CLIENT_SECRET"),
    appUrl: env("ALICE_APP_URL", "https://ducktail1.github.io/Kolchan/beta/"),
  }));
}
