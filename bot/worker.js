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
export const BOT_VERSION = "1.0.0";

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

// ---------- views ----------
function showBag(d, b) {
  const inside = d.items.filter((i) => i.in === b.id);
  let s = "🎒 <b>" + esc(b.name) + "</b>\n📍 " + esc(bagWhere(b)) + "\n";
  s += inside.length ? "\n" + inside.map((i) => "• " + esc(i.name) + (i.missing ? " ⚠ не нашлась" : "")).join("\n") : "\nПустая.";
  return s;
}
function showPlace(d, path) {
  const P = norm(path), lp = P.map(low);
  const under = (parts) => lp.every((x, i) => low(parts[i] || "") === x);
  const loose = d.items.filter((i) => !i.in && under(i.parts || []));
  const bags = d.bags.filter((b) => under(norm(b.location)));
  let s = "📍 <b>" + esc(pathStr(P)) + "</b>\n";
  if (bags.length) s += "\n" + bags.map((b) => "🎒 " + esc(b.name) + " — " + nItems(d.items.filter((i) => i.in === b.id).length) + (norm(b.location).length > P.length ? " (" + esc(b.location) + ")" : "")).join("\n") + "\n";
  if (loose.length) {
    s += "\n" + loose.sort((a, b) => a.place.localeCompare(b.place, "ru") || a.name.localeCompare(b.name, "ru"))
      .map((i) => "• " + esc(i.name) + ((i.parts || []).length > P.length ? " — " + esc(pathStr(i.parts.slice(P.length))) : "") + (i.missing ? " ⚠" : "")).join("\n");
  }
  if (!bags.length && !loose.length) s += "\nЗдесь ничего нет.";
  return s;
}

// ---------- commands ----------
const HELP =
  "<b>Колчан</b> — где что лежит.\n\n" +
  "🔎 <b>Найти:</b> просто напиши название — <code>маска</code>\n" +
  "➕ <b>Добавить:</b> <code>+ Маска Smith → Дача</code>\n   несколько сразу: <code>+ носки, шапка → Eastpak</code>\n" +
  "⇄ <b>Переложить:</b> <code>маска → Сочи</code>, <code>маска → Eastpak</code>\n   сумку целиком: <code>Eastpak → Кировск</code>\n" +
  "   с заметкой: <code>маска → Дача // в стирке</code>\n" +
  "📍 <b>Показать:</b> название сумки или места — <code>Дача</code>, <code>Eastpak</code>\n\n" +
  "/places — места, /bags — сумки";

function kbd(rows) { return { inline_keyboard: rows }; }
function destButtons(d, prefix) {
  const btn = (text, data) => ({ text, callback_data: data });
  const rows = [];
  const pl = d.places.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((p) => btn("📍 " + p.name, prefix + "p:" + p.id));
  const bg = d.bags.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((b) => btn("🎒 " + b.name, prefix + "b:" + b.id));
  for (let i = 0; i < pl.length; i += 2) rows.push(pl.slice(i, i + 2));
  bg.forEach((b) => rows.push([b]));
  return rows;
}
function destFromCode(d, kind, id) {
  if (kind === "p") { const p = d.places.find((x) => x.id === id); return p ? { place: p.name } : null; }
  const b = bagById(d, id); return b ? { in: b.id } : null;
}
const CMD_MARK = "\n\n⤷ ";   // the original command is kept on the last line of bot questions
const withCmd = (text, cmd) => text + CMD_MARK + esc(cmd);

// returns { text, kb?, change? }  (change = commit message when data changed)
export function run(d, input, opt = {}) {
  let cmd = clean(input);
  if (/^\/start|^\/help/.test(cmd)) return { text: HELP };
  if (/^\/places/.test(cmd)) {
    const rows = d.places.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((p) => {
      const lp = low(p.name);
      const n = d.items.filter((i) => (!i.in && low((i.parts || [])[0]) === lp) || (i.in && low(norm((bagById(d, i.in) || {}).location)[0]) === lp)).length;
      return "📍 " + esc(p.name) + " — " + nItems(n);
    });
    return { text: rows.join("\n") || "Мест пока нет." };
  }
  if (/^\/bags/.test(cmd)) {
    return { text: d.bags.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((b) => "🎒 " + esc(b.name) + " — " + esc(bagWhere(b)) + ", " + nItems(d.items.filter((i) => i.in === b.id).length)).join("\n") || "Сумок пока нет." };
  }
  if (cmd.startsWith("/")) return { text: HELP };

  // note: "… // заметка"
  let note = "";
  const ni = cmd.indexOf("//");
  if (ni >= 0) { note = clean(cmd.slice(ni + 2)); cmd = clean(cmd.slice(0, ni)); }
  const arrow = cmd.match(/\s*(?:→|->|=>|—>|>>)\s*/);
  const what = clean(arrow ? cmd.slice(0, arrow.index) : cmd);
  const whereText = arrow ? clean(cmd.slice(arrow.index + arrow[0].length)) : "";
  const original = clean(input);

  // ----- add -----
  if (/^\+/.test(what)) {
    const names = what.replace(/^\+\s*/, "").split(",").map(clean).filter(Boolean);
    if (!names.length) return { text: "Напиши, что добавить: <code>+ Маска Smith → Дача</code>" };
    let dest = opt.dest || (whereText ? resolveDest(d, whereText) : null);
    if (!dest) return { text: withCmd("Куда положить: <b>" + esc(names.join(", ")) + "</b>?", original), kb: kbd(destButtons(d, "d:")) };
    if (dest.ambiguous) return { text: withCmd("Уточни, куда: «" + esc(whereText) + "»", original), kb: kbd(destButtons({ places: dest.places, bags: dest.bags }, "d:")) };
    if (dest.unknown) {
      if (!opt.allowNew) return { text: withCmd("Места «" + esc(dest.unknown) + "» нет. Создать?", original), kb: kbd([[{ text: "Создать «" + dest.unknown + "»", callback_data: "new" }]]) };
      ensurePlace(d, dest.unknown); dest = { place: dest.unknown };
    }
    const dup = names.filter((n) => d.items.some((i) => low(i.name) === low(n)));
    const added = names.map((n) => addItem(d, n, dest));
    if (note) added.forEach((it) => { it.log[0].note = note; });
    return {
      text: "➕ " + added.map((i) => "<b>" + esc(i.name) + "</b>").join(", ") + " → " + esc(labelFor(d, dest)) + (note ? "\n📝 " + esc(note) : "") +
        (dup.length ? "\n\nℹ️ Уже были вещи с таким названием: " + esc(dup.join(", ")) + ". Добавил ещё одну." : ""),
      change: "Бот: добавлено " + names.join(", "),
    };
  }

  // ----- move -----
  if (arrow) {
    if (!what) return { text: "Напиши, что переложить: <code>маска → Сочи</code>" };
    let target = opt.target || null;
    const byId = what.match(/^@([ib]):(\S+)$/);
    if (!target && byId) {
      const o = byId[1] === "b" ? bagById(d, byId[2]) : d.items.find((i) => i.id === byId[2]);
      if (!o) return { text: "Не нашёл — может, уже удалено." };
      target = { kind: byId[1], o };
    }
    if (!target) {
      const f = findThings(d, what);
      const all = f.items.map((i) => ({ kind: "i", o: i })).concat(f.bags.map((b) => ({ kind: "b", o: b })));
      if (!all.length) return { text: "Не нашёл «" + esc(what) + "». Чтобы добавить новую вещь: <code>+ " + esc(what) + (whereText ? " → " + esc(whereText) : "") + "</code>" };
      if (all.length > 1) {
        const rows = all.slice(0, 20).map((x) => [{ text: (x.kind === "b" ? "🎒 " : "") + x.o.name + " — " + (x.kind === "b" ? bagWhere(x.o) : itemWhere(d, x.o)), callback_data: "t:" + x.kind + ":" + x.o.id }]);
        return { text: withCmd("Что именно переложить?" + (all.length > 20 ? " Показал первые 20 — напиши точнее." : ""), original), kb: kbd(rows) };
      }
      target = all[0];
    }
    const tCode = target.kind + ":" + target.o.id;
    const tCmd = "@" + tCode + " → " + whereText + (note ? " // " + note : "");
    const forBag = target.kind === "b";
    if (!whereText && !opt.dest) return { text: "Куда переложить <b>" + esc(target.o.name) + "</b>?", kb: kbd(destButtons(forBag ? { places: d.places, bags: [] } : d, "md:" + tCode + ":")) };
    let dest = opt.dest || resolveDest(d, whereText);
    if (dest.ambiguous) return { text: "Уточни, куда переложить <b>" + esc(target.o.name) + "</b>:", kb: kbd(destButtons({ places: dest.places, bags: forBag ? [] : dest.bags }, "md:" + tCode + ":")) };
    if (dest.unknown) {
      if (!opt.allowNew) return { text: withCmd("<b>" + esc(target.o.name) + "</b>: места «" + esc(dest.unknown) + "» нет. Создать?", tCmd), kb: kbd([[{ text: "Создать «" + dest.unknown + "»", callback_data: "new" }]]) };
      ensurePlace(d, dest.unknown); dest = { place: dest.unknown };
    }
    if (target.kind === "b") {
      if (dest.in) return { text: "Сумку можно переложить только в место, не в другую сумку." };
      const b = target.o;
      if (!moveBag(d, b, dest.place, note)) return { text: "🎒 <b>" + esc(b.name) + "</b> уже там: " + esc(b.location) };
      const n = d.items.filter((i) => i.in === b.id).length;
      return { text: "⇄ 🎒 <b>" + esc(b.name) + "</b> → " + esc(dest.place) + (n ? " (вместе с ней " + nItems(n) + ")" : "") + (note ? "\n📝 " + esc(note) : ""), change: "Бот: " + b.name + " → " + dest.place };
    }
    const it = target.o;
    if (dest.in === it.id) return { text: "Нельзя положить вещь саму в себя." };
    if (!moveItem(d, it, dest, note)) return { text: "<b>" + esc(it.name) + "</b> уже там: " + esc(itemWhere(d, it)) };
    return { text: "⇄ <b>" + esc(it.name) + "</b> → " + esc(labelFor(d, dest)) + (note ? "\n📝 " + esc(note) : ""), change: "Бот: " + it.name + " → " + labelFor(d, dest) };
  }

  // ----- show / find -----
  const q = clean(what.replace(/^(где|найди|найти|покажи|показать)\s+/i, "").replace(/\?$/, ""));
  if (!q) return { text: HELP };
  const paths = allPaths(d);
  const pq = pathStr(norm(q));
  if (paths.has(low(pq))) return { text: showPlace(d, paths.get(low(pq))) };
  const exB = d.bags.filter((b) => low(b.name) === low(q));
  if (exB.length === 1) return { text: showBag(d, exB[0]), kb: kbd([[{ text: "⇄ Переложить сумку", callback_data: "m:b:" + exB[0].id }]]) };
  const f = findThings(d, q);
  const placeHits = d.places.filter((p) => matches(p.name, q));
  if (!f.items.length && f.bags.length === 1 && !placeHits.length) return { text: showBag(d, f.bags[0]), kb: kbd([[{ text: "⇄ Переложить сумку", callback_data: "m:b:" + f.bags[0].id }]]) };
  if (!f.items.length && !f.bags.length && placeHits.length === 1) return { text: showPlace(d, placeHits[0].name) };
  if (!f.items.length && !f.bags.length && !placeHits.length) return { text: "Не нашёл «" + esc(q) + "».\nДобавить: <code>+ " + esc(q) + " → место</code>" };
  if (f.items.length === 1 && !f.bags.length) {
    const it = f.items[0];
    const last = (it.log || []).slice(-1)[0];
    return {
      text: "<b>" + esc(it.name) + "</b>\n📍 " + esc(itemWhere(d, it)) + (it.missing ? "\n⚠ отмечена как не нашлась" : "") + (it.note ? "\n📝 " + esc(it.note) : "") +
        (last && last.note ? "\n🕓 " + esc(last.note) : ""),
      kb: kbd([[{ text: "⇄ Переложить", callback_data: "m:i:" + it.id }]]),
    };
  }
  let s = "";
  if (f.bags.length) s += f.bags.map((b) => "🎒 <b>" + esc(b.name) + "</b> — " + esc(bagWhere(b))).join("\n") + "\n";
  if (placeHits.length) s += placeHits.map((p) => "📍 <b>" + esc(p.name) + "</b>").join("\n") + "\n";
  const list = f.items.slice(0, 30);
  s += list.map((i) => "• <b>" + esc(i.name) + "</b> — " + esc(itemWhere(d, i)) + (i.missing ? " ⚠" : "")).join("\n");
  if (f.items.length > 30) s += "\n…и ещё " + (f.items.length - 30) + ". Напиши точнее.";
  return { text: s.trim() };
}

// ---------- callbacks ----------
// t:<i|b>:<id>   — picked a target for the command on the last line
// d:<p|b>:<id>   — picked a destination for the command on the last line
// new            — confirm creating a new place for the command on the last line
// m:<i|b>:<id>   — "Переложить" under a search result → show destinations
// md:<i|b>:<id>:<p|b>:<did> — move chosen from that list
export function runCallback(d, data, msgText) {
  const cmd = msgText.includes(CMD_MARK.trim()) ? clean(msgText.slice(msgText.lastIndexOf(CMD_MARK.trim()) + CMD_MARK.trim().length)) : "";
  const p = data.split(":");
  if (p[0] === "m") {
    const o = p[1] === "b" ? bagById(d, p[2]) : d.items.find((i) => i.id === p[2]);
    if (!o) return { text: "Не нашёл — может, уже удалено." };
    const rows = destButtons(p[1] === "b" ? { places: d.places, bags: [] } : d, "md:" + p[1] + ":" + p[2] + ":");
    return { text: "Куда переложить <b>" + esc(o.name) + "</b>?", kb: kbd(rows), edit: true };
  }
  if (p[0] === "md") {
    const target = p[1] === "b" ? { kind: "b", o: bagById(d, p[2]) } : { kind: "i", o: d.items.find((i) => i.id === p[2]) };
    const dest = destFromCode(d, p[3], p[4]);
    if (!target.o || !dest) return { text: "Не нашёл — может, уже удалено.", edit: true };
    return Object.assign(run(d, target.o.name + " → x", { target, dest }), { edit: true });
  }
  if (!cmd) return { text: "Не понял, к чему эта кнопка. Напиши команду ещё раз.", edit: true };
  const opt = {};
  if (p[0] === "t") { const o = p[1] === "b" ? bagById(d, p[2]) : d.items.find((i) => i.id === p[2]); if (!o) return { text: "Не нашёл — может, уже удалено.", edit: true }; opt.target = { kind: p[1], o }; }
  if (p[0] === "d") { opt.dest = destFromCode(d, p[1], p[2]); if (!opt.dest) return { text: "Не нашёл это место.", edit: true }; }
  if (p[0] === "new") opt.allowNew = true;
  return Object.assign(run(d, cmd, opt), { edit: true });
}

// ---------- Telegram ----------
async function tg(env, method, body) {
  const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
// Telegram allows 4096 characters per message: split long lists by lines
function chunks(text, max = 3900) {
  const out = []; let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > max) { out.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) out.push(cur);
  return out;
}
async function reply(env, chatId, res, editMsgId) {
  const parts = chunks(res.text);
  for (const extra of parts.slice(0, -1)) {
    if (editMsgId) { await tg(env, "editMessageText", { chat_id: chatId, message_id: editMsgId, text: extra, parse_mode: "HTML" }); editMsgId = null; }
    else await tg(env, "sendMessage", { chat_id: chatId, text: extra, parse_mode: "HTML", disable_web_page_preview: true });
  }
  const body = { chat_id: chatId, text: parts[parts.length - 1] || "…", parse_mode: "HTML", disable_web_page_preview: true };
  if (res.kb) body.reply_markup = res.kb;
  if (editMsgId) { body.message_id = editMsgId; const r = await tg(env, "editMessageText", body); if (r.ok) return; delete body.message_id; }
  await tg(env, "sendMessage", body);
}

// load → run → save, retrying once if someone (the phone) wrote in between
async function transact(env, fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await load(env);
    const res = fn(data);
    if (!res.change) return res;
    try { await save(env, data, sha, res.change); return res; }
    catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 2) continue; throw e; }
  }
}

async function handleUpdate(env, u) {
  const from = (u.message && u.message.from) || (u.callback_query && u.callback_query.from);
  if (!from) return;
  const chatId = u.message ? u.message.chat.id : u.callback_query.message.chat.id;
  if (!env.OWNER_ID) {
    await reply(env, chatId, { text: "Твой Telegram ID: <code>" + from.id + "</code>\nВпиши его в переменную OWNER_ID в настройках Worker." });
    return;
  }
  if (String(from.id) !== String(env.OWNER_ID)) return;   // чужим не отвечаем
  try {
    if (u.message) {
      const text = u.message.text || u.message.caption || "";
      if (!text) { await reply(env, chatId, { text: "Пока понимаю только текст." }); return; }
      const res = await transact(env, (d) => run(d, text));
      await reply(env, chatId, res);
    } else {
      const cq = u.callback_query;
      await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
      const res = await transact(env, (d) => runCallback(d, cq.data || "", cq.message.text || ""));
      await reply(env, chatId, res, res.edit ? cq.message.message_id : null);
    }
  } catch (e) {
    const why = e.status === 401 ? "токен GitHub не подходит или истёк" : e.status === 404 || e.status === 403 ? "нет доступа к " + env.REPO + " (проверь REPO и права токена)" : String(e.message || e);
    await reply(env, chatId, { text: "⚠ Не получилось: " + esc(why) });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/setup") {
      if (!env.HOOK_SECRET || url.searchParams.get("key") !== env.HOOK_SECRET) return new Response("Неверный key", { status: 403 });
      const hook = await tg(env, "setWebhook", { url: url.origin + "/tg", secret_token: env.HOOK_SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
      await tg(env, "setMyCommands", { commands: [{ command: "places", description: "Места" }, { command: "bags", description: "Сумки" }, { command: "help", description: "Как пользоваться" }] });
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
