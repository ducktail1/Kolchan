// Колчан — Telegram-бот (Cloudflare Worker).
// Работает с той же базой, что и приложение: data.json в приватном репозитории GitHub.
//
// Секреты/переменные Worker (Settings → Variables and Secrets):
//   BOT_TOKEN      — токен бота от @BotFather                     (Secret)
//   GH_TOKEN       — токен GitHub с доступом Contents: Read and write
//                    только к репозиторию с базой                   (Secret)
//   REPO           — репозиторий с базой, например ducktail1/kolchan-data
//   OWNER_ID       — твой Telegram ID (бот подскажет его на /start)
//   HOOK_SECRET    — любая длинная строка из букв и цифр          (Secret)
//
// После сохранения открыть в браузере: https://<адрес-worker>/setup?key=<HOOK_SECRET>

const TRANSIT = "В пути";
const LOG_MAX = 80;
const DATA = ["places", "bags", "items"];
export const BOT_VERSION = "1.1.0";

// ---------- helpers ----------
const low = (s) => (s || "").toLowerCase().replace(/ё/g, "е");
const norm = (s) => (s || "").split("/").map((x) => x.trim()).filter(Boolean);
const pathStr = (parts) => parts.join(" / ");
const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const addLog = (log, e) => (Array.isArray(log) ? log : []).concat(e).slice(-LOG_MAX);
const words = (q) => low(q).split(/[\s,]+/).filter(Boolean);
const matches = (name, q) => { const n = low(name); const w = words(q); return w.length > 0 && w.every((x) => n.includes(x)); };

function plural(n, f) { const a = n % 10, b = n % 100; return f[(a === 1 && b !== 11) ? 0 : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? 1 : 2]; }
const nItems = (n) => n + " " + plural(n, ["вещь", "вещи", "вещей"]);

// ---------- GitHub storage (same format as the app) ----------
const b64enc = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const b64dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (ch) => ch.charCodeAt(0)));

export function serialize(d) {
  const order = { places: (a, b) => (a.order || 0) - (b.order || 0), bags: (a, b) => (a.order || 0) - (b.order || 0), items: (a, b) => (a.id < b.id ? -1 : 1) };
  const keySort = (o) => JSON.stringify(Object.keys(o).sort().reduce((m, k) => ((m[k] = o[k]), m), {}));
  const lines = ["{", '"app": "kolchan", "version": 1, "exportedAt": ' + Date.now() + ","];
  DATA.forEach((c) => { lines.push('"' + c + '": ['); lines.push((d[c] || []).slice().sort(order[c]).map(keySort).join(",\n")); lines.push("],"); });
  lines.push('"photos": []', "}");
  return lines.join("\n") + "\n";
}

async function gh(env, method, body) {
  const url = "https://api.github.com/repos/" + env.REPO + "/contents/data.json";
  const r = await fetch(url + (method === "GET" ? "?ref=main" : ""), {
    method,
    headers: { Authorization: "Bearer " + env.GH_TOKEN, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "kolchan-bot", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const e = new Error("GitHub " + r.status); e.status = r.status; throw e; }
  return r.json();
}
async function load(env) {
  const j = await gh(env, "GET");
  let text = j.content ? b64dec(j.content) : "";
  if (!text && j.download_url) text = await (await fetch(j.download_url, { headers: { Authorization: "Bearer " + env.GH_TOKEN, "User-Agent": "kolchan-bot" } })).text();
  const d = JSON.parse(text);
  DATA.forEach((c) => { d[c] = Array.isArray(d[c]) ? d[c] : []; });
  return { data: d, sha: j.sha };
}
async function save(env, data, sha, message) {
  await gh(env, "PUT", { message, content: b64enc(serialize(data)), sha, branch: "main" });
}

// ---------- model ----------
const bagById = (d, id) => d.bags.find((b) => b.id === id);
function bagWhere(b) { return (b.location || "место не указано") + (b.location === TRANSIT && b.dest ? " → " + b.dest : ""); }
function itemWhere(d, it) {
  const b = it.in && bagById(d, it.in);
  if (b) return "в «" + b.name + "» (" + bagWhere(b) + ")";
  return it.place || "место не указано";
}
function labelFor(d, dest) {
  if (dest.in) { const b = bagById(d, dest.in); return "в «" + (b ? b.name : "?") + "»" + (b && b.location ? " (" + b.location + ")" : ""); }
  return dest.place || "место не указано";
}
function ensurePlace(d, path) {
  const top = norm(path)[0];
  if (!top) return null;
  const ex = d.places.find((p) => low(p.name) === low(top));
  if (ex) return ex;
  const order = d.places.reduce((m, p) => Math.max(m, p.order || 0), 0) + 10;
  const p = { id: uid(), name: top, order, _t: Date.now() };
  d.places.push(p);
  return p;
}
// every known loose place path
function allPaths(d) {
  const s = new Map();
  d.places.forEach((p) => s.set(low(p.name), p.name));
  d.items.forEach((it) => { if (!it.in) for (let i = 1; i <= (it.parts || []).length; i++) { const p = pathStr(it.parts.slice(0, i)); s.set(low(p), p); } });
  return s;
}

// destination text → {in} | {place} | {unknown: text} | {ambiguous: [...]}
function resolveDest(d, text) {
  const t = clean(text);
  if (!t) return null;
  const path = pathStr(norm(t));
  const paths = allPaths(d);
  if (paths.has(low(path))) return { place: paths.get(low(path)) };
  const exactBag = d.bags.filter((b) => low(b.name) === low(t));
  if (exactBag.length === 1) return { in: exactBag[0].id };
  const bagHits = d.bags.filter((b) => matches(b.name, t));
  const placeHits = d.places.filter((p) => matches(p.name, t));
  if (bagHits.length + placeHits.length === 1) return bagHits.length ? { in: bagHits[0].id } : { place: placeHits[0].name };
  if (bagHits.length + placeHits.length > 1) return { ambiguous: true, bags: bagHits, places: placeHits };
  return { unknown: path };
}

function findThings(d, q) {
  const exactI = d.items.filter((i) => low(i.name) === low(q));
  const exactB = d.bags.filter((b) => low(b.name) === low(q));
  if (exactI.length + exactB.length) return { items: exactI, bags: exactB };
  return { items: d.items.filter((i) => matches(i.name, q)), bags: d.bags.filter((b) => matches(b.name, q)) };
}

function moveItem(d, it, dest, note) {
  if (dest.in ? it.in === dest.in : (!it.in && it.place === dest.place)) return false;
  const t = Date.now();
  it.in = dest.in || null;
  if (!dest.in) { it.parts = norm(dest.place); it.place = pathStr(it.parts); }
  it.missing = false; it.updatedAt = t; it._t = t;
  const e = { t, kind: "move", to: labelFor(d, dest), in: it.in };
  if (note) e.note = note;
  it.log = addLog(it.log, e);
  return true;
}
function moveBag(d, b, place, note) {
  if (b.location === place && !b.dest) return false;
  const t = Date.now();
  const e = { t, from: b.location || "", to: place };
  if (note) e.note = note;
  b.log = addLog(b.log, e);
  b.location = place; b.dest = null; b._t = t;
  return true;
}
function addItem(d, name, dest) {
  const t = Date.now();
  const it = { id: uid(), name, place: "", parts: [], in: null, qty: "", note: "", photo: null, missing: false, updatedAt: t, _t: t, log: [] };
  if (dest.in) it.in = dest.in; else { it.parts = norm(dest.place); it.place = pathStr(it.parts); }
  it.log = [{ t, kind: "move", to: labelFor(d, dest), in: it.in }];
  d.items.push(it);
  return it;
}

// ---------- small UI helpers ----------
const PAGE = 15;
const fmtDate = (t) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(t));
const cut = (s, n = 56) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const btn = (text, data) => ({ text: cut(text), callback_data: data });
const kbd = (rows) => ({ inline_keyboard: rows.filter((r) => r && r.length) });
const pairs = (arr) => { const rows = []; for (let i = 0; i < arr.length; i += 2) rows.push(arr.slice(i, i + 2)); return rows; };
const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
const sortedPlaces = (d) => d.places.slice().sort(byOrder);
const sortedBags = (d) => d.bags.slice().sort(byOrder);

// Hidden state travels inside the bot's own message as an invisible link,
// so the bot needs no storage of its own: replies and button presses carry it back.
const STATE_URL = "https://ducktail1.github.io/Kolchan/#s=";
const b64url = (s) => b64enc(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => b64dec(s.replace(/-/g, "+").replace(/_/g, "/"));
const st = (obj) => '<a href="' + STATE_URL + b64url(JSON.stringify(obj)) + '">&#8205;</a>';
export function readState(msg) {
  for (const e of (msg && (msg.entities || msg.caption_entities)) || []) {
    if (e.type === "text_link" && e.url && e.url.startsWith(STATE_URL)) { try { return JSON.parse(unb64url(e.url.slice(STATE_URL.length))); } catch (x) {} }
  }
  return null;
}

const MENU = {
  keyboard: [[{ text: "🔎 Найти" }, { text: "➕ Добавить" }, { text: "⇄ Переложить" }], [{ text: "📍 Места" }, { text: "🎒 Сумки" }], [{ text: "🚚 В пути" }, { text: "🕓 История" }]],
  resize_keyboard: true, is_persistent: true,
};

const topPlace = (d, name) => d.places.find((p) => low(p.name) === low(norm(name)[0]));
const countAt = (d, p) => {
  const lp = low(p.name);
  return d.items.filter((i) => (!i.in && low((i.parts || [])[0]) === lp) || (i.in && low(norm((bagById(d, i.in) || {}).location)[0]) === lp)).length;
};
const inBag = (d, b) => d.items.filter((i) => i.in === b.id);
const targetOf = (d, kind, id) => (kind === "b" ? bagById(d, id) : d.items.find((i) => i.id === id));
const destFromCode = (d, kind, id) => {
  if (kind === "p") { const p = d.places.find((x) => x.id === id); return p ? { place: p.name } : null; }
  const b = bagById(d, id); return b ? { in: b.id } : null;
};
const backFor = (d, it) => {
  if (it.in && bagById(d, it.in)) return btn("⬅ " + bagById(d, it.in).name, "b:" + it.in);
  const p = topPlace(d, it.place); return p ? btn("⬅ " + p.name, "p:" + p.id) : btn("⬅ Места", "P");
};
const pager = (prefix, page, total) => {
  const pages = Math.ceil(total / PAGE); if (pages <= 1) return [];
  const row = [];
  if (page > 0) row.push(btn("◀", prefix + ":" + (page - 1)));
  row.push(btn((page + 1) + " / " + pages, "noop"));
  if (page < pages - 1) row.push(btn("▶", prefix + ":" + (page + 1)));
  return row;
};
function logLine(e) {
  const when = fmtDate(e.t || 0);
  let what;
  if (e.kind === "check-ok") what = "✔ на месте";
  else if (e.kind === "check-miss") what = "⚠ не нашлась";
  else if (e.kind === "note") what = "📝";
  else what = "→ " + (e.to || "");
  return when + " — " + esc(what) + (e.note ? " · " + esc(e.note) : "");
}

// ---------- views (return {text, kb}) ----------
function itemCard(d, it, head) {
  let s = (head ? head + "\n\n" : "") + "<b>" + esc(it.name) + "</b>" + (it.qty ? " × " + esc(it.qty) : "") + "\n📍 " + esc(itemWhere(d, it));
  if (it.missing) s += "\n⚠ отмечена как не нашлась";
  if (it.note) s += "\n📝 " + esc(it.note);
  const log = (it.log || []).slice(-6).reverse();
  if (log.length) s += "\n\n🕓 <b>Перемещения</b>\n" + log.map(logLine).join("\n");
  return { text: s, kb: kbd([[btn("⇄ Переложить", "mv:i:" + it.id)], [backFor(d, it)]]) };
}
function placeView(d, p, page = 0, head) {
  const lp = low(p.name);
  const bags = sortedBags(d).filter((b) => low(norm(b.location)[0]) === lp);
  const loose = d.items.filter((i) => !i.in && low((i.parts || [])[0]) === lp)
    .sort((a, b) => a.place.localeCompare(b.place, "ru") || a.name.localeCompare(b.name, "ru"));
  let s = (head ? head + "\n\n" : "") + "📍 <b>" + esc(p.name) + "</b>\n" + (bags.length ? bags.length + " " + plural(bags.length, ["сумка", "сумки", "сумок"]) + " · " : "") + nItems(loose.length) + " отдельно";
  if (!bags.length && !loose.length) s += "\n\nЗдесь пока ничего нет.";
  const rows = [];
  if (page === 0) bags.forEach((b) => rows.push([btn("🎒 " + b.name + " · " + inBag(d, b).length, "b:" + b.id)]));
  loose.slice(page * PAGE, page * PAGE + PAGE).forEach((i) => rows.push([btn((i.missing ? "⚠ " : "") + i.name + ((i.parts || []).length > 1 ? " · " + pathStr(i.parts.slice(1)) : ""), "i:" + i.id)]));
  rows.push(pager("p:" + p.id, page, loose.length));
  rows.push([btn("➕ Добавить сюда", "ad:p:" + p.id), btn("⬅ Места", "P")]);
  return { text: s, kb: kbd(rows) };
}
function bagView(d, b, page = 0, head) {
  const inside = inBag(d, b).sort((a, c) => a.name.localeCompare(c.name, "ru"));
  let s = (head ? head + "\n\n" : "") + "🎒 <b>" + esc(b.name) + "</b>\n📍 " + esc(bagWhere(b)) + "\nВнутри: " + nItems(inside.length);
  const last = (b.log || []).slice(-4).reverse();
  if (last.length) s += "\n\n🕓 <b>Перемещения</b>\n" + last.map((e) => fmtDate(e.t || 0) + " — " + esc((e.from ? e.from + " " : "") + "→ " + (e.to || "")) + (e.note ? " · " + esc(e.note) : "")).join("\n");
  const rows = inside.slice(page * PAGE, page * PAGE + PAGE).map((i) => [btn((i.missing ? "⚠ " : "") + i.name, "i:" + i.id)]);
  rows.push(pager("b:" + b.id, page, inside.length));
  if (b.location === TRANSIT) rows.push([btn("✅ Принять" + (b.dest ? " в " + b.dest : ""), "rc:" + b.id)]);
  rows.push([btn("🚚 Отправить", "snd:" + b.id), btn("⇄ Переложить", "mv:b:" + b.id)]);
  const p = topPlace(d, b.location);
  rows.push([btn("➕ Положить в сумку", "ad:b:" + b.id), p ? btn("⬅ " + p.name, "p:" + p.id) : btn("⬅ Сумки", "B")]);
  return { text: s, kb: kbd(rows) };
}
function placesList(d) {
  const rows = pairs(sortedPlaces(d).map((p) => btn("📍 " + p.name + " · " + countAt(d, p), "p:" + p.id)));
  rows.push([btn("➕ Новое место", "npl")]);
  return { text: "📍 <b>Места</b>", kb: kbd(rows) };
}
function bagsList(d) {
  const bags = sortedBags(d);
  return { text: bags.length ? "🎒 <b>Сумки</b>" : "Сумок пока нет.", kb: kbd(bags.map((b) => [btn("🎒 " + b.name + " · " + bagWhere(b), "b:" + b.id)])) };
}
function transitList(d) {
  const bags = sortedBags(d).filter((b) => b.location === TRANSIT);
  if (!bags.length) return { text: "🚚 Сейчас ничего не в пути." };
  return {
    text: "🚚 <b>В пути</b>\n\n" + bags.map((b) => { const e = (b.log || []).slice(-1)[0]; return "🎒 " + esc(b.name) + (b.dest ? " → " + esc(b.dest) : "") + " · " + nItems(inBag(d, b).length) + (e ? "\n   с " + fmtDate(e.t) : ""); }).join("\n"),
    kb: kbd(bags.map((b) => [btn("🎒 " + b.name, "b:" + b.id), btn("✅ Принять", "rc:" + b.id)])),
  };
}
function historyView(d) {
  const ev = [];
  d.items.forEach((i) => (i.log || []).forEach((e) => { if (!e.kind || e.kind === "move") ev.push({ t: e.t || 0, name: i.name, to: e.to, note: e.note, data: "i:" + i.id }); }));
  d.bags.forEach((b) => (b.log || []).forEach((e) => ev.push({ t: e.t || 0, name: "🎒 " + b.name, to: e.to, note: e.note, data: "b:" + b.id })));
  ev.sort((a, b) => b.t - a.t);
  const top = ev.slice(0, 15);
  if (!top.length) return { text: "🕓 Перемещений пока нет." };
  return {
    text: "🕓 <b>Последние перемещения</b>\n\n" + top.map((e) => fmtDate(e.t) + " — <b>" + esc(e.name) + "</b> → " + esc(e.to || "") + (e.note ? " · " + esc(e.note) : "")).join("\n"),
    kb: kbd(top.slice(0, 10).map((e) => [btn(e.name + " → " + (e.to || ""), e.data)])),
  };
}
// where to put something: places in pairs, then bags (for items), then "new place" and "back"
function destPicker(d, kind, id, title) {
  const t = targetOf(d, kind, id);
  const rows = pairs(sortedPlaces(d).filter((p) => !(kind === "b" && p.name === TRANSIT)).map((p) => btn("📍 " + p.name, "md:" + kind + ":" + id + ":p:" + p.id)));
  if (kind === "i") sortedBags(d).forEach((b) => rows.push([btn("🎒 " + b.name + " · " + b.location, "md:i:" + id + ":b:" + b.id)]));
  rows.push([btn("➕ Новое место", "nw:" + kind + ":" + id), btn("⬅ Назад", kind + ":" + id)]);
  return { text: title || "Куда переложить <b>" + esc(t.name) + "</b>?", kb: kbd(rows) };
}
function addPicker(d, names) {
  const rows = pairs(sortedPlaces(d).map((p) => btn("📍 " + p.name, "ap:p:" + p.id)));
  sortedBags(d).forEach((b) => rows.push([btn("🎒 " + b.name + " · " + b.location, "ap:b:" + b.id)]));
  rows.push([btn("➕ Новое место", "anp")]);
  return { text: st({ k: "add", n: names }) + "Куда положить: <b>" + esc(names.join(", ")) + "</b>?", kb: kbd(rows) };
}
function searchView(d, q) {
  q = clean(q.replace(/^(где|найди|найти|покажи|показать)\s+/i, "").replace(/\?$/, ""));
  if (!q) return { text: "Напиши, что ищешь." };
  const paths = allPaths(d);
  const pq = pathStr(norm(q));
  const exactPlace = d.places.find((p) => low(p.name) === low(pq));
  if (exactPlace) return placeView(d, exactPlace);
  const exactBag = d.bags.filter((b) => low(b.name) === low(q));
  if (exactBag.length === 1) return bagView(d, exactBag[0]);
  const f = findThings(d, q);
  const pl = d.places.filter((p) => matches(p.name, q));
  const total = f.items.length + f.bags.length + pl.length;
  if (!total) {
    if (paths.has(low(pq))) { const p = topPlace(d, pq); if (p) return placeView(d, p); }
    return { text: "Не нашёл «" + esc(q) + "».", kb: kbd([[btn("➕ Добавить «" + q + "»", "aq")]]), state: { k: "q", q } };
  }
  if (total === 1) return f.items.length ? itemCard(d, f.items[0]) : f.bags.length ? bagView(d, f.bags[0]) : placeView(d, pl[0]);
  const rows = pl.map((p) => [btn("📍 " + p.name, "p:" + p.id)])
    .concat(f.bags.map((b) => [btn("🎒 " + b.name + " · " + bagWhere(b), "b:" + b.id)]))
    .concat(f.items.slice(0, 30).map((i) => [btn((i.missing ? "⚠ " : "") + i.name + " · " + itemWhere(d, i).replace(/^в «[^»]*» \(/, "🎒 ").replace(/\)$/, ""), "i:" + i.id)]));
  return { text: "🔎 «" + esc(q) + "» — нашёл " + total + (f.items.length > 30 ? ". Показал первые 30, напиши точнее." : ""), kb: kbd(rows) };
}

// ---------- actions that change data ----------
function doMove(d, kind, id, dest, note) {
  const t = targetOf(d, kind, id);
  if (!t) return { text: "Не нашёл — может, уже удалено." };
  if (kind === "b") {
    if (dest.in) return { text: "Сумку можно переложить только в место." };
    if (!moveBag(d, t, dest.place, note)) return bagView(d, t, 0, "Уже там.");
    return Object.assign(bagView(d, t, 0, "✅ Переложил сумку → " + esc(dest.place)), { change: "Бот: " + t.name + " → " + dest.place });
  }
  if (dest.in === t.id) return { text: "Нельзя положить вещь саму в себя." };
  if (!moveItem(d, t, dest, note)) return itemCard(d, t, "Уже там.");
  return Object.assign(itemCard(d, t, "✅ Переложил"), { change: "Бот: " + t.name + " → " + labelFor(d, dest) });
}
function doAdd(d, names, dest, note) {
  const added = names.map((n) => addItem(d, n, dest));
  if (note) added.forEach((it) => { it.log[0].note = note; });
  const head = "➕ Добавил: " + added.map((i) => "<b>" + esc(i.name) + "</b>").join(", ") + "\n→ " + esc(labelFor(d, dest));
  const view = dest.in ? bagView(d, bagById(d, dest.in), 0, head) : added.length === 1 ? itemCard(d, added[0], "➕ Добавил") : placeView(d, topPlace(d, dest.place), 0, head);
  return Object.assign(view, { change: "Бот: добавлено " + names.join(", ") });
}
function doSend(d, b, place) {
  if (b.location === TRANSIT && b.dest === place) return bagView(d, b, 0, "Уже едет туда.");
  const t = Date.now();
  b.log = addLog(b.log, { t, from: b.location || "", to: TRANSIT, note: "→ " + place });
  b.location = TRANSIT; b.dest = place; b._t = t;
  return Object.assign(bagView(d, b, 0, "🚚 Отправил → " + esc(place)), { change: "Бот: " + b.name + " отправлена → " + place });
}
function doReceive(d, b) {
  if (b.location !== TRANSIT) return bagView(d, b, 0, "Сумка не в пути.");
  if (!b.dest) return Object.assign(destPicker(d, "b", b.id, "Куда приехала <b>" + esc(b.name) + "</b>?"));
  const to = b.dest, t = Date.now();
  b.log = addLog(b.log, { t, from: b.location, to, note: "принял" });
  b.location = to; b.dest = null; b._t = t;
  return Object.assign(bagView(d, b, 0, "✅ Принял в " + esc(to)), { change: "Бот: " + b.name + " принята в " + to });
}
const splitNames = (s) => s.split(",").map(clean).filter(Boolean);

// ---------- text input ----------
const HELP =
  "<b>Колчан</b> — где что лежит.\n\n" +
  "Кнопки внизу — меню. Можно просто написать название: найду вещь, сумку или место.\n\n" +
  "Быстрые команды текстом:\n" +
  "<code>+ Маска Smith → Дача</code> — добавить (несколько через запятую)\n" +
  "<code>маска → Сочи</code> — переложить\n" +
  "<code>маска → Дача // в стирке</code> — с заметкой";

const ARROW = /\s*(?:→|->|=>|—>|>>)\s*/;
export function onText(d, text, reply) {
  const t = clean(text);
  // menu buttons first
  if (/^\/(start|help|menu)/.test(t)) return { text: HELP, menu: true };
  if (t === "🔎 Найти") return { text: st({ k: "find" }) + "Что ищешь? Напиши название вещи, сумки или места.", force: "Например: маска" };
  if (t === "➕ Добавить") return { text: st({ k: "add" }) + "Что добавить? Несколько вещей — через запятую.", force: "Например: Маска Smith" };
  if (t === "⇄ Переложить") return { text: st({ k: "mv" }) + "Что переложить? Напиши название вещи или сумки.", force: "Например: маска torch" };
  if (t === "📍 Места" || /^\/places/.test(t)) return placesList(d);
  if (t === "🎒 Сумки" || /^\/bags/.test(t)) return bagsList(d);
  if (t === "🚚 В пути") return transitList(d);
  if (t === "🕓 История") return historyView(d);

  // answers to the bot's questions
  const s = reply ? readState(reply) : null;
  if (s && s.k === "add") {
    const names = splitNames(t);
    if (!names.length) return { text: "Не вижу названия." };
    if (s.d) { const [k, id] = s.d.split(":"); const dest = destFromCode(d, k, id); if (dest) return doAdd(d, names, dest); }
    return addPicker(d, names);
  }
  if (s && s.k === "addnp") { const name = clean(t.replace(/\//g, " ")); if (!name) return { text: "Не вижу названия." }; ensurePlace(d, name); return doAdd(d, s.n || [], { place: topPlace(d, name).name }); }
  if (s && s.k === "np") {
    const name = clean(t.replace(/\//g, " ")); if (!name) return { text: "Не вижу названия." };
    ensurePlace(d, name);
    if (s.t) return doMove(d, s.t, s.id, { place: topPlace(d, name).name });
    return Object.assign(placeView(d, topPlace(d, name), 0, "📍 Добавил место"), { change: "Бот: новое место " + name });
  }
  if (s && s.k === "mv") {
    const f = findThings(d, t);
    const all = f.items.map((o) => ["i", o]).concat(f.bags.map((o) => ["b", o]));
    if (!all.length) return { text: "Не нашёл «" + esc(t) + "»." };
    if (all.length === 1) return destPicker(d, all[0][0], all[0][1].id);
    return { text: "Что именно переложить?", kb: kbd(all.slice(0, 30).map(([k, o]) => [btn((k === "b" ? "🎒 " : "") + o.name + " · " + (k === "b" ? bagWhere(o) : itemWhere(d, o)), "mv:" + k + ":" + o.id)])) };
  }

  // quick text commands
  let cmd = t, note = "";
  const ni = cmd.indexOf("//");
  if (ni >= 0) { note = clean(cmd.slice(ni + 2)); cmd = clean(cmd.slice(0, ni)); }
  const arrow = cmd.match(ARROW);
  const what = clean(arrow ? cmd.slice(0, arrow.index) : cmd);
  const whereText = arrow ? clean(cmd.slice(arrow.index + arrow[0].length)) : "";
  if (/^\+/.test(what)) {
    const names = splitNames(what.replace(/^\+\s*/, ""));
    if (!names.length) return { text: "Напиши, что добавить." };
    if (!whereText) return addPicker(d, names);
    const dest = resolveDest(d, whereText);
    if (dest.in || dest.place) return doAdd(d, names, dest, note);
    if (dest.unknown) return { text: st({ k: "add", n: names, np: dest.unknown, note }) + "Места «" + esc(dest.unknown) + "» нет. Создать?", kb: kbd([[btn("Создать «" + dest.unknown + "»", "anew")], [btn("Выбрать из списка", "apick")]]) };
    return addPicker(d, names);
  }
  if (arrow && what) {
    const f = findThings(d, what);
    const all = f.items.map((o) => ["i", o]).concat(f.bags.map((o) => ["b", o]));
    if (!all.length) return { text: "Не нашёл «" + esc(what) + "».", kb: kbd([[btn("➕ Добавить «" + what + "»", "aq")]]), state: { k: "q", q: what } };
    const dest = whereText ? resolveDest(d, whereText) : null;
    if (all.length > 1) {
      return { text: st({ k: "mvto", w: whereText, note }) + "Что именно переложить" + (whereText ? " → " + esc(whereText) : "") + "?", kb: kbd(all.slice(0, 30).map(([k, o]) => [btn((k === "b" ? "🎒 " : "") + o.name + " · " + (k === "b" ? bagWhere(o) : itemWhere(d, o)), "mt:" + k + ":" + o.id)])) };
    }
    return moveTo(d, all[0][0], all[0][1].id, whereText, dest, note);
  }
  return searchView(d, t);
}
function moveTo(d, kind, id, whereText, dest, note) {
  if (!dest) return destPicker(d, kind, id);
  if (dest.in || dest.place) return doMove(d, kind, id, dest, note);
  if (dest.unknown) {
    const t = targetOf(d, kind, id);
    return { text: st({ k: "mvnew", t: kind, id, p: dest.unknown, note }) + "<b>" + esc(t.name) + "</b>: места «" + esc(dest.unknown) + "» нет. Создать?", kb: kbd([[btn("Создать «" + dest.unknown + "»", "mnew")], [btn("Выбрать из списка", "mv:" + kind + ":" + id)]]) };
  }
  return destPicker(d, kind, id, "Уточни, куда: «" + esc(whereText) + "»");
}

// ---------- button presses ----------
// returns a view; .ask = send a new question (force reply) instead of editing
export function onButton(d, data, msg) {
  const p = data.split(":");
  const s = readState(msg) || {};
  switch (p[0]) {
    case "noop": return null;
    case "P": return placesList(d);
    case "B": return bagsList(d);
    case "p": { const pl = d.places.find((x) => x.id === p[1]); return pl ? placeView(d, pl, +p[2] || 0) : placesList(d); }
    case "b": { const b = bagById(d, p[1]); return b ? bagView(d, b, +p[2] || 0) : bagsList(d); }
    case "i": { const it = d.items.find((x) => x.id === p[1]); return it ? itemCard(d, it) : { text: "Не нашёл — может, уже удалено." }; }
    case "mv": return targetOf(d, p[1], p[2]) ? destPicker(d, p[1], p[2]) : { text: "Не нашёл — может, уже удалено." };
    case "md": { const dest = destFromCode(d, p[3], p[4]); return dest ? doMove(d, p[1], p[2], dest) : { text: "Не нашёл это место." }; }
    case "mt": return targetOf(d, p[1], p[2]) ? moveTo(d, p[1], p[2], s.w || "", s.w ? resolveDest(d, s.w) : null, s.note) : { text: "Не нашёл — может, уже удалено." };
    case "mnew": { if (!s.p) return null; ensurePlace(d, s.p); return doMove(d, s.t, s.id, { place: s.p }, s.note); }
    case "nw": { const t = targetOf(d, p[1], p[2]); if (!t) return null; return { ask: true, text: st({ k: "np", t: p[1], id: p[2] }) + "Как назвать новое место для <b>" + esc(t.name) + "</b>?", force: "Например: Гараж" }; }
    case "npl": return { ask: true, text: st({ k: "np" }) + "Как назвать новое место?", force: "Например: Гараж" };
    case "ad": { const t = p[1] === "p" ? d.places.find((x) => x.id === p[2]) : bagById(d, p[2]); if (!t) return null; return { ask: true, text: st({ k: "add", d: p[1] + ":" + p[2] }) + "Что положить в «" + esc(t.name) + "»? Несколько — через запятую.", force: "Например: Маска Smith" }; }
    case "aq": return s.q ? addPicker(d, [s.q]) : null;
    case "ap": { const dest = destFromCode(d, p[1], p[2]); return dest && s.n ? doAdd(d, s.n, dest, s.note) : { text: "Не получилось — начни заново." }; }
    case "anp": return s.n ? { ask: true, text: st({ k: "addnp", n: s.n }) + "Как назвать новое место?", force: "Например: Гараж" } : null;
    case "anew": { if (!s.np || !s.n) return null; ensurePlace(d, s.np); return doAdd(d, s.n, { place: s.np }, s.note); }
    case "apick": return s.n ? addPicker(d, s.n) : null;
    case "snd": {
      const b = bagById(d, p[1]); if (!b) return null;
      const rows = pairs(sortedPlaces(d).filter((x) => x.name !== TRANSIT && x.name !== b.location).map((x) => btn("📍 " + x.name, "sd:" + b.id + ":" + x.id)));
      rows.push([btn("⬅ Назад", "b:" + b.id)]);
      return { text: "Куда отправить <b>" + esc(b.name) + "</b>? Пока едет, она будет в «" + TRANSIT + "».", kb: kbd(rows) };
    }
    case "sd": { const b = bagById(d, p[1]), pl = d.places.find((x) => x.id === p[2]); return b && pl ? doSend(d, b, pl.name) : null; }
    case "rc": { const b = bagById(d, p[1]); return b ? doReceive(d, b) : null; }
  }
  return null;
}

// ---------- Telegram ----------
async function tg(env, method, body) {
  const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
function chunks(text, max = 3900) {
  const out = []; let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > max) { out.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) out.push(cur);
  return out;
}
async function send(env, chatId, res, editId) {
  let text = res.text;
  if (res.state) text = st(res.state) + text;
  const parts = chunks(text);
  const base = { chat_id: chatId, parse_mode: "HTML", link_preview_options: { is_disabled: true }, disable_web_page_preview: true };
  for (const extra of parts.slice(0, -1)) await tg(env, "sendMessage", Object.assign({}, base, { text: extra }));
  const body = Object.assign({}, base, { text: parts[parts.length - 1] || "…" });
  if (res.force) body.reply_markup = { force_reply: true, input_field_placeholder: res.force };
  else if (res.menu) body.reply_markup = MENU;
  else if (res.kb) body.reply_markup = res.kb;
  if (editId && !res.force && !res.menu && parts.length === 1) {
    const r = await tg(env, "editMessageText", Object.assign({ message_id: editId }, body));
    if (r.ok || /not modified/.test(r.description || "")) return;
  }
  await tg(env, "sendMessage", body);
}

// load → run → save, retrying if someone (the phone) wrote in between
async function transact(env, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await load(env);
    const res = fn(data);
    if (!res || !res.change) return res;
    try { await save(env, data, sha, res.change); return res; }
    catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 2) continue; throw e; }
  }
}

async function handleUpdate(env, u) {
  const from = (u.message && u.message.from) || (u.callback_query && u.callback_query.from);
  if (!from) return;
  const chatId = u.message ? u.message.chat.id : u.callback_query.message.chat.id;
  if (!env.OWNER_ID) { await send(env, chatId, { text: "Твой Telegram ID: <code>" + from.id + "</code>\nВпиши его в переменную OWNER_ID в настройках Worker." }); return; }
  if (String(from.id) !== String(env.OWNER_ID)) return;   // чужим не отвечаем
  try {
    if (u.message) {
      const m = u.message;
      const text = m.text || m.caption || "";
      if (!text) { await send(env, chatId, { text: "Пока понимаю только текст." }); return; }
      const res = await transact(env, (d) => onText(d, text, m.reply_to_message));
      if (res) await send(env, chatId, res);
    } else {
      const cq = u.callback_query;
      await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
      const res = await transact(env, (d) => onButton(d, cq.data || "", cq.message));
      if (res) await send(env, chatId, res, res.ask ? null : cq.message.message_id);
    }
  } catch (e) {
    const why = e.status === 401 ? "токен GitHub не подходит или истёк" : e.status === 404 || e.status === 403 ? "нет доступа к " + env.REPO + " (проверь REPO и права токена)" : String(e.message || e);
    await send(env, chatId, { text: "⚠ Не получилось: " + esc(why) });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/setup") {
      if (!env.HOOK_SECRET || url.searchParams.get("key") !== env.HOOK_SECRET) return new Response("Неверный key", { status: 403 });
      const hook = await tg(env, "setWebhook", { url: url.origin + "/tg", secret_token: env.HOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
      await tg(env, "setMyCommands", { commands: [{ command: "menu", description: "Меню" }, { command: "places", description: "Места" }, { command: "bags", description: "Сумки" }] });
      const me = await tg(env, "getMe", {});
      return new Response((hook.ok ? "Готово! Бот @" + (me.result && me.result.username) + " подключён. Напиши ему /start." : "Ошибка: " + JSON.stringify(hook)) + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/tg" && req.method === "POST") {
      if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.HOOK_SECRET) return new Response("forbidden", { status: 403 });
      const u = await req.json();
      await handleUpdate(env, u);
      return new Response("ok");
    }
    return new Response("Колчан-бот " + BOT_VERSION + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};
