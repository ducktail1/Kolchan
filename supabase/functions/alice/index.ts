// @ts-nocheck — код без типов, чтобы его можно было проверять и в Node
// Колчан: навык Алисы. Supabase → Edge Functions → alice. В настройках функции выключить «Verify JWT».
// Адрес функции указывается в Яндекс Диалогах как Webhook URL навыка.
// Необязательно: секрет ALICE_SKILL_ID — тогда функция отвечает только своему навыку.
//
// Что понимает (после привязки аккаунта через alice-auth):
//   «где маска», «найди дрель», «где лежат носки»      → где лежит
//   «что в рюкзаке», «что лежит на даче»               → что внутри сумки / места
//   «добавь маску в рюкзак», «положи дрель на дачу»    → новая вещь (без места — спросит, куда)
//   «помощь», «что ты умеешь»

const env = (k, d = "") => (globalThis.Deno ? Deno.env.get(k) : globalThis.process && process.env[k]) || d;
const TRANSIT = "в пути";

// ---------- русские слова: грубая основа, чтобы «маску» нашла «Маска» ----------
const END = ["иями", "ями", "ами", "ого", "его", "ому", "ему", "ыми", "ими", "ой", "ей", "ий", "ый", "ая", "яя", "ое", "ее", "ую", "юю", "ом", "ем", "ам", "ям", "ах", "ях", "ов", "ев", "ки", "ку", "ке", "кой", "а", "я", "о", "е", "у", "ю", "ы", "и", "ь", "й"];
export const words = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/i).filter(Boolean);
export const stem = (w) => { if (w.length <= 3) return w; for (const e of END) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length); return w; };
const STOP = new Set(["мой", "моя", "мое", "мои", "моих", "мою", "у", "меня", "мне", "мы", "наш", "наша", "наши", "в", "во", "на", "с", "со", "и", "же", "ли", "а", "там", "сейчас", "вообще", "пожалуйста", "колчан", "колчане", "колчана", "колчану"]);
const stems = (s) => words(s).filter(w => !STOP.has(w)).map(stem);
// насколько название подходит под запрос: 0 — нет, больше — лучше
export function score(query, name) {
  const q = stems(query), n = stems(name);
  if (!q.length || !n.length) return 0;
  let hit = 0;
  for (const a of q) if (n.some(b => b === a || (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b)))) hit++;
  if (hit < q.length) return 0;
  return hit * 10 - (n.length - hit) + (n.length === q.length ? 5 : 0);
}

// ---------- склейка ответа ----------
const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase("ru") + s.slice(1) : s);
const plural = (n, f) => f[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
const list = (arr, max = 3) => arr.length <= max ? arr.join(", ") : arr.slice(0, max).join(", ") + " и ещё " + (arr.length - max);

export function makeSkill(cfg) {
  const { url, key, skillId } = cfg;
  const fetchFn = cfg.fetch || fetch;
  const now = cfg.now || (() => Date.now());
  const H = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  const rest = (p, o = {}) => fetchFn(url + "/rest/v1/" + p, Object.assign({}, o, { headers: Object.assign({}, H, o.headers || {}) }));
  const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), b => b.toString(16).padStart(2, "0")).join("");
  const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);

  async function whoIs(token) {
    if (!token) return null;
    const h = await sha(token);
    const r = await rest("alice_links?token_hash=eq." + h + "&select=id,user_id");
    const row = r.ok ? (await r.json())[0] : null;
    if (row) rest("alice_links?id=eq." + row.id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_used: new Date(now()).toISOString() }) }).catch(() => {});
    return row ? row.user_id : null;
  }
  async function load(user) {
    const out = { places: [], bags: [], items: [], quivers: [] };
    for (let from = 0; ; from += 1000) {
      const r = await rest("records?user_id=eq." + user + "&deleted=eq.false&select=coll,id,data&order=coll,id", { headers: { Range: from + "-" + (from + 999), "Range-Unit": "items" } });
      if (!r.ok) throw new Error("records " + r.status);
      const rows = await r.json();
      rows.forEach(x => { if (out[x.coll]) out[x.coll].push(Object.assign({}, x.data, { id: x.id })); });
      if (rows.length < 1000) break;
    }
    return out;
  }
  const qName = (d, q) => { if (!q || q === "main") return ""; const x = d.quivers.find(y => y.id === q); return x ? x.name : ""; };
  function whereOf(d, it) {
    let s;
    if (it.in) {
      const b = d.bags.find(x => x.id === it.in);
      if (!b) s = "в сумке";
      else if ((b.location || "").toLowerCase() === TRANSIT) s = b.name + ", в пути" + (b.dest ? " в " + b.dest : "");
      else s = b.name + (b.location ? ", " + b.location : "");
    } else s = it.place || "без места";
    const q = qName(d, it.q);
    return s + (q ? " (колчан «" + q + "»)" : "");
  }
  // сумки и места, куда можно положить
  function targets(d) {
    const t = d.bags.map(b => ({ kind: "bag", name: b.name, bag: b }));
    const seen = new Set();
    const addPlace = (p) => { if (!p) return; const k = p.toLowerCase(); if (seen.has(k) || k === TRANSIT) return; seen.add(k); t.push({ kind: "place", name: p }); };
    d.places.forEach(p => addPlace(p.name)); d.items.forEach(i => addPlace(i.place)); d.bags.forEach(b => addPlace(b.location));
    return t;
  }
  const best = (arr, q, nameOf) => arr.map(x => ({ x, s: score(q, nameOf(x)) })).filter(z => z.s > 0).sort((a, b) => b.s - a.s);

  function find(d, q) {
    // сначала основной колчан, потом остальные (поездки, другие колчаны)
    const hits = best(d.items, q, i => i.name).sort((a, b) => (a.x.q ? 1 : 0) - (b.x.q ? 1 : 0) || b.s - a.s);
    if (!hits.length) return "Не нашла «" + q + "» в Колчане.";
    const parts = hits.map(h => cap(h.x.name) + " — " + whereOf(d, h.x));
    return parts.length === 1 ? parts[0] + "." : parts.length > 3 ? "Нашла " + parts.length + ". " + list(parts, 3) + "." : list(parts, 3) + ".";
  }
  function inside(d, q) {
    const tg = best(targets(d), q, t => t.name);
    if (!tg.length) return "Не нашла сумку или место «" + q + "».";
    const t = tg[0].x;
    if (t.kind === "bag") {
      const its = d.items.filter(i => i.in === t.bag.id).map(i => i.name);
      return its.length ? "В «" + t.name + "»: " + list(its, 6) + "." : "Сумка «" + t.name + "» пустая.";
    }
    const low = t.name.toLowerCase();
    const its = d.items.filter(i => !i.in && ((i.place || "").toLowerCase() === low || (i.place || "").toLowerCase().startsWith(low + " /"))).map(i => i.name);
    const bs = d.bags.filter(b => (b.location || "").toLowerCase() === low).map(b => b.name);
    if (!its.length && !bs.length) return "В «" + t.name + "» ничего нет.";
    const head = "В «" + t.name + "» " + [bs.length ? bs.length + " " + plural(bs.length, ["сумка", "сумки", "сумок"]) : "", its.length ? its.length + " " + plural(its.length, ["вещь", "вещи", "вещей"]) : ""].filter(Boolean).join(" и ") + ".";
    return head + (bs.length ? " Сумки: " + list(bs, 4) + "." : "") + (its.length ? " Вещи: " + list(its, 6) + "." : "");
  }
  async function add(user, d, name, dest) {
    const t = now();
    const item = { name: cap(name.trim()), place: "", parts: [], in: null, qty: "", note: "", photo: null, missing: false, updatedAt: t, log: [] };
    let where;
    if (dest && dest.kind === "bag") { item.in = dest.bag.id; item.log = [{ t, kind: "move", to: "в «" + dest.bag.name + "»", in: dest.bag.id, note: "Алиса" }]; where = "в «" + dest.bag.name + "»"; }
    else if (dest && dest.kind === "place") { item.place = dest.name; item.parts = dest.name.split("/").map(x => x.trim()).filter(Boolean); item.log = [{ t, kind: "move", to: dest.name, in: null, note: "Алиса" }]; where = "в «" + dest.name + "»"; }
    else where = "без места";
    if (dest && dest.bag && dest.bag.q) item.q = dest.bag.q;
    const r = await rest("records?on_conflict=user_id,coll,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ user_id: user, coll: "items", id: uid(), data: item, deleted: false }]) });
    if (!r.ok) throw new Error("add " + r.status);
    return "Добавила «" + item.name + "» " + where + ".";
  }
  // «маску в рюкзак» → имя + место; ищем последнее «в/во/на», после которого — известная сумка или место
  function splitAdd(d, rest_) {
    const w = rest_.split(/\s+/);
    for (let i = w.length - 2; i >= 1; i--) {
      if (!/^(в|во|на)$/i.test(w[i])) continue;
      const name = w.slice(0, i).join(" "), q = w.slice(i + 1).join(" ");
      const tg = best(targets(d), q, t => t.name);
      if (tg.length) return { name, dest: tg[0].x };
    }
    return { name: rest_, dest: null };
  }

  const HELP = "Спроси: «где маска», «что в рюкзаке» или скажи «добавь дрель на дачу».";
  const say = (text, end = false, state) => ({ response: { text, end_session: end }, session_state: state || {}, version: "1.0" });

  return async function handle(req) {
    if (req.method !== "POST") return new Response("Колчан: навык Алисы", { status: 200 });
    const body = await req.json().catch(() => ({}));
    const reply = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
    const rq = body.request || {}, ses = body.session || {}, st = (body.state && body.state.session) || {};
    if (skillId && ses.skill_id && ses.skill_id !== skillId) return new Response("forbidden", { status: 403 });
    const utt = String(rq.original_utterance || "").trim();
    if (utt.toLowerCase() === "ping") return reply(say("pong"));
    const cmd = String(rq.command || utt).toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9\s]/g, " ").replace(/\s+/g, " ").trim();

    // аккаунт привязан?
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || (ses.user && ses.user.access_token) || "";
    const user = await whoIs(token);
    if (!user) return reply({ start_account_linking: {}, version: "1.0" });

    try {
      if (!cmd || /^(привет|здравствуй|запусти|открой|начать)/.test(cmd)) return reply(say("Колчан на связи. " + HELP));
      if (/^(помощь|помоги|что ты умеешь|что умеешь|справка)/.test(cmd)) return reply(say(HELP));
      if (/^(хватит|стоп|все|выход|спасибо)$/.test(cmd)) return reply(say("Хорошо.", true));
      const d = await load(user);

      // ждали ответа «куда положить»
      if (st.await === "where" && st.name) {
        if (/^(никуда|без места|не знаю|потом)/.test(cmd)) return reply(say(await add(user, d, st.name, null)));
        const tg = best(targets(d), cmd.replace(/^(в|во|на)\s+/, ""), t => t.name);
        if (tg.length) return reply(say(await add(user, d, st.name, tg[0].x)));
        return reply(say("Не нашла «" + cmd + "». Куда положить «" + st.name + "»? Назови сумку или место, или скажи «без места».", false, st));
      }

      let m;
      if ((m = cmd.match(/^(?:добавь|добавить|положи|положить|запиши|запомни)\s+(.+)$/))) {
        const { name, dest } = splitAdd(d, m[1]);
        if (dest) return reply(say(await add(user, d, name, dest)));
        return reply(say("Куда положить «" + cap(name) + "»?", false, { await: "where", name }));
      }
      if ((m = cmd.match(/^(?:что|чего)\s+(?:у меня\s+)?(?:лежит\s+|есть\s+|внутри\s+)?(?:в|во|на)\s+(.+)$/))) return reply(say(inside(d, m[1])));
      if ((m = cmd.match(/^(?:где|найди|найти|поищи|ищи|покажи)\s+(?:у меня\s+)?(?:лежит\s+|лежат\s+|находится\s+|находятся\s+)?(.+)$/))) return reply(say(find(d, m[1])));
      if ((m = cmd.match(/^(.+?)\s+где$/))) return reply(say(find(d, m[1])));
      // просто название — ищем вещь
      const hits = best(d.items, cmd, i => i.name);
      if (hits.length) return reply(say(find(d, cmd)));
      return reply(say("Не поняла. " + HELP));
    } catch (e) {
      console.error(e);
      return reply(say("Не получилось открыть Колчан, попробуй позже."));
    }
  };
}

if (globalThis.Deno) {
  Deno.serve(makeSkill({ url: env("SUPABASE_URL"), key: env("SUPABASE_SERVICE_ROLE_KEY"), skillId: env("ALICE_SKILL_ID") }));
}
