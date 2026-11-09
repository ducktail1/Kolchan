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
const DATA = ["places", "bags", "items", "quivers"];
const MAINQ = "main", MAIN_NAME = "Основной";
const QOF = (r) => (r && r.q) || MAINQ;
export const BOT_VERSION = "1.3.3";

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
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
  const order = { places: byOrder, bags: byOrder, quivers: byOrder, items: (a, b) => (a.id < b.id ? -1 : 1) };
  const keySort = (o) => JSON.stringify(Object.keys(o).sort().reduce((m, k) => ((m[k] = o[k]), m), {}));
  const lines = ["{", '"app": "kolchan", "version": 1, "exportedAt": ' + Date.now() + ","];
  DATA.forEach((c) => { if (c === "quivers" && !(d[c] || []).length) return; lines.push('"' + c + '": ['); lines.push((d[c] || []).slice().sort(order[c]).map(keySort).join(",\n")); lines.push("],"); });
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
// quivers: every record carries q (no q = the first quiver). A "scope" is the same data narrowed to one quiver;
// records are shared objects, so changes made through a scope land in the real data.
const rootOf = (d) => d.root || d;
function scope(d, q) {
  const r = rootOf(d);
  return { root: r, q, quivers: r.quivers, places: r.places.filter((x) => QOF(x) === q), bags: r.bags.filter((x) => QOF(x) === q), items: r.items.filter((x) => QOF(x) === q) };
}
function qIds(d) {
  const r = rootOf(d), ids = new Set([MAINQ]);
  (r.quivers || []).forEach((x) => ids.add(x.id));
  ["places", "bags", "items"].forEach((c) => r[c].forEach((x) => ids.add(QOF(x))));
  const ord = (id) => { const x = (r.quivers || []).find((y) => y.id === id); return x ? x.order || 0 : id === MAINQ ? -1 : 1e6; };
  return [...ids].sort((a, b) => ord(a) - ord(b));
}
const multiQ = (d) => qIds(d).length > 1;
function qName(d, id) { const x = (rootOf(d).quivers || []).find((y) => y.id === id); return x && x.name ? x.name : id === MAINQ ? MAIN_NAME : "Колчан"; }
const setQ = (rec, q) => { if (q && q !== MAINQ) rec.q = q; else delete rec.q; };
const bagById = (d, id) => rootOf(d).bags.find((b) => b.id === id);
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
  setQ(p, d.q);
  rootOf(d).places.push(p);
  if (d.root) d.places.push(p);
  return p;
}
// every known loose place path
function allPaths(d) {
  const s = new Map();
  d.places.forEach((p) => s.set(low(p.name), p.name));
  d.items.forEach((it) => { if (!it.in) for (let i = 1; i <= (it.parts || []).length; i++) { const p = pathStr(it.parts.slice(0, i)); s.set(low(p), p); } });
  return s;
}

// destination text → {in, q} | {place, q} | {unknown: text} | {ambiguous: [...]}
// Without a scope it looks in every quiver and reports a clash when the name exists in several.
function resolveDest(d, text) {
  const t = clean(text);
  if (!t) return null;
  if (!d.root) {
    const hits = qIds(d).map((q) => resolveDest(scope(d, q), t)).filter((r) => r && (r.place || r.in || r.ambiguous));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return { ambiguous: true, places: [], bags: [], any: true };
    return { unknown: pathStr(norm(t)) };
  }
  const R = (o) => Object.assign(o, { q: d.q });
  const path = pathStr(norm(t));
  const paths = allPaths(d);
  if (paths.has(low(path))) return R({ place: paths.get(low(path)) });
  const exactBag = d.bags.filter((b) => low(b.name) === low(t));
  if (exactBag.length === 1) return R({ in: exactBag[0].id });
  const bagHits = d.bags.filter((b) => matches(b.name, t));
  const placeHits = d.places.filter((p) => matches(p.name, t));
  if (bagHits.length + placeHits.length === 1) return R(bagHits.length ? { in: bagHits[0].id } : { place: placeHits[0].name });
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
  setQ(it, dest.in ? QOF(bagById(d, dest.in)) : dest.q || d.q);
  it.log = [{ t, kind: "move", to: labelFor(d, dest), in: it.in }];
  rootOf(d).items.push(it);
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
  const lp = low(p.name), ds = scope(d, QOF(p));
  return ds.items.filter((i) => (!i.in && low((i.parts || [])[0]) === lp) || (i.in && low(norm((bagById(d, i.in) || {}).location)[0]) === lp)).length;
};
const qTag = (d, r) => (multiQ(d) ? " · " + qName(d, QOF(r)) : "");
const inBag = (d, b) => d.items.filter((i) => i.in === b.id);
const targetOf = (d, kind, id) => (kind === "b" ? bagById(d, id) : d.items.find((i) => i.id === id));
const destFromCode = (d, kind, id) => {
  if (kind === "p") { const p = rootOf(d).places.find((x) => x.id === id); return p ? { place: p.name, q: QOF(p) } : null; }
  const b = bagById(d, id); return b ? { in: b.id, q: QOF(b) } : null;
};
const backFor = (d, it) => {
  if (it.in && bagById(d, it.in)) return btn("⬅ " + bagById(d, it.in).name, "b:" + it.in);
  const p = topPlace(scope(d, QOF(it)), it.place); return p ? btn("⬅ " + p.name, "p:" + p.id) : btn("⬅ Места", "P");
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
  else if (e.kind === "found") what = "✔ нашлась: " + (e.to || "");
  else if (e.kind === "trip") what = "🧳 скопирована в поездку «" + (e.to || "") + "»";
  else if (e.kind === "note") what = "📝";
  else if (e.kind === "rename") return fmtDate(e.t || 0) + " — ✎ " + esc(e.what === "place" ? "место «" + e.from + "» → «" + e.to + "»" : e.what === "bag" ? "сумка «" + e.from + "» → «" + e.to + "»" : "«" + e.from + "» → «" + e.to + "»");
  else what = "→ " + (e.to || "");
  return when + " — " + esc(what) + (e.note ? " · " + esc(e.note) : "");
}

// ---------- views (return {text, kb}) ----------
function itemCard(d, it, head) {
  let s = (head ? head + "\n\n" : "") + "<b>" + esc(it.name) + "</b>" + (it.qty ? " × " + esc(it.qty) : "") + (multiQ(d) ? "\n🗂 " + esc(qName(d, QOF(it))) : "") + "\n📍 " + esc(itemWhere(d, it));
  if (it.missing) s += "\n⚠ отмечена как не нашлась";
  if (it.note) s += "\n📝 " + esc(it.note);
  const log = (it.log || []).slice(-6).reverse();
  if (log.length) s += "\n\n🕓 <b>Перемещения</b>\n" + log.map(logLine).join("\n");
  return { text: s, kb: kbd([[btn("⇄ Переложить", "mv:i:" + it.id)], [backFor(d, it)]]) };
}
function placeView(d, p, page = 0, head) {
  const lp = low(p.name), ds = scope(d, QOF(p));
  const bags = sortedBags(ds).filter((b) => low(norm(b.location)[0]) === lp);
  const loose = ds.items.filter((i) => !i.in && low((i.parts || [])[0]) === lp)
    .sort((a, b) => a.place.localeCompare(b.place, "ru") || a.name.localeCompare(b.name, "ru"));
  let s = (head ? head + "\n\n" : "") + "📍 <b>" + esc(p.name) + "</b>" + (multiQ(d) ? " · " + esc(qName(d, QOF(p))) : "") + "\n" + (bags.length ? bags.length + " " + plural(bags.length, ["сумка", "сумки", "сумок"]) + " · " : "") + nItems(loose.length) + " отдельно";
  if (!bags.length && !loose.length) s += "\n\nЗдесь пока ничего нет.";
  const rows = [];
  if (page === 0) bags.forEach((b) => rows.push([btn("🎒 " + b.name + " · " + inBag(d, b).length, "b:" + b.id)]));
  loose.slice(page * PAGE, page * PAGE + PAGE).forEach((i) => rows.push([btn((i.missing ? "⚠ " : "") + i.name + ((i.parts || []).length > 1 ? " · " + pathStr(i.parts.slice(1)) : ""), "i:" + i.id)]));
  rows.push(pager("p:" + p.id, page, loose.length));
  rows.push([btn("➕ Добавить сюда", "ad:p:" + p.id), btn("✎ Переименовать", "rn:" + p.id)]);
  rows.push([btn("⬅ Места", "P")]);
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
  const p = topPlace(scope(d, QOF(b)), b.location);
  rows.push([btn("➕ Положить в сумку", "ad:b:" + b.id), btn("✎ Переименовать", "rnb:" + b.id)]);
  rows.push([p ? btn("⬅ " + p.name, "p:" + p.id) : btn("⬅ Сумки", "B")]);
  return { text: s, kb: kbd(rows) };
}
// several quivers: a section per quiver, with a header row
function byQuiver(d, fn) {
  if (!multiQ(d)) return fn(scope(d, MAINQ), MAINQ);
  const rows = [];
  qIds(d).forEach((q) => { const part = fn(scope(d, q), q); if (part.length) { rows.push([btn("🗂 " + qName(d, q), "noop")]); rows.push(...part); } });
  return rows;
}
function placesList(d) {
  const rows = byQuiver(d, (ds, q) => pairs(sortedPlaces(ds).map((p) => btn("📍 " + p.name + " · " + countAt(d, p), "p:" + p.id))).concat([[btn("➕ Новое место" + (multiQ(d) ? " в «" + qName(d, q) + "»" : ""), "npl:" + q)]]));
  return { text: "📍 <b>Места</b>", kb: kbd(rows) };
}
function bagsList(d) {
  const rows = byQuiver(d, (ds) => sortedBags(ds).map((b) => [btn("🎒 " + b.name + " · " + bagWhere(b), "b:" + b.id)]));
  return { text: rows.length ? "🎒 <b>Сумки</b>" : "Сумок пока нет.", kb: kbd(rows) };
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
  const ds = scope(d, QOF(t));
  const rows = pairs(sortedPlaces(ds).filter((p) => !(kind === "b" && p.name === TRANSIT)).map((p) => btn("📍 " + p.name, "md:" + kind + ":" + id + ":p:" + p.id)));
  if (kind === "i") sortedBags(ds).forEach((b) => rows.push([btn("🎒 " + b.name + " · " + b.location, "md:i:" + id + ":b:" + b.id)]));
  rows.push([btn("➕ Новое место", "nw:" + kind + ":" + id), btn("⬅ Назад", kind + ":" + id)]);
  return { text: title || "Куда переложить <b>" + esc(t.name) + "</b>?", kb: kbd(rows) };
}
function addPicker(d, names) {
  const rows = byQuiver(d, (ds, q) => pairs(sortedPlaces(ds).map((p) => btn("📍 " + p.name, "ap:p:" + p.id)))
    .concat(sortedBags(ds).map((b) => [btn("🎒 " + b.name + " · " + b.location, "ap:b:" + b.id)]))
    .concat([[btn("➕ Новое место" + (multiQ(d) ? " в «" + qName(d, q) + "»" : ""), "anp:" + q)]]));
  return { text: st({ k: "add", n: names }) + "Куда положить: <b>" + esc(names.join(", ")) + "</b>?", kb: kbd(rows) };
}
function searchView(d, q) {
  q = clean(q.replace(/^(где|найди|найти|покажи|показать)\s+/i, "").replace(/\?$/, ""));
  if (!q) return { text: "Напиши, что ищешь." };
  const paths = allPaths(d);
  const pq = pathStr(norm(q));
  const exactPlaces = d.places.filter((p) => low(p.name) === low(pq));
  if (exactPlaces.length === 1) return placeView(d, exactPlaces[0]);
  const exactBag = d.bags.filter((b) => low(b.name) === low(q));
  if (exactBag.length === 1) return bagView(d, exactBag[0]);
  const f = findThings(d, q);
  const pl = exactPlaces.length > 1 ? exactPlaces : d.places.filter((p) => matches(p.name, q));
  const total = f.items.length + f.bags.length + pl.length;
  if (!total) {
    if (paths.has(low(pq))) { const p = topPlace(d, pq); if (p) return placeView(d, p); }
    return { text: "Не нашёл «" + esc(q) + "».", kb: kbd([[btn("➕ Добавить «" + q + "»", "aq")]]), state: { k: "q", q } };
  }
  if (total === 1) return f.items.length ? itemCard(d, f.items[0]) : f.bags.length ? bagView(d, f.bags[0]) : placeView(d, pl[0]);
  const rows = pl.map((p) => [btn("📍 " + p.name + qTag(d, p), "p:" + p.id)])
    .concat(f.bags.map((b) => [btn("🎒 " + b.name + " · " + bagWhere(b) + qTag(d, b), "b:" + b.id)]))
    .concat(f.items.slice(0, 30).map((i) => [btn((i.missing ? "⚠ " : "") + i.name + " · " + itemWhere(d, i).replace(/^в «[^»]*» \(/, "🎒 ").replace(/\)$/, "") + qTag(d, i), "i:" + i.id)]));
  return { text: "🔎 «" + esc(q) + "» — нашёл " + total + (f.items.length > 30 ? ". Показал первые 30, напиши точнее." : ""), kb: kbd(rows) };
}

// ---------- actions that change data ----------
// rename a top-level place inside its quiver: the place, loose items and bags there (or heading there);
// a name that already exists merges the two places. History stays as it was.
function doRename(d, p, name) {
  const ds = scope(d, QOF(p)), old = low(p.name), t = Date.now();
  const swap = (path) => { const a = norm(path); if (low(a[0]) !== old) return null; a[0] = name; return pathStr(a); };
  ds.items.forEach((i) => { if (i.in) return; const op = i.place, np = swap(i.place); if (np === null) return; i.parts = norm(np); i.place = np; i.updatedAt = t; i._t = t; i.log = addLog(i.log, { t, kind: "rename", what: "place", from: op, to: np }); });
  ds.bags.forEach((b) => { const nl = swap(b.location), nd = b.dest ? swap(b.dest) : null; if (nl === null && nd === null) return; if (nl !== null) b.location = nl; if (nd !== null) b.dest = nd; b._t = t; });
  const other = ds.places.find((x) => x !== p && low(x.name) === low(name));
  const r = rootOf(d);
  if (other) { r.places.splice(r.places.indexOf(p), 1); return other; }
  p.name = name; p._t = t; return p;
}
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
  const tp = !dest.in && topPlace(scope(d, QOF(added[0])), dest.place);
  const view = dest.in ? bagView(d, bagById(d, dest.in), 0, head) : added.length === 1 || !tp ? itemCard(d, added[0], "➕ Добавил") : placeView(d, tp, 0, head);
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
  if (s && s.k === "addnp") { const name = clean(t.replace(/\//g, " ")); if (!name) return { text: "Не вижу названия." }; const ds = scope(d, s.q || MAINQ); const pl = ensurePlace(ds, name); return doAdd(d, s.n || [], { place: pl.name, q: ds.q }); }
  if (s && s.k === "np") {
    const name = clean(t.replace(/\//g, " ")); if (!name) return { text: "Не вижу названия." };
    const tg0 = s.t ? targetOf(d, s.t, s.id) : null;
    if (s.t && !tg0) return { text: "Не нашёл — может, уже удалено." };
    const ds = scope(d, tg0 ? QOF(tg0) : s.q || MAINQ);
    const pl = ensurePlace(ds, name);
    if (s.t) return doMove(d, s.t, s.id, { place: pl.name, q: ds.q });
    return Object.assign(placeView(d, pl, 0, "📍 Добавил место"), { change: "Бот: новое место " + name });
  }
  if (s && s.k === "rn") {
    const p = rootOf(d).places.find((x) => x.id === s.id); if (!p) return { text: "Не нашёл это место." };
    const name = clean(t.replace(/\//g, " ")); if (!name) return { text: "Не вижу названия." };
    if (name === p.name) return placeView(d, p);
    const oldName = p.name, merged = scope(d, QOF(p)).places.some((x) => x !== p && low(x.name) === low(name));
    const res = doRename(d, p, name);
    return Object.assign(placeView(d, res, 0, merged ? "🔀 Объединил «" + esc(oldName) + "» с «" + esc(res.name) + "»" : "✎ Переименовал «" + esc(oldName) + "» → «" + esc(name) + "»"), { change: "Бот: место " + oldName + " → " + name });
  }
  if (s && s.k === "rnb") {
    const b = bagById(d, s.id); if (!b) return { text: "Не нашёл эту сумку." };
    const name = clean(t.replace(/\//g, " ")); if (!name) return { text: "Не вижу названия." };
    if (name === b.name) return bagView(d, b);
    if (scope(d, QOF(b)).bags.some((x) => x !== b && low(x.name) === low(name))) return { text: "Сумка «" + esc(name) + "» уже есть — выбери другое название." };
    const old = b.name, tt = Date.now();
    b.name = name; b._t = tt;
    d.items.filter((i) => i.in === b.id).forEach((i, k) => { i.updatedAt = tt + k; i._t = tt + k; i.log = addLog(i.log, { t: tt + k, kind: "rename", what: "bag", from: old, to: name }); });
    return Object.assign(bagView(d, b, 0, "✎ Переименовал «" + esc(old) + "» → «" + esc(name) + "»"), { change: "Бот: сумка " + old + " → " + name });
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
    if (all.length > 1) {
      return { text: st({ k: "mvto", w: whereText, note }) + "Что именно переложить" + (whereText ? " → " + esc(whereText) : "") + "?", kb: kbd(all.slice(0, 30).map(([k, o]) => [btn((k === "b" ? "🎒 " : "") + o.name + " · " + (k === "b" ? bagWhere(o) : itemWhere(d, o)), "mt:" + k + ":" + o.id)])) };
    }
    return moveTo(d, all[0][0], all[0][1].id, whereText, note);
  }
  return searchView(d, t);
}
function moveTo(d, kind, id, whereText, note) {
  if (!whereText) return destPicker(d, kind, id);
  const dest = resolveDest(scope(d, QOF(targetOf(d, kind, id))), whereText);
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
    case "mt": return targetOf(d, p[1], p[2]) ? moveTo(d, p[1], p[2], s.w || "", s.note) : { text: "Не нашёл — может, уже удалено." };
    case "mnew": { const tg0 = targetOf(d, s.t, s.id); if (!s.p || !tg0) return null; const ds = scope(d, QOF(tg0)); ensurePlace(ds, s.p); return doMove(d, s.t, s.id, { place: s.p, q: ds.q }, s.note); }
    case "nw": { const t = targetOf(d, p[1], p[2]); if (!t) return null; return { ask: true, text: st({ k: "np", t: p[1], id: p[2] }) + "Как назвать новое место для <b>" + esc(t.name) + "</b>?", force: "Например: Гараж" }; }
    case "rn": { const pl = rootOf(d).places.find((x) => x.id === p[1]); if (!pl) return null; return { ask: true, text: st({ k: "rn", id: pl.id }) + "Новое название для «" + esc(pl.name) + "»? Если такое место уже есть, они объединятся.", force: pl.name }; }
    case "rnb": { const bg = bagById(d, p[1]); if (!bg) return null; return { ask: true, text: st({ k: "rnb", id: bg.id }) + "Новое название для сумки «" + esc(bg.name) + "»?", force: bg.name }; }
    case "npl": return { ask: true, text: st({ k: "np", q: p[1] || MAINQ }) + "Как назвать новое место" + (multiQ(d) ? " в «" + esc(qName(d, p[1] || MAINQ)) + "»" : "") + "?", force: "Например: Гараж" };
    case "ad": { const t = p[1] === "p" ? d.places.find((x) => x.id === p[2]) : bagById(d, p[2]); if (!t) return null; return { ask: true, text: st({ k: "add", d: p[1] + ":" + p[2] }) + "Что положить в «" + esc(t.name) + "»? Несколько — через запятую.", force: "Например: Маска Smith" }; }
    case "aq": return s.q ? addPicker(d, [s.q]) : null;
    case "ap": { const dest = destFromCode(d, p[1], p[2]); return dest && s.n ? doAdd(d, s.n, dest, s.note) : { text: "Не получилось — начни заново." }; }
    case "anp": return s.n ? { ask: true, text: st({ k: "addnp", n: s.n, q: p[1] || MAINQ }) + "Как назвать новое место?", force: "Например: Гараж" } : null;
    case "anew": { if (!s.np || !s.n) return null; const ds = scope(d, MAINQ); ensurePlace(ds, s.np); return doAdd(d, s.n, { place: s.np, q: MAINQ }, s.note); }
    case "apick": return s.n ? addPicker(d, s.n) : null;
    case "snd": {
      const b = bagById(d, p[1]); if (!b) return null;
      const rows = pairs(sortedPlaces(scope(d, QOF(b))).filter((x) => x.name !== TRANSIT && x.name !== b.location).map((x) => btn("📍 " + x.name, "sd:" + b.id + ":" + x.id)));
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
  else if (res.remove) body.reply_markup = { remove_keyboard: true };
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

// ---------- вход в приложение через Telegram (для всех, не только владельца) ----------
// Приложение открывает t.me/<бот>?start=login_<код>[_p]; здесь человек подтверждает вход
// (и при входе по номеру делится контактом), а бот сообщает об этом функции tg-auth в Supabase.
async function loginCall(env, body) {
  const r = await fetch(env.LOGIN_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-login-secret": env.LOGIN_SECRET }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(j.error || "login " + r.status);
  return j;
}
const LOGIN_START = /^\/start\s+login_([A-Za-z0-9-]{16,40})(_p)?(_a)?$/;
let ORIGIN = "";   // this worker's address — for the «Открыть Колчан» page
async function handleLogin(env, u) {
  const m = u.message, cq = u.callback_query;
  const isOwner = (id) => env.OWNER_ID && String(id) === String(env.OWNER_ID);
  if (m && LOGIN_START.test((m.text || "").trim())) {
    const [, code, p, a] = (m.text || "").trim().match(LOGIN_START);
    if (!env.LOGIN_URL || !env.LOGIN_SECRET) { await send(env, m.chat.id, { text: "Вход через Telegram ещё не настроен." }); return true; }
    await send(env, m.chat.id, {
      text: "🔐 <b>Вход в Колчан</b>" + (p ? " по номеру телефона" : "") + "\n\nНажми кнопку, если это ты сейчас входишь в приложение. Если ссылку прислал кто-то другой — ничего не нажимай.",
      kb: kbd([[{ text: "✅ Войти в Колчан", callback_data: "lg:" + code + ":" + (p ? "p" : "t") + (a ? ":a" : "") }]]),
    });
    return true;
  }
  if (cq && /^lg:/.test(cq.data || "")) {
    const [, code, mode, app] = cq.data.split(":");
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    try {
      await loginCall(env, { action: "confirm", code, mode: mode === "p" ? "phone" : "tg", tg: cq.from });
      if (mode === "p") {
        await send(env, cq.message.chat.id, { text: "✅ Почти готово. Теперь нажми «📱 Поделиться номером» внизу — так Telegram подтвердит, что номер твой.", kb: null, edit: true }, cq.message.message_id);
        await tg(env, "sendMessage", { chat_id: cq.message.chat.id, text: "Кнопка внизу 👇", reply_markup: { keyboard: [[{ text: "📱 Поделиться номером", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
      } else {
        const back = app && ORIGIN ? kbd([[{ text: "📦 Открыть Колчан", url: ORIGIN + "/open" }]]) : null;
        await send(env, cq.message.chat.id, Object.assign({ text: "✅ Готово! Вернись в Колчан — вход выполнится сам." }, back ? { kb: back } : {}), cq.message.message_id);
      }
    } catch (e) { await send(env, cq.message.chat.id, { text: "⚠ Не получилось: " + esc(e.message) + ". Начни вход в приложении заново." }, cq.message.message_id); }
    return true;
  }
  if (m && m.contact) {
    const back = isOwner(m.from.id) ? { menu: true } : { remove: true };
    if (String(m.contact.user_id || "") !== String(m.from.id)) { await send(env, m.chat.id, Object.assign({ text: "Нужен твой собственный номер — нажми кнопку «📱 Поделиться номером»." }, back)); return true; }
    try {
      const r = await loginCall(env, { action: "phone", tg_id: m.from.id, phone: m.contact.phone_number });
      await send(env, m.chat.id, Object.assign({ text: r.ok ? "✅ Номер подтверждён. Вернись в Колчан — вход выполнится сам." : "Не нашёл начатого входа. Начни вход по номеру в приложении заново." }, back));
    } catch (e) { await send(env, m.chat.id, Object.assign({ text: "⚠ Не получилось: " + esc(e.message) }, back)); }
    return true;
  }
  return false;
}

async function handleUpdate(env, u) {
  const from = (u.message && u.message.from) || (u.callback_query && u.callback_query.from);
  if (!from) return;
  const chatId = u.message ? u.message.chat.id : u.callback_query.message.chat.id;
  if (await handleLogin(env, u)) return;
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
    ORIGIN = url.origin;
    // «Открыть Колчан» from the bot: Telegram buttons can't open kolchan:// directly, this page does
    if (url.pathname === "/open") {
      const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Колчан</title>'
        + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121514;color:#e9ece9;font:16px -apple-system,system-ui,sans-serif;text-align:center}a{display:inline-block;margin-top:16px;padding:14px 22px;border-radius:14px;background:#7fc4a6;color:#0f1a14;font-weight:700;text-decoration:none}</style></head>'
        + '<body><div><div style="font-size:40px">📦</div><div>Возвращаемся в Колчан…</div><a href="kolchan://login">Открыть Колчан</a></div>'
        + '<script>location.href="kolchan://login"</script></body></html>';
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
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
