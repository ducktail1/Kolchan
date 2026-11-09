// Колчан: local storage layer. Gives the page the same db / assets interface it uses
// inside Claude, but keeps everything in this phone's IndexedDB.
(function () {
  "use strict";
  const DB_NAME = "kolchan-beta", DB_VER = 2;
  const STORES = ["places", "bags", "items", "photos", "meta", "quivers"];
  const DATA = ["places", "bags", "items", "quivers"];

  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  // IndexedDB, with an in-memory fallback when the browser blocks it
  // (some embedded views and private modes): the app still works, data lives until reload.
  const mem = Object.fromEntries(STORES.map(s => [s, new Map()]));
  const keyOf = (s, o) => s === "meta" ? o.key : o.id;
  const PREVIEW = !!window.__KOLCHAN_PREVIEW;
  if (PREVIEW) { try { indexedDB.deleteDatabase(DB_NAME); } catch (e) {} }
  // test bench: every open starts from a fresh copy of the given base (kept in memory only)
  const SEED = PREVIEW && window.__KOLCHAN_SEED;
  if (SEED) DATA.forEach(c => (SEED[c] || []).forEach(o => { if (o && o.id) mem[c].set(o.id, Object.assign({}, o)); }));
  const dbp = PREVIEW ? Promise.resolve(null) : new Promise((res) => {
    let settled = false;
    const fin = (v) => { if (!settled) { settled = true; res(v); } };
    setTimeout(() => fin(null), 2000);
    try {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === "meta" ? "key" : "id" }); });
      };
      r.onsuccess = async () => {
        const d = r.result;
        try { const t = d.transaction("meta", "readwrite"); t.objectStore("meta").put({ key: "probe", t: Date.now() }); await done(t); fin(d); }
        catch (e) { fin(null); }
      };
      r.onerror = () => fin(null);
      r.onblocked = () => fin(null);
    } catch (e) { fin(null); }
  });
  dbp.then(d => { window.__kolchanMemory = !d && !PREVIEW; });
  async function all(s) { const d = await dbp; if (!d) return [...mem[s].values()]; return req(d.transaction(s).objectStore(s).getAll()); }
  async function get(s, k) { const d = await dbp; if (!d) return mem[s].get(k); return req(d.transaction(s).objectStore(s).get(k)); }
  async function put(s, o) { const d = await dbp; if (!d) { mem[s].set(keyOf(s, o), o); return; } const t = d.transaction(s, "readwrite"); t.objectStore(s).put(o); await done(t); }
  async function del(s, k) { const d = await dbp; if (!d) { mem[s].delete(k); return; } const t = d.transaction(s, "readwrite"); t.objectStore(s).delete(k); await done(t); }
  async function replaceAll(data) {
    const d = await dbp;
    if (!d) {
      DATA.concat("photos").forEach(s => mem[s].clear());
      DATA.forEach(s => (data[s] || []).forEach(o => { if (o && o.id) mem[s].set(o.id, o); }));
      (data.photos || []).forEach(o => mem.photos.set(o.id, o));
      return;
    }
    const t = d.transaction(DATA.concat("photos"), "readwrite");
    DATA.concat("photos").forEach(s => t.objectStore(s).clear());
    DATA.forEach(s => (data[s] || []).forEach(o => { if (o && o.id) t.objectStore(s).put(o); }));
    (data.photos || []).forEach(o => t.objectStore("photos").put(o));
    await done(t);
  }
  async function replaceData(data) {
    const d = await dbp;
    if (!d) { DATA.forEach(s => { mem[s].clear(); (data[s] || []).forEach(o => { if (o && o.id) mem[s].set(o.id, o); }); }); return; }
    const t = d.transaction(DATA, "readwrite");
    DATA.forEach(s => { t.objectStore(s).clear(); (data[s] || []).forEach(o => { if (o && o.id) t.objectStore(s).put(o); }); });
    await done(t);
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // photos → object URLs
  const urls = new Map();
  const ready = (async () => {
    for (const p of await all("photos")) if (p.blob) urls.set(p.id, URL.createObjectURL(p.blob));
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  })();
  window.__photoSrc = (id) => urls.get(id) || "";

  // db: collection(name).orderBy(f).onSnapshot(cb) / .doc(id).set(d) / .delete()
  const listeners = { places: [], bags: [], items: [], quivers: [] };
  async function emit(name) {
    const rows = await all(name);
    listeners[name].forEach(({ cb, field }) => {
      const sorted = field ? rows.slice().sort((a, b) => (a[field] || 0) - (b[field] || 0)) : rows;
      cb({ docs: sorted.map(r => { const v = Object.assign({}, r); delete v.id; return { id: r.id, data: () => v }; }), metadata: { fromCache: false } });
    });
  }
  const db = {
    collection(name) {
      let field = null;
      const q = {
        orderBy(f) { field = f; return q; },
        onSnapshot(cb, onErr) { const l = { cb, field }; listeners[name].push(l); emit(name).catch(e => onErr && onErr(e)); return () => { listeners[name] = listeners[name].filter(x => x !== l); }; },
        doc(id) {
          const docId = id || uid();
          return {
            id: docId,
            async set(d) { await put(name, Object.assign({}, d, { id: docId, _t: Date.now() })); await emit(name); syncSoon(); },
            async delete() { await del(name, docId); await emit(name); syncSoon(); }
          };
        }
      };
      return q;
    }
  };
  const assets = {
    async upload(blob) { const id = uid(); await put("photos", { id, blob, type: blob.type || "image/jpeg" }); urls.set(id, URL.createObjectURL(blob)); return { id, url: urls.get(id) }; },
    async delete(id) { await del("photos", id); const u = urls.get(id); if (u) URL.revokeObjectURL(u); urls.delete(id); }
  };
  window.__kolchan = { all, get, put, replaceData, emit };
  function syncSoon() { if (window.__syncSoon) window.__syncSoon(); }
  window.__store = { use: async (n) => { await ready; return n === "db" ? db : n === "assets" ? assets : null; } };
  try { window.claude = window.__store; } catch (e) {}

  // ---------- data sheet: export / import ----------
  const $ = (id) => document.getElementById(id);
  const fmtDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const plural = (n, f) => { const a = n % 10, b = n % 100; return f[(a === 1 && b !== 11) ? 0 : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? 1 : 2]; };
  const toDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  function msg(text, ok) { const m = $("d-msg"); m.className = ok ? "ok" : "err"; m.textContent = text; m.hidden = !text; }
  async function refresh() {
    const [p, b, i] = await Promise.all(DATA.map(all));
    $("d-stat").textContent = "В базе " + i.length + " " + plural(i.length, ["вещь", "вещи", "вещей"]) + ", " + b.length + " " + plural(b.length, ["сумка", "сумки", "сумок"]) + ", " + p.length + " " + plural(p.length, ["место", "места", "мест"]) + ".";
    const last = await get("meta", "lastExport");
    $("d-last").textContent = last ? "Последняя выгрузка: " + fmtDay.format(new Date(last.t)) + "." : "Выгрузки ещё не было.";
  }
  let pending = null;
  document.addEventListener("DOMContentLoaded", () => {
    $("data-open").onclick = async () => { msg(""); $("d-confirm").hidden = true; await refresh(); $("data-bg").hidden = false; };
    $("d-close").onclick = () => { $("data-bg").hidden = true; };
    $("data-bg").addEventListener("click", (e) => { if (e.target === $("data-bg")) $("data-bg").hidden = true; });
    $("d-export").onclick = async () => {
      const [places, bags, items, quivers] = await Promise.all(DATA.map(all));
      const photos = [];
      for (const p of await all("photos")) { try { photos.push({ id: p.id, type: p.type, data: await toDataUrl(p.blob) }); } catch (e) {} }
      const t = Date.now(), d = new Date(t), pad = (n) => String(n).padStart(2, "0");
      const fname = "kolchan-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + ".json";
      const file = new File([JSON.stringify(Object.assign({ app: "kolchan", version: 1, exportedAt: t, places, bags, items }, quivers.length ? { quivers } : {}, { photos }))], fname, { type: "application/json" });
      let shared = false;
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Колчан" }); shared = true; } }
      catch (e) { if (e && e.name === "AbortError") return; }
      if (!shared) { const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); }
      await put("meta", { key: "lastExport", t });
      await refresh();
      msg("Файл " + fname + " готов. Сохрани его в «Файлы» или отправь в чат Claude.", true);
    };
    $("d-import").addEventListener("change", async (e) => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      msg("");
      try {
        const data = JSON.parse(await f.text());
        if (!data || !Array.isArray(data.items) || !Array.isArray(data.bags) || !Array.isArray(data.places)) throw new Error("bad");
        pending = data;
        $("d-confirm-text").textContent = "В файле " + data.items.length + " " + plural(data.items.length, ["вещь", "вещи", "вещей"]) + ", " + data.bags.length + " " + plural(data.bags.length, ["сумка", "сумки", "сумок"]) + ", " + data.places.length + " " + plural(data.places.length, ["место", "места", "мест"]) + ". Текущая база на телефоне будет заменена.";
        $("d-confirm").hidden = false;
      } catch (ex) { msg("Это не файл базы. Выбери .json, который выгрузил Колчан или прислал Claude.", false); }
    });
    $("d-confirm-no").onclick = () => { pending = null; $("d-confirm").hidden = true; };
    $("d-confirm-yes").onclick = async () => {
      if (!pending) return;
      const data = pending; pending = null;
      const photos = [];
      for (const p of data.photos || []) { try { photos.push({ id: p.id, type: p.type, blob: await (await fetch(p.data)).blob() }); } catch (e) {} }
      await replaceAll(Object.assign({}, data, { photos }));
      location.reload();
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  });
})();


// ---------- sync with a private GitHub repo (data.json) ----------
(function () {
  "use strict";
  const DATA = ["places", "bags", "items", "quivers"];
  const $ = (id) => document.getElementById(id);
  const K = window.__kolchan;
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const stamp = (r) => Math.max(r._t || 0, r.updatedAt || 0, ...((r.log || []).map(x => x.t || 0)));
  function mergeLog(a, b) {
    const m = new Map();
    [...(a || []), ...(b || [])].forEach(x => m.set([x.t, x.kind || "", x.to || "", x.from || "", x.note || ""].join("|"), x));
    return [...m.values()].sort((x, y) => (x.t || 0) - (y.t || 0)).slice(-80);
  }
  function mergeRec(l, r) {
    const out = Object.assign({}, stamp(l) >= stamp(r) ? l : r);
    if (l.log || r.log) out.log = mergeLog(l.log, r.log);
    // trip expenses: two people can add or edit at the same time — keep both; deleted ones stay deleted
    if (l.exp || r.exp || l.expDel || r.expDel) {
      const del = [...new Set([...(l.expDel || []), ...(r.expDel || [])])].slice(-500), D = new Set(del), m = new Map();
      [...(l.exp || []), ...(r.exp || [])].forEach(e => {
        if (!e || !e.id || D.has(e.id)) return;
        const o = m.get(e.id); if (!o || (e.u || e.t || 0) > (o.u || o.t || 0)) m.set(e.id, e);
      });
      out.exp = [...m.values()].sort((a, b) => (a.t || 0) - (b.t || 0));
      if (del.length) out.expDel = del; else delete out.expDel;
    }
    return out;
  }
  // three-way merge: base = ids that existed at the last successful sync (to tell "deleted" from "new")
  function merge(local, remote, base) {
    const out = {};
    DATA.forEach(c => {
      const L = new Map((local[c] || []).map(r => [r.id, r]));
      const R = new Map((remote[c] || []).map(r => [r.id, r]));
      const B = new Set((base && base[c]) || []);
      const ids = new Set([...L.keys(), ...R.keys()]);
      out[c] = [];
      ids.forEach(id => {
        const l = L.get(id), r = R.get(id);
        if (l && r) out[c].push(mergeRec(l, r));
        else if (l && !(B.has(id))) out[c].push(l);          // new here
        else if (r && !(B.has(id))) out[c].push(r);          // new there
        // in base but missing on one side = deleted there → drop
      });
    });
    return out;
  }
  function serialize(d) {
    const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
    const order = { places: byOrder, bags: byOrder, quivers: byOrder, items: (a, b) => a.id < b.id ? -1 : 1 };
    const keySort = (o) => JSON.stringify(Object.keys(o).sort().reduce((m, k) => (m[k] = o[k], m), {}));
    const lines = ["{", '"app": "kolchan", "version": 1, "exportedAt": ' + Date.now() + ","];
    DATA.forEach(c => { if (c === "quivers" && !(d[c] || []).length) return; lines.push('"' + c + '": ['); lines.push((d[c] || []).slice().sort(order[c]).map(keySort).join(",\n")); lines.push("],"); });
    lines.push('"photos": []', "}");
    return lines.join("\n") + "\n";
  }
  const canon = (arr) => (arr || []).map(o => JSON.stringify(Object.keys(o).sort().reduce((m, k) => (m[k] = o[k], m), {}))).sort().join("\n");
  const sameData = (a, b) => DATA.every(c => canon(a[c]) === canon(b[c]));
  const b64enc = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), ch => ch.charCodeAt(0)));

  async function gh(cfg, method, body) {
    const url = "https://api.github.com/repos/" + cfg.repo + "/contents/data.json";
    const r = await fetch(url + (method === "GET" ? "?ref=main&t=" + Date.now() : ""), {
      method, headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body ? JSON.stringify(body) : undefined, cache: "no-store"
    });
    if (r.status === 404 && method === "GET") return null;
    if (!r.ok) { const e = new Error("http " + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function pull(cfg) {
    const j = await gh(cfg, "GET");
    if (!j) return { data: { places: [], bags: [], items: [], quivers: [] }, sha: null };
    let text = j.content ? b64dec(j.content) : "";
    if (!text && j.download_url) text = await (await fetch(j.download_url, { headers: { Authorization: "Bearer " + cfg.token } })).text();
    return { data: JSON.parse(text), sha: j.sha };
  }

  let running = null, timer = null;
  function setState(text, bad) { const el = $("s-state"); if (el) { el.textContent = text; el.className = bad ? "err" : "note"; } const b = $("data-open"); if (b) b.textContent = bad ? "Данные ⚠" : "Данные"; }
  async function cfgGet() { return (await K.get("meta", "sync")) || null; }

  async function syncNow(manual) {
    if (running) return running;
    running = (async () => {
      const cfg = await cfgGet();
      if (!cfg || !cfg.token) { if (manual) setState("Сначала вставь токен GitHub.", true); return; }
      if (!navigator.onLine) { setState("Нет интернета — синхронизирую, когда появится."); return; }
      setState("Синхронизирую…");
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const local = Object.fromEntries(await Promise.all(DATA.map(async c => [c, await K.all(c)])));
          const remote = await pull(cfg);
          const base = (await K.get("meta", "syncBase")) || null;
          const merged = merge(local, remote.data, base && base.ids);
          if (!sameData(merged, remote.data)) {
            await gh(cfg, "PUT", { message: "Синхронизация с телефона " + new Date().toLocaleString("ru-RU"), content: b64enc(serialize(merged)), sha: remote.sha || undefined, branch: "main" });
          }
          if (!sameData(merged, local)) { await K.replaceData(merged); await Promise.all(DATA.map(K.emit)); }
          const t = Date.now();
          await K.put("meta", { key: "syncBase", t, ids: Object.fromEntries(DATA.map(c => [c, merged[c].map(r => r.id)])) });
          setState("Синхронизировано: " + fmt.format(new Date(t)));
          return;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && attempt === 0) continue;   // someone wrote in between: pull again and retry
          setState(e.status === 401 ? "Токен не подходит или истёк. Вставь новый." : e.status === 404 || e.status === 403 ? "Нет доступа к репозиторию. Проверь название и права токена." : "Не получилось синхронизировать. Попробую позже.", true);
          return;
        }
      }
    })();
    try { await running; } finally { running = null; }
  }
  window.__syncSoon = () => { clearTimeout(timer); timer = setTimeout(() => syncNow(false), 8000); };
  window.__kolchanSync = { merge, sameData, DATA };

  document.addEventListener("DOMContentLoaded", async () => {
    const cfg = await cfgGet();
    if ($("s-repo")) $("s-repo").value = (cfg && cfg.repo) || "";
    if ($("s-box") && cfg && cfg.token) $("s-box").open = true;
    if ($("s-token") && cfg && cfg.token) $("s-token").placeholder = "токен сохранён";
    const base = await K.get("meta", "syncBase");
    setState(cfg && cfg.token ? (base ? "Синхронизировано: " + fmt.format(new Date(base.t)) : "Ещё не синхронизировалось.") : "Синхронизация выключена: нет токена.");
    if ($("s-save")) $("s-save").onclick = async () => {
      const token = $("s-token").value.trim() || (cfg && cfg.token) || "";
      const repo = $("s-repo").value.trim();
      if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { setState("Укажи репозиторий в виде логин/kolchan-data.", true); return; }
      await K.put("meta", { key: "sync", token, repo });
      $("s-token").value = ""; $("s-token").placeholder = token ? "токен сохранён" : "github_pat_…";
      syncNow(true);
    };
    if ($("s-now")) $("s-now").onclick = () => syncNow(true);
    syncNow(false);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(false); });
    window.addEventListener("online", () => syncNow(false));
  });
})();
