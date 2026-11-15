// QA навыка Алисы: вход (alice-auth) и разговор (alice) против поддельного Supabase в памяти.
// node qa/alice.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(import.meta.url), "../..");
const dir = mkdtempSync(join(tmpdir(), "alice-"));
const load = async (name) => { const p = join(dir, name + ".mjs"); writeFileSync(p, readFileSync(join(root, "supabase/functions", name, "index.ts"), "utf8")); return import(pathToFileURL(p)); };
const { makeAuth } = await load("alice-auth");
const { makeSkill, score } = await load("alice");

// ---------- поддельный Supabase ----------
const db = { alice_links: [], alice_codes: [], records: [] };
const jwts = { "jwt-alexey": "u1", "jwt-galya": "u2" };
const URL_ = "https://x.supabase.co", KEY = "service";
async function fakeFetch(u, o = {}) {
  const url = new URL(u), m = (o.method || "GET").toUpperCase(), h = o.headers || {};
  const J = (b, s = 200) => new Response(b === null ? null : JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  if (url.pathname === "/auth/v1/user") { const id = jwts[(h.Authorization || "").replace("Bearer ", "")]; return id ? J({ id }) : J({ msg: "bad jwt" }, 401); }
  if (h.apikey !== KEY || h.Authorization !== "Bearer " + KEY) return J({ message: "no service key" }, 401);
  const t = url.pathname.replace("/rest/v1/", ""), rows = db[t];
  const f = []; url.searchParams.forEach((v, k) => { if (v.startsWith("eq.")) f.push([k, v.slice(3)]); });
  const match = (r) => f.every(([k, v]) => String(r[k]) === v);
  if (m === "GET") return J(rows.filter(match));
  if (m === "DELETE") { db[t] = rows.filter(r => !match(r)); return J(null, 204); }
  if (m === "PATCH") { rows.filter(match).forEach(r => Object.assign(r, JSON.parse(o.body))); return J(null, 204); }
  if (m === "POST") {
    for (const r of [].concat(JSON.parse(o.body))) {
      if (t === "records") { const i = rows.findIndex(x => x.user_id === r.user_id && x.coll === r.coll && x.id === r.id); i >= 0 ? rows[i] = r : rows.push(r); }
      else rows.push(Object.assign({ id: "L" + rows.length }, r));
    }
    return J(null, 201);
  }
}
const rec = (user, coll, id, data) => db.records.push({ user_id: user, coll, id, data, deleted: false });
rec("u1", "places", "p1", { name: "Дача" }); rec("u1", "places", "p2", { name: "Дом" });
rec("u1", "bags", "b1", { name: "Рюкзак Eastpak", location: "Дача" });
rec("u1", "bags", "b2", { name: "Чехол Nitro", location: "В пути", dest: "Шерегеш" });
rec("u1", "items", "i1", { name: "Маска Smith", in: "b1", place: "" });
rec("u1", "items", "i2", { name: "Дрель", place: "Дом / Шкаф", in: null });
rec("u1", "items", "i3", { name: "Носки белые", place: "Дача", in: null });
rec("u1", "items", "i4", { name: "Носки шерстяные", in: "b2", place: "" });
rec("u1", "items", "i5", { name: "Доска Howler", in: "b2", place: "" });
rec("u2", "items", "g1", { name: "Маска Галины", place: "Дом", in: null });

let fails = 0, n = 0;
const check = (ok, what, got) => { n++; if (!ok) { fails++; console.log("❌ " + what + (got !== undefined ? " — " + JSON.stringify(got) : "")); } else console.log("✅ " + what); };

// ---------- вход ----------
const auth = makeAuth({ url: URL_, key: KEY, clientId: "kolchan", clientSecret: "s3cret", appUrl: "https://ducktail1.github.io/Kolchan/beta/", fetch: fakeFetch });
const F = "https://x.supabase.co/functions/v1/alice-auth";
const RED = "https://social.yandex.net/broker/redirect";
let r = await auth(new Request(F + "/authorize?client_id=kolchan&redirect_uri=" + encodeURIComponent(RED) + "&state=ST1&response_type=code"));
const loc = r.headers.get("location") || "";
check(r.status === 302 && loc.startsWith("https://ducktail1.github.io/Kolchan/beta/?alice=1") && loc.includes("state=ST1"), "authorize → в Колчан с state", loc);
r = await auth(new Request(F + "/authorize?client_id=evil&redirect_uri=" + encodeURIComponent(RED)));
check(r.status === 400, "чужой client_id не пускаем");
r = await auth(new Request(F + "/authorize?client_id=kolchan&redirect_uri=" + encodeURIComponent("https://evil.com/x")));
check(r.status === 400, "чужой redirect_uri не пускаем");
r = await auth(new Request(F + "/code", { method: "POST", headers: { authorization: "Bearer nope" }, body: JSON.stringify({ redirect_uri: RED, state: "ST1" }) }));
check(r.status === 401, "код без входа не выдаём");
r = await auth(new Request(F + "/code", { method: "POST", headers: { authorization: "Bearer jwt-alexey" }, body: JSON.stringify({ redirect_uri: "https://evil.com/cb", state: "ST1" }) }));
check(r.status === 400, "код на чужой адрес не выдаём");
r = await auth(new Request(F + "/code", { method: "POST", headers: { authorization: "Bearer jwt-alexey" }, body: JSON.stringify({ redirect_uri: RED, state: "ST1" }) }));
const back = new URL((await r.json()).url), code = back.searchParams.get("code");
check(back.origin + back.pathname === RED && back.searchParams.get("state") === "ST1" && code, "код → обратно в Яндекс с state");
check(!JSON.stringify(db.alice_codes).includes(code), "код в базе только хешем");
const form = (o) => new URLSearchParams(o).toString();
r = await auth(new Request(F + "/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", code, client_id: "kolchan", client_secret: "wrong" }) }));
check(r.status === 401, "неверный секрет клиента");
r = await auth(new Request(F + "/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + btoa("kolchan:s3cret") }, body: form({ grant_type: "authorization_code", code, redirect_uri: RED }) }));
const tok = await r.json();
check(r.status === 200 && tok.access_token && tok.refresh_token && tok.token_type === "bearer", "код → токен (Basic)", tok);
r = await auth(new Request(F + "/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", code, client_id: "kolchan", client_secret: "s3cret" }) }));
check(r.status === 400, "код одноразовый");
r = await auth(new Request(F + "/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: "kolchan", client_secret: "s3cret" }) }));
const tok2 = await r.json();
check(r.status === 200 && tok2.access_token !== tok.access_token && db.alice_links.length === 1, "refresh → новый токен, старый удалён", db.alice_links.length);
check(!JSON.stringify(db.alice_links).includes(tok2.access_token), "токены в базе только хешем");

// ---------- навык ----------
const skill = makeSkill({ url: URL_, key: KEY, fetch: fakeFetch, now: () => 1763200000000 });
const ask = async (text, token = tok2.access_token, state) => {
  const res = await skill(new Request("https://x.supabase.co/functions/v1/alice", { method: "POST", headers: token ? { authorization: "Bearer " + token } : {}, body: JSON.stringify({ version: "1.0", session: { new: false, skill_id: "sk" }, request: { command: text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ""), original_utterance: text }, state: { session: state || {} } }) }));
  return res.json();
};
let a = await ask("где маска", "");
check(a.start_account_linking !== undefined, "без привязки — просим войти");
a = await ask("где маска", "ka_wrong");
check(a.start_account_linking !== undefined, "чужой токен — просим войти");
a = await ask("ping", "");
check(a.response.text === "pong", "ping без входа");
a = await ask("Где маска?");
check(/Маска Smith — Рюкзак Eastpak, Дача/.test(a.response.text) && !/Галин/.test(a.response.text), "где маска → рюкзак на даче, чужих не видно", a.response.text);
a = await ask("где лежат носки");
check(/Носки белые — Дача/.test(a.response.text) && /Носки шерстяные — Чехол Nitro, в пути в Шерегеш/.test(a.response.text), "носки: обе пары, одна в пути", a.response.text);
a = await ask("найди дрель");
check(/Дрель — Дом \/ Шкаф/.test(a.response.text), "найди дрель", a.response.text);
a = await ask("где утюг");
check(/Не нашла/.test(a.response.text), "нет такой вещи", a.response.text);
a = await ask("что в рюкзаке");
check(/В «Рюкзак Eastpak»: Маска Smith/.test(a.response.text), "что в рюкзаке", a.response.text);
a = await ask("что лежит на даче");
check(/В «Дача» 1 сумка и 1 вещь\. Сумки: Рюкзак Eastpak\. Вещи: Носки белые/.test(a.response.text), "что на даче: сумки и вещи", a.response.text);
a = await ask("добавь баф в рюкзак");
let it = db.records.find(x => x.user_id === "u1" && x.data.name === "Баф");
check(/Добавила «Баф» в «Рюкзак Eastpak»/.test(a.response.text) && it && it.data.in === "b1" && it.data.log[0].kind === "move", "добавь баф в рюкзак", a.response.text);
a = await ask("положи носки в полоску на дачу");
it = db.records.find(x => x.data.name === "Носки в полоску");
check(it && it.data.place === "Дача" && !it.data.in, "«в полоску» — часть названия, место — дача", a.response.text);
a = await ask("добавь термос");
check(/Куда положить «Термос»/.test(a.response.text) && a.session_state.await === "where", "без места — спрашивает куда", a);
a = await ask("в чехол", undefined, a.session_state);
it = db.records.find(x => x.data.name === "Термос");
check(it && it.data.in === "b2", "ответ «в чехол» → в Чехол Nitro", a.response.text);
a = await ask("добавь фонарик"); a = await ask("без места", undefined, a.session_state);
it = db.records.find(x => x.data.name === "Фонарик");
check(it && !it.data.in && it.data.place === "", "«без места»", a.response.text);
a = await ask("Howler где");
check(/Доска Howler — Чехол Nitro/.test(a.response.text), "«Howler где»", a.response.text);
a = await ask("маска");
check(/Маска Smith/.test(a.response.text), "просто название — ищет", a.response.text);
a = await ask("помощь");
check(/где маска/.test(a.response.text), "помощь", a.response.text);
check(score("маску", "Маска") > 0 && score("носков", "Носки белые") > 0 && score("дрель", "Маска") === 0, "русские окончания");

console.log(fails ? "\n❌ Упало " + fails + " из " + n : "\n✅ Все " + n + " проверок прошли");
process.exit(fails ? 1 : 0);
