// Колчан: local storage layer. Gives the page the same db / assets interface it uses
// inside Claude, but keeps everything in this phone's IndexedDB.
(function () {
  "use strict";
  const DB_NAME = "kolchan", DB_VER = 1;
  const STORES = ["places", "bags", "items", "photos", "meta"];
  const DATA = ["places", "bags", "items"];

  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (t) => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === "meta" ? "key" : "id" }); });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  async function all(s) { const d = await dbp; return req(d.transaction(s).objectStore(s).getAll()); }
  async function get(s, k) { const d = await dbp; return req(d.transaction(s).objectStore(s).get(k)); }
  async function put(s, o) { const d = await dbp; const t = d.transaction(s, "readwrite"); t.objectStore(s).put(o); await done(t); }
  async function del(s, k) { const d = await dbp; const t = d.transaction(s, "readwrite"); t.objectStore(s).delete(k); await done(t); }
  async function replaceAll(data) {
    const d = await dbp;
    const t = d.transaction(["places", "bags", "items", "photos"], "readwrite");
    ["places", "bags", "items", "photos"].forEach(s => t.objectStore(s).clear());
    DATA.forEach(s => (data[s] || []).forEach(o => { if (o && o.id) t.objectStore(s).put(o); }));
    (data.photos || []).forEach(o => t.objectStore("photos").put(o));
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
  const listeners = { places: [], bags: [], items: [] };
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
            async set(d) { await put(name, Object.assign({}, d, { id: docId })); await emit(name); },
            async delete() { await del(name, docId); await emit(name); }
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
  window.claude = { use: async (n) => { await ready; return n === "db" ? db : n === "assets" ? assets : null; } };

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
      const [places, bags, items] = await Promise.all(DATA.map(all));
      const photos = [];
      for (const p of await all("photos")) { try { photos.push({ id: p.id, type: p.type, data: await toDataUrl(p.blob) }); } catch (e) {} }
      const t = Date.now(), d = new Date(t), pad = (n) => String(n).padStart(2, "0");
      const fname = "kolchan-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + ".json";
      const file = new File([JSON.stringify({ app: "kolchan", version: 1, exportedAt: t, places, bags, items, photos })], fname, { type: "application/json" });
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
