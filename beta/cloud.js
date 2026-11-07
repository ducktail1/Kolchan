// Колчан (бета): аккаунт и онлайн-база в Supabase.
// Телефон по-прежнему главный: всё лежит в IndexedDB и работает без сети,
// а при входе база объединяется с облаком (те же правила, что у синхронизации с GitHub).
(function () {
  "use strict";
  const CFG = window.__CLOUD || {};
  const $ = (id) => document.getElementById(id);
  const K = window.__kolchan;
  const S = window.__kolchanSync;            // { merge, sameData, DATA }
  const DATA = S.DATA;
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const ready = !!(CFG.url && CFG.key);

  // ---------- auth (Supabase GoTrue over plain fetch) ----------
  let session = null;   // { access_token, refresh_token, expires_at, user: { id, email } }
  const saveSession = async (s) => { session = s; if (s) await K.put("meta", Object.assign({ key: "cloudSession" }, s)); else await K.put("meta", { key: "cloudSession", none: true }); paint(); if (window.__kolchanRemind) window.__kolchanRemind(); };
  const metaOf = (u) => { const m = (u && u.user_metadata) || {}; return { name: m.name || "", phone: m.phone || "", tg_id: m.tg_id || null, tg_username: m.tg_username || "" }; };
  const fromAuth = (j) => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at ? j.expires_at * 1000 : Date.now() + (j.expires_in || 3600) * 1000, user: { id: j.user && j.user.id, email: (j.user && (j.user.email || (j.user.user_metadata && j.user.user_metadata.email))) || "", meta: metaOf(j.user) } });
  // accounts made through Telegram get a service address that is never shown
  const realEmail = (e) => (e && !/@tg\.kolchan\.app$/i.test(e) ? e : "");
  const shownName = (u) => (u.meta && u.meta.name) || realEmail(u.email) || (u.meta && u.meta.phone) || (u.meta && u.meta.tg_username ? "@" + u.meta.tg_username : "") || "Аккаунт";

  async function api(path, opt) {
    let r;
    try { r = await fetch(CFG.url + path, Object.assign({ cache: "no-store" }, opt)); }
    catch (e) { const x = new Error("network"); x.code = "network"; throw x; }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const x = new Error((j && (j.msg || j.message || j.error_description || j.error)) || ("http " + r.status)); x.status = r.status; x.code = (j && (j.error_code || j.code)) || ""; throw x; }
    return j;
  }
  const authHeaders = () => ({ apikey: CFG.key, "Content-Type": "application/json" });
  async function signUp(email, password) {
    // the link in the confirmation e-mail brings the person back here and signs them in
    const back = encodeURIComponent(location.origin + location.pathname);
    const j = await api("/auth/v1/signup?redirect_to=" + back, { method: "POST", headers: authHeaders(), body: JSON.stringify({ email, password }) });
    if (j && j.access_token) { await saveSession(fromAuth(j)); return "in"; }
    return "confirm";   // the project asks to confirm the address by e-mail
  }
  async function signIn(email, password) {
    const j = await api("/auth/v1/token?grant_type=password", { method: "POST", headers: authHeaders(), body: JSON.stringify({ email, password }) });
    await saveSession(fromAuth(j));
  }
  async function refresh() {
    if (!session || !session.refresh_token) throw Object.assign(new Error("no session"), { status: 401 });
    const j = await api("/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: authHeaders(), body: JSON.stringify({ refresh_token: session.refresh_token }) });
    await saveSession(fromAuth(j));
  }
  async function token() {
    if (!session) return null;
    if (Date.now() > session.expires_at - 60000) await refresh();
    return session.access_token;
  }
  async function signOut() {
    try { const t = await token(); if (t) await fetch(CFG.url + "/auth/v1/logout", { method: "POST", headers: Object.assign(authHeaders(), { Authorization: "Bearer " + t }) }); } catch (e) {}
    await saveSession(null);
  }
  // OAuth providers (Google и др.) come back with tokens in the address: #access_token=…&refresh_token=…
  async function takeRedirect() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get("error_description")) { history.replaceState(null, "", location.pathname); return "Вход не удался: " + h.get("error_description"); }
    if (!h.get("access_token")) return null;
    const at = h.get("access_token"), rt = h.get("refresh_token"), exp = +h.get("expires_at") || 0;
    history.replaceState(null, "", location.pathname);
    const u = await api("/auth/v1/user", { headers: Object.assign(authHeaders(), { Authorization: "Bearer " + at }) });
    await saveSession({ access_token: at, refresh_token: rt, expires_at: exp ? exp * 1000 : Date.now() + 3600000, user: { id: u.id, email: u.email || "", meta: metaOf(u) } });
    return "ok";
  }
  async function resend(email) {
    await api("/auth/v1/resend?redirect_to=" + encodeURIComponent(location.origin + location.pathname), { method: "POST", headers: authHeaders(), body: JSON.stringify({ type: "signup", email }) });
  }
  const oauthUrl = (provider) => CFG.url + "/auth/v1/authorize?provider=" + provider + "&redirect_to=" + encodeURIComponent(location.origin + location.pathname);

  // ---------- data: one table "records" (user_id, coll, id, data, deleted, updated_at) ----------
  async function rest(path, opt) {
    const t = await token();
    const headers = Object.assign({ apikey: CFG.key, Authorization: "Bearer " + t, "Content-Type": "application/json" }, (opt && opt.headers) || {});
    try { return await api("/rest/v1/" + path, Object.assign({}, opt, { headers })); }
    catch (e) { if (e.status === 401 && !(opt && opt._retry)) { await refresh(); return rest(path, Object.assign({}, opt, { _retry: true })); } throw e; }
  }
  async function pullAll() {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const part = await rest("records?select=coll,id,data,deleted&order=coll,id", { headers: { Range: from + "-" + (from + 999), "Range-Unit": "items" } });
      rows.push(...(part || []));
      if (!part || part.length < 1000) break;
    }
    const out = Object.fromEntries(DATA.map(c => [c, []]));
    const dead = Object.fromEntries(DATA.map(c => [c, new Set()]));
    rows.forEach(r => { if (!out[r.coll]) return; if (r.deleted) dead[r.coll].add(r.id); else out[r.coll].push(Object.assign({}, r.data, { id: r.id })); });
    return { data: out, dead };
  }
  async function upsert(rows) {
    for (let i = 0; i < rows.length; i += 200) {
      await rest("records?on_conflict=user_id,coll,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 200)) });
    }
  }
  const canon = (o) => JSON.stringify(Object.keys(o).filter(k => k !== "_t").sort().reduce((m, k) => (m[k] = o[k], m), {}));

  let running = null, timer = null, lastErr = "";
  async function syncNow(manual) {
    if (!ready || !session) return;
    if (running) return running;
    running = (async () => {
      if (!navigator.onLine) { setState("Нет интернета — синхронизирую, когда появится."); return; }
      setState("Синхронизирую…");
      try {
        const local = Object.fromEntries(await Promise.all(DATA.map(async c => [c, await K.all(c)])));
        const remote = await pullAll();
        const base = await K.get("meta", "cloudBase");
        const baseIds = base && base.user === session.user.id ? base.ids : null;
        const merged = S.merge(local, remote.data, baseIds);
        // send what differs from the cloud; mark as deleted what the cloud has but the merge dropped
        const rows = [], uid = session.user.id;
        DATA.forEach(c => {
          const R = new Map(remote.data[c].map(r => [r.id, r]));
          const M = new Set(merged[c].map(r => r.id));
          merged[c].forEach(r => { const o = R.get(r.id); if (!o || canon(o) !== canon(r)) { const d = Object.assign({}, r); delete d.id; rows.push({ user_id: uid, coll: c, id: r.id, data: d, deleted: false }); } });
          remote.data[c].forEach(r => { if (!M.has(r.id)) rows.push({ user_id: uid, coll: c, id: r.id, data: {}, deleted: true }); });
        });
        if (rows.length) await upsert(rows);
        if (!S.sameData(merged, local)) { await K.replaceData(merged); await Promise.all(DATA.map(K.emit)); }
        const t = Date.now();
        await K.put("meta", { key: "cloudBase", t, user: uid, ids: Object.fromEntries(DATA.map(c => [c, merged[c].map(r => r.id)])) });
        lastErr = "";
        setState("Синхронизировано: " + fmt.format(new Date(t)));
      } catch (e) {
        lastErr = e.code === "network" ? "Нет связи с сервером. Если интернет есть — возможно, сервер заблокирован." : e.status === 401 || e.status === 403 ? "Вход устарел — войди заново." : "Не получилось синхронизировать: " + e.message;
        if (e.status === 401) await saveSession(null);
        setState(lastErr, true);
      }
    })();
    try { await running; } finally { running = null; }
  }
  // changes on the phone → sync a few seconds later (replaces the GitHub sync in the beta)
  window.__syncSoon = () => { clearTimeout(timer); timer = setTimeout(() => syncNow(false), 4000); };

  // ---------- Telegram / phone sign-in through the bot ----------
  // The app makes a one-time code, opens the bot with it, and asks the tg-auth function until the bot confirms.
  const FN = () => CFG.url + "/functions/v1/tg-auth";
  let tgPend = null, tgTimer = null;
  const randCode = () => { const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", r = new Uint8Array(32); crypto.getRandomValues(r); return [...r].map(x => a[x % a.length]).join(""); };
  const tgLink = (p) => "https://t.me/" + (CFG.tgBot || "") + "?start=login_" + p.code + (p.mode === "phone" ? "_p" : "");
  // on a phone go straight into the Telegram app (tg://): a t.me link from the installed app opens an
  // in-app browser that stays white after the hand-off and has to be closed with «Готово»
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const tgApp = (p) => "tg://resolve?domain=" + (CFG.tgBot || "") + "&start=login_" + p.code + (p.mode === "phone" ? "_p" : "");
  function openTg(p) {
    if (!mobile) { const w = window.open(tgLink(p), "_blank"); if (!w) location.href = tgLink(p); return; }
    location.href = tgApp(p);   // no Telegram app → the wait window has a web link
  }
  function waitUi(on) {
    const sh = $("acc-bg"); if (!sh) return;
    $("acc-wait").hidden = !on;
    if (on) { $("acc-out").hidden = true; $("acc-in").hidden = true; sh.hidden = false; } else paint();
  }
  async function tgStart(mode, link) {
    if (!ready || !CFG.tgBot) return;
    tgPend = { code: randCode(), mode, link: !!link, t: Date.now() };
    // open Telegram right away, while the tap still counts (otherwise the browser may block it)
    openTg(tgPend);
    await K.put("meta", Object.assign({ key: "tgPending" }, tgPend));
    $("acc-wait-t").textContent = link ? "Привяжи Telegram" : mode === "phone" ? "Подтверди номер в Telegram" : "Подтверди вход в Telegram";
    $("acc-wait-n").textContent = "В боте @" + CFG.tgBot + " нажми «Войти в Колчан»" + (mode === "phone" ? ", потом «📱 Поделиться номером»" : "") + " и вернись сюда — дальше всё произойдёт само.";
    $("acc-wait-open").href = mobile ? tgApp(tgPend) : tgLink(tgPend);
    $("acc-wait-web").href = tgLink(tgPend); $("acc-wait-web").hidden = !mobile;
    $("acc-wait-err").hidden = true;
    waitUi(true);
    tgLoop();
  }
  async function tgStop(cancel) {
    clearTimeout(tgTimer); tgTimer = null; tgPend = null;
    await K.put("meta", { key: "tgPending", none: true });
    if (cancel) waitUi(false);
  }
  function tgLoop() { clearTimeout(tgTimer); tgTimer = setTimeout(tgPoll, 2500); }
  async function tgPoll() {
    const p = tgPend; if (!p) return;
    if (Date.now() - p.t > 10 * 60000) { $("acc-wait-err").textContent = "Время вышло. Нажми «Отмена» и начни вход заново."; $("acc-wait-err").hidden = false; await tgStop(false); return; }
    try {
      const headers = { "Content-Type": "application/json", apikey: CFG.key };
      if (p.link && session) headers.Authorization = "Bearer " + (await token());
      const r = await fetch(FN(), { method: "POST", headers, body: JSON.stringify({ action: "poll", code: p.code, link: p.link }), cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.status === 410) { $("acc-wait-err").textContent = "Время вышло. Нажми «Отмена» и начни вход заново."; $("acc-wait-err").hidden = false; await tgStop(false); return; }
      if (!r.ok) throw Object.assign(new Error(j.error || ("http " + r.status)), { status: r.status });
      if (j.pending) { tgLoop(); return; }
      if (j.linked && session) {
        session.user.meta = Object.assign({}, session.user.meta, metaOf({ user_metadata: j.user_metadata }));
        await saveSession(session); await tgStop(false); waitUi(false);
        $("acc-in-msg").textContent = "Telegram привязан — теперь можно входить и через него."; $("acc-in-msg").hidden = false;
        return;
      }
      if (j.session) {
        const fromGate = $("acc-bg").classList.contains("gate");
        await tgStop(false);
        await saveSession(fromAuth(j.session));
        $("acc-wait").hidden = true; paint();
        if (fromGate) $("acc-bg").hidden = true;
        syncNow(true);
        return;
      }
      tgLoop();
    } catch (e) {
      if (e.status === 409 || e.status === 401) { $("acc-wait-err").textContent = e.message; $("acc-wait-err").hidden = false; await tgStop(false); return; }
      tgLoop();   // нет сети или сервер не ответил — пробуем дальше
    }
  }

  // ---------- UI ----------
  const css = `
.acc-btn { font-weight: 600; }
.acc-tabs { display: flex; gap: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 4px; }
.acc-tabs button { flex: 1; border: 0; background: none; padding: 10px; border-radius: 9px; font-weight: 600; color: var(--muted); }
.acc-tabs button.on { background: var(--accent); color: var(--accent-ink); }
.acc-or { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; }
.acc-or::before, .acc-or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.acc-prov { display: flex; flex-direction: column; gap: 8px; }
.acc-prov button { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px; font-weight: 600; }
.acc-prov button[disabled] { position: relative; overflow: hidden; opacity: 1; cursor: default; }
.acc-prov button[disabled] .pl { opacity: .35; }
/* «скоро»: чёрно-жёлтая лента наискосок через кнопку */
.acc-prov button[disabled] { align-items: flex-start; padding-top: 5px; padding-bottom: 19px; }
.acc-prov .soon { position: absolute; left: -6%; right: -6%; top: 77%; height: 16px; transform: translateY(-50%) rotate(-3deg);
  background: repeating-linear-gradient(45deg, #151515 0 9px, #f5c400 9px 18px); box-shadow: 0 1px 3px rgba(0,0,0,.35);
  display: flex; align-items: center; justify-content: center; pointer-events: none; }
.acc-prov .soon b { background: #151515; color: #f5c400; font: 700 10px/16px system-ui, sans-serif; letter-spacing: .18em; padding: 0 10px 0 12px; }
.acc-me { display: flex; align-items: center; gap: 12px; }
.acc-ava { width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; font-weight: 700; font-size: 18px; flex: none; }
.acc-me b { display: block; overflow-wrap: anywhere; }
/* beta: the app starts with sign-in / sign-up — a full-screen gate until there is a session */
.sheet-bg.gate { z-index: 100; background: var(--bg); align-items: center !important; justify-content: center; overflow-y: auto; }
.sheet-bg.gate .sheet { box-shadow: none; border: 0; max-width: 440px; width: 100%; max-height: none; margin: auto; padding-top: calc(env(safe-area-inset-top, 0px) + 24px); animation: none; }
.gate-head { display: none; text-align: center; margin-bottom: 18px; }
.sheet-bg.gate .gate-head { display: block; }
.sheet-bg.gate .sheet > h2, .sheet-bg.gate #acc-out > .note:first-child { display: none; }
.gate-head .logo { font-family: var(--font-display); font-size: 34px; font-weight: 700; }
.gate-head p { color: var(--muted); margin: 8px 0 0; }
.cloud-sync { border: 1px solid var(--line); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.cloud-sync .cs-t { font-weight: 600; }
.beta-tag { font-size: 11px; font-weight: 700; letter-spacing: .06em; color: var(--accent-ink); background: var(--accent); border-radius: 6px; padding: 2px 6px; margin-left: 6px; vertical-align: middle; }
`;
  let mode = "in";
  // sync status lives in «Данные»; a problem marks that menu item (and the avatar) with ⚠
  function setState(text, bad) { const el = $("acc-state"); if (el) { el.textContent = text || ""; el.className = bad ? "err" : "note"; } const b = $("data-open"); if (b) b.textContent = bad ? "Данные ⚠" : "Данные"; }
  window.__kolchanAccount = () => (session ? { email: shownName(session.user) } : null);
  // no session in the beta → the sign-in screen covers the app and cannot be closed
  function gate() {
    const sh = $("acc-bg"); if (!sh || !ready) return;
    const on = !session;
    sh.classList.toggle("gate", on);
    if (on) sh.hidden = false;
    $("acc-close").parentElement.parentElement.hidden = on;
  }
  function paint() {
    gate();
    if (window.__kolchanPaintAva) window.__kolchanPaintAva();
    const b = $("acc-open"); if (!b) return;
    b.textContent = session ? "Аккаунт" : "Войти";
    const cs = $("cloud-sync"); if (cs) cs.hidden = !session;
    $("acc-out").hidden = !!session; $("acc-in").hidden = !session;
    if ($("acc-wait") && !$("acc-wait").hidden) { $("acc-out").hidden = true; $("acc-in").hidden = true; }
    if (session) {
      const u = session.user, m = u.meta || {}, nm = shownName(u);
      $("acc-mail").textContent = nm; $("acc-ava").textContent = (nm[0] || "?").toUpperCase();
      const lines = [realEmail(u.email) && realEmail(u.email) !== nm ? "✉️ " + realEmail(u.email) : "", m.phone ? "📱 " + m.phone : "", m.tg_id ? "✈️ Telegram" + (m.tg_username ? " @" + m.tg_username : "") : ""].filter(Boolean);
      $("acc-ids").textContent = lines.join("\n"); $("acc-ids").hidden = !lines.length;
      $("acc-link-tg").hidden = !!m.tg_id || !(CFG.providers || []).includes("telegram");
    }
    $("acc-tab-in").classList.toggle("on", mode === "in"); $("acc-tab-up").classList.toggle("on", mode === "up");
    $("acc-go").textContent = mode === "in" ? "Войти" : "Зарегистрироваться";
    $("acc-pass").autocomplete = mode === "in" ? "current-password" : "new-password";
    $("acc-pass2-wrap").hidden = mode !== "up";
    const nt = document.querySelector("#data-bg .notice");
    if (nt) nt.textContent = session
      ? "База хранится онлайн в твоём аккаунте и на этом телефоне — с любого устройства после входа будет одно и то же. «Выгрузить файл» — дополнительная копия на всякий случай."
      : "Пока ты не вошёл, база хранится только на этом телефоне. Войди в аккаунт, чтобы она хранилась онлайн, или время от времени нажимай «Выгрузить файл».";
  }
  function err(t) { const e = $("acc-err"); e.textContent = t || ""; e.hidden = !t; }
  const ruErr = (e) => {
    const m = (e.message || "").toLowerCase(), c = e.code || "";
    if (e.code === "network") return "Нет связи с сервером. Проверь интернет; если он есть — сервер может быть заблокирован, попробуй с VPN.";
    if (c === "invalid_credentials" || m.includes("invalid login")) return "Неверная почта или пароль.";
    if (c === "user_already_exists" || m.includes("already registered")) return "Эта почта уже зарегистрирована — войди.";
    if (c === "weak_password" || m.includes("password should be")) return "Пароль слишком простой: нужно минимум 6 символов.";
    if (c === "email_not_confirmed" || m.includes("not confirmed")) return "Почта не подтверждена — открой письмо и нажми ссылку.";
    if (c === "over_email_send_rate_limit" || m.includes("rate limit")) return "Слишком много попыток. Подожди немного.";
    if (c === "validation_failed" || m.includes("invalid format") || m.includes("unable to validate email")) return "Проверь адрес почты.";
    return "Не получилось: " + e.message;
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const h1 = document.querySelector("header h1"); if (h1) { const t = document.createElement("span"); t.className = "beta-tag"; t.textContent = "β"; h1.appendChild(t); }
    const sbox = $("s-box"); if (sbox) sbox.hidden = true;   // GitHub sync is replaced by the account in the beta
    const dataBtn = $("data-open");
    const ab = document.createElement("button"); ab.type = "button"; ab.className = "link acc-btn"; ab.id = "acc-open"; ab.textContent = "Войти";
    dataBtn.parentElement.insertBefore(ab, dataBtn);
    const sh = document.createElement("div"); sh.className = "sheet-bg"; sh.id = "acc-bg"; sh.hidden = true;
    const prov = (CFG.providers || []);
    const pbtn = (id, label, icon) => prov.includes(id)
      ? '<button type="button" data-p="' + id + '">' + icon + label + "</button>"
      : '<button type="button" data-p="' + id + '" disabled aria-label="' + label + ' — скоро"><span class="pl">' + icon + label + '</span><span class="soon"><b>SOON</b></span></button>';
    sh.innerHTML = '<div class="sheet"><div class="gate-head"><div class="logo">Колчан <span class="beta-tag">β</span></div><p>Войди или зарегистрируйся — база будет храниться онлайн и одинаково на всех твоих устройствах.</p></div><h2>Аккаунт</h2>' +
      '<div id="acc-out">' +
        '<div class="note" style="margin-bottom:12px">Войди, чтобы база хранилась онлайн и была одинаковой на всех устройствах. Без входа всё работает как раньше — только на этом телефоне.</div>' +
        '<div class="acc-tabs"><button type="button" id="acc-tab-in">Вход</button><button type="button" id="acc-tab-up">Регистрация</button></div>' +
        '<form id="acc-form" novalidate style="display:flex;flex-direction:column;gap:12px;margin-top:12px">' +
          '<label>Почта<input id="acc-mail-in" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com"></label>' +
          '<label>Пароль<input id="acc-pass" type="password" placeholder="минимум 6 символов"></label>' +
          '<label id="acc-pass2-wrap" hidden>Пароль ещё раз<input id="acc-pass2" type="password" autocomplete="new-password"></label>' +
          '<div class="err" id="acc-err" hidden></div>' +
          '<button type="button" class="link" id="acc-resend" hidden>Отправить письмо ещё раз</button>' +
          '<button type="submit" class="primary" id="acc-go">Войти</button>' +
        '</form>' +
        '<div class="acc-or" style="margin:14px 0">или</div>' +
        '<div class="acc-prov">' + pbtn("telegram", "Войти через Telegram", "✈️ ") + pbtn("google", "Google", "G ") + pbtn("yandex", "Яндекс ID", "Я ") + '</div>' +
      '</div>' +
      '<div id="acc-in" hidden style="display:flex;flex-direction:column;gap:12px">' +
        '<div class="acc-me"><div class="acc-ava" id="acc-ava"></div><div><b id="acc-mail"></b><span class="note">База хранится онлайн и на этом телефоне</span></div></div>' +
        '<div class="note" id="acc-ids" hidden style="white-space:pre-line"></div>' +
        '<button type="button" id="acc-link-tg" hidden>✈️ Привязать Telegram</button>' +
        '<div class="ok" id="acc-in-msg" hidden></div>' +

        '<div class="confirm" id="acc-logout-confirm" hidden><span>Выйти из аккаунта? Данные останутся в облаке, а с этого телефона будут убраны — при следующем входе вернутся.</span><div class="row2"><button type="button" id="acc-logout-no">Отмена</button><button type="button" class="danger" id="acc-logout-yes">Выйти</button></div></div>' +
      '</div>' +
      '<div id="acc-wait" hidden style="display:flex;flex-direction:column;gap:12px;text-align:center">' +
        '<div style="font-size:40px">✈️</div><b id="acc-wait-t">Подтверди вход в Telegram</b>' +
        '<div class="note" id="acc-wait-n"></div>' +
        '<a class="primary" id="acc-wait-open" href="#" target="_blank" rel="noopener" style="display:block;text-decoration:none;padding:12px;border-radius:12px;background:var(--accent);color:var(--accent-ink);font-weight:600">Открыть Telegram</a>' +
        '<a id="acc-wait-web" href="#" target="_blank" rel="noopener" class="note" hidden>Нет приложения Telegram? Открыть в браузере</a>' +
        '<div class="err" id="acc-wait-err" hidden></div>' +
        '<button type="button" id="acc-wait-cancel">Отмена</button>' +
      '</div>' +
      '<div class="actions"><div class="right"><button type="button" id="acc-close">Закрыть</button></div></div></div>';
    document.body.appendChild(sh);
    $("acc-out").style.display = "";
    const open = () => { err(""); paint(); sh.hidden = false; };
    ab.onclick = open;
    $("acc-close").onclick = () => { sh.hidden = true; };
    sh.addEventListener("click", (e) => { if (e.target === sh && !sh.classList.contains("gate")) sh.hidden = true; });
    $("acc-tab-in").onclick = () => { mode = "in"; err(""); paint(); };
    $("acc-tab-up").onclick = () => { mode = "up"; err(""); paint(); };
    sh.querySelectorAll("[data-p]").forEach(b => b.onclick = () => {
      if (b.disabled) return;
      if (b.dataset.p === "telegram" || b.dataset.p === "phone") tgStart(b.dataset.p === "phone" ? "phone" : "tg", false);
      else location.href = oauthUrl(b.dataset.p);
    });
    $("acc-link-tg").onclick = () => tgStart("tg", true);
    $("acc-wait-cancel").onclick = () => tgStop(true);
    $("acc-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!ready) { err("Сервер ещё не настроен."); return; }
      const email = $("acc-mail-in").value.trim(), pass = $("acc-pass").value;
      if (!/^\S+@\S+\.\S+$/.test(email)) { err("Проверь адрес почты."); return; }
      if (pass.length < 6) { err("Пароль — минимум 6 символов."); return; }
      if (mode === "up" && pass !== $("acc-pass2").value) { err("Пароли не совпадают."); return; }
      const go = $("acc-go"); go.disabled = true; err("");
      const fromGate = sh.classList.contains("gate");
      try {
        if (mode === "up") { const r = await signUp(email, pass); if (r === "confirm") { err(""); $("acc-err").className = "ok"; $("acc-err").textContent = "Почти готово: открой письмо на " + email + " и нажми ссылку — вернёшься сюда уже в аккаунте."; $("acc-err").hidden = false; return; } }
        else await signIn(email, pass);
        $("acc-pass").value = ""; $("acc-pass2").value = "";
        paint(); if (fromGate) sh.hidden = true; syncNow(true);
      } catch (ex) {
        $("acc-err").className = "err"; err(ruErr(ex));
        if ((ex.code || "") === "email_not_confirmed" || /not confirmed/i.test(ex.message || "")) $("acc-resend").hidden = false;
      }
      finally { go.disabled = false; }
    });
    $("acc-resend").onclick = async () => {
      const email = $("acc-mail-in").value.trim();
      try { await resend(email); $("acc-err").className = "ok"; $("acc-err").textContent = "Отправил письмо на " + email + ". Открой его и нажми ссылку — вернёшься сюда уже в аккаунте."; $("acc-err").hidden = false; $("acc-resend").hidden = true; }
      catch (ex) { $("acc-err").className = "err"; err(ruErr(ex)); }
    };
    // «Синхронизация» block in «Данные»: last sync time and a button
    const dsheet = document.querySelector("#data-bg .sheet");
    if (dsheet) {
      const box = document.createElement("div"); box.id = "cloud-sync"; box.className = "cloud-sync"; box.hidden = true;
      box.innerHTML = '<div class="cs-t">Синхронизация с аккаунтом</div><div class="note" id="acc-state"></div><button type="button" id="acc-sync">Синхронизировать сейчас</button>';
      const btns = dsheet.querySelector(".dataBtns"); dsheet.insertBefore(box, btns);
    }
    $("acc-sync").onclick = () => syncNow(true);
    // «Выйти» in the avatar menu opens the account window with the confirmation
    window.__kolchanLogout = () => { err(""); paint(); sh.hidden = false; $("acc-logout-confirm").hidden = false; };
    $("acc-logout-no").onclick = () => { $("acc-logout-confirm").hidden = true; };
    $("acc-logout-yes").onclick = async () => {
      await syncNow(true);
      await signOut();
      await K.replaceData(Object.fromEntries(DATA.map(c => [c, []]))); await Promise.all(DATA.map(K.emit));
      await K.put("meta", { key: "cloudBase", none: true });
      $("acc-logout-confirm").hidden = true; setState(""); paint();
    };

    const s = await K.get("meta", "cloudSession");
    session = s && s.access_token ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, user: s.user } : null;
    paint();
    if (ready) {
      try { const r = await takeRedirect(); if (r && r !== "ok") { open(); err(r); } else if (r === "ok") open(); } catch (e) { open(); err(ruErr(e)); }
      if (session) {
        const base = await K.get("meta", "cloudBase");
        setState(base && base.t ? "Синхронизировано: " + fmt.format(new Date(base.t)) : "");
        syncNow(false);
      }
    }
    const tp = await K.get("meta", "tgPending");
    if (ready && tp && tp.code && Date.now() - tp.t < 10 * 60000) {
      tgPend = { code: tp.code, mode: tp.mode, link: tp.link, t: tp.t };
      $("acc-wait-open").href = mobile ? tgApp(tgPend) : tgLink(tgPend); $("acc-wait-web").href = tgLink(tgPend); $("acc-wait-web").hidden = !mobile; $("acc-wait-t").textContent = "Жду подтверждения из Telegram"; $("acc-wait-n").textContent = "Если уже нажал «Войти в Колчан» в боте — вход выполнится через пару секунд.";
      waitUi(true); tgPoll();
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { syncNow(false); if (tgPend) tgPoll(); } });
    window.addEventListener("online", () => syncNow(false));
  });
})();
