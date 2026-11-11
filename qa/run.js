// QA Колчана: прогоняет все основные сценарии на собранном сайте (корень = основной, beta/ = бета)
// с поддельным Supabase. Запуск: node qa/run.js [папка со сборкой, по умолчанию корень репо]
// Итог — таблица в консоли и qa/report.md; код выхода 1, если что-то упало.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium, devices } = require("playwright");
const { createMock } = require("./mock-supabase");

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = "http://localhost:" + PORT + "/";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});

const results = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function check(cond, msg) { if (!cond) throw new Error(msg); }

let browser, mock;
// a phone: new context, optional signed-in user (session put straight into the app's storage)
async function phone(opt = {}) {
  const ctx = await browser.newContext(Object.assign({}, devices["iPhone 13"], { serviceWorkers: "block" }));
  await ctx.route(/supabase\.co/, mock.handle);
  const p = await ctx.newPage();
  p.errs = []; p.on("pageerror", e => p.errs.push(e.message));
  p.on("dialog", d => { p.errs.push("dialog: " + d.message()); d.dismiss(); });
  const url = BASE + (opt.beta ? "beta/" : "");
  await p.goto(url); await sleep(1200);
  if (opt.uid) {
    const s = mock.session(opt.uid), u = mock.users.get(opt.uid);
    await p.evaluate(([s, u]) => window.__kolchan.put("meta", { key: "cloudSession", access_token: s.access_token, refresh_token: s.refresh_token, expires_at: Date.now() + 3600e3, user: { id: u.id, email: u.email, meta: { name: u.name } } }), [s, u]);
    await p.goto("about:blank"); await p.goto(opt.hash ? url + opt.hash : url); await sleep(2500);
  }
  await p.evaluate(() => { for (const id of ["wel-bg", "inst-bg"]) { const e = document.getElementById(id); if (e) e.hidden = true; } });
  p.ctx = ctx;
  return p;
}
const all = (p, c) => p.evaluate((c) => window.__kolchan.all(c), c);
const names = async (p, c) => (await all(p, c)).map(x => x.name);
async function sync(p) {
  await p.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await sleep(2500);
}
async function closeSheets(p) { await p.evaluate(() => document.querySelectorAll(".sheet-bg").forEach(b => { if (b.id !== "acc-bg") b.hidden = true; })); }

async function scenario(name, fn) {
  const t0 = Date.now(); let ok = true, err = "";
  const opened = [];
  try { await fn(opened); } catch (e) { ok = false; err = String(e.message || e).split("\n")[0].slice(0, 300); }
  for (const p of opened) { if (p.errs && p.errs.length && ok) { ok = false; err = "ошибка на странице: " + p.errs[0].slice(0, 200); } try { await p.ctx.close(); } catch (e) {} }
  results.push({ name, ok, err, s: ((Date.now() - t0) / 1000).toFixed(1) });
  console.log((ok ? "✅ " : "❌ ") + name + (ok ? "" : " — " + err));
}
const track = (opened, p) => { opened.push(p); return p; };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  browser = await chromium.launch();

  // ---------- 1. Первый запуск без аккаунта: место, сумка, вещи ----------
  await scenario("Первый запуск: место, сумка, вещи, поиск", async (o) => {
    mock = createMock();
    const p = track(o, await phone());
    check(await p.isVisible("#acc-local-go"), "нет кнопки «Использовать локально»");
    await p.click("#acc-local-go"); await sleep(400); await closeSheets(p);
    // место
    await p.click("#add"); await sleep(200); await p.click("#add-place"); await p.fill("#ap-name", "дача"); await p.click("#add-place-form button[type=submit]"); await sleep(400);
    check((await names(p, "places")).includes("Дача"), "место «Дача» не создалось (и с заглавной)");
    // сумка в новом месте
    await p.click("#add"); await sleep(200); await p.click("#add-bag"); await p.fill("#ab-name", "чехол"); await p.selectOption("#ab-where", "__new"); await p.fill("#ab-new", "Гараж"); await p.click("#add-bag-form button[type=submit]"); await sleep(400);
    const bags = await all(p, "bags"); check(bags.length === 1 && bags[0].location === "Гараж", "сумка не в «Гараж»: " + JSON.stringify(bags));
    // вещь в место (не в сумку!)
    await p.click("#add"); await sleep(200); await p.click("#add-item"); await p.fill("#f-name", "пальто"); await p.selectOption("#f-where", "place:Дача"); await p.click("#f-save"); await sleep(400);
    const it = (await all(p, "items")).find(i => i.name === "Пальто");
    check(it && !it.in && it.place === "Дача", "вещь «Пальто» должна лежать в месте «Дача», а лежит: " + JSON.stringify(it && { in: it.in, place: it.place }));
    // вещь в сумку через выбор
    await p.click("#add"); await sleep(200); await p.click("#add-item"); await p.fill("#f-name", "маска"); await p.selectOption("#f-where", "bag:" + bags[0].id); await p.click("#f-save"); await sleep(400);
    check((await all(p, "items")).find(i => i.name === "Маска").in === bags[0].id, "маска не в сумке");
    // поиск
    await p.fill("#q", "паль"); await sleep(400);
    check((await p.evaluate(() => document.body.innerText)).includes("Пальто"), "поиск не нашёл «Пальто»");
  });

  // ---------- 2. Колчаны ----------
  await scenario("Колчаны: новый колчан, вещи не смешиваются", async (o) => {
    mock = createMock();
    const p = track(o, await phone()); await p.click("#acc-local-go"); await sleep(300); await closeSheets(p);
    await p.click("#add"); await sleep(200); await p.click("#add-item"); await p.fill("#f-name", "дрель"); await p.click("#f-save"); await sleep(300);
    await p.click("#qv-open"); await sleep(300); if (!(await p.isVisible("#qn-in"))) await p.click("#qv-add"); await sleep(200); await p.fill("#qn-in", "инструменты"); await p.press("#qn-in", "Enter"); await sleep(500);
    const qs = await all(p, "quivers"); const q = qs.find(x => x.name === "Инструменты"); check(q, "колчан не создался: " + JSON.stringify(qs.map(x => x.name)));
    await p.evaluate((id) => window.__kolchanSwitchQ(id), q.id); await sleep(400); await closeSheets(p);
    await p.click("#add"); await sleep(200); if (await p.isVisible("#add-item")) await p.click("#add-item"); await p.fill("#f-name", "шуруповёрт"); await p.click("#f-save"); await sleep(300);
    const items = await all(p, "items");
    check(items.find(i => i.name === "Шуруповёрт").q === q.id && !items.find(i => i.name === "Дрель").q, "вещи перемешались между колчанами");
  });

  // ---------- 3. Экран входа ----------
  await scenario("Вход: бета требует вход, основной — даёт «локально»; неверный пароль пишется в журнал", async (o) => {
    mock = createMock();
    const b = track(o, await phone({ beta: true }));
    check(await b.isVisible("#acc-mail-in"), "в бете нет экрана входа");
    check(!(await b.isVisible("#acc-local-go")), "в бете не должно быть «Использовать локально»");
    await b.fill("#acc-mail-in", "x@y.ru"); await b.fill("#acc-pass", "wrong1"); await b.press("#acc-pass", "Enter"); await sleep(1200);
    check(mock.db.events.some(e => e.kind === "login_fail" && !e.user_id), "неудачный вход не попал в журнал");
  });

  // ---------- 4. Синхронизация двух телефонов одного аккаунта ----------
  await scenario("Синхронизация: два телефона одного аккаунта, одновременные правки", async (o) => {
    mock = createMock(); mock.addUser("uA", "a@a.ru", "pass12", "Алексей");
    const A = track(o, await phone({ uid: "uA" })), B = track(o, await phone({ uid: "uA" }));
    await A.evaluate(() => window.__kolchanAction("add", "маска")); await sleep(400); await A.click("#f-save"); await sleep(300);
    await sync(A); await sync(B);
    check((await names(B, "items")).includes("Маска"), "второй телефон не получил вещь");
    // одновременно: A добавляет, B добавляет другое
    await A.evaluate(() => window.__kolchanAction("add", "баф")); await sleep(300); await A.click("#f-save"); await sleep(200);
    await B.evaluate(() => window.__kolchanAction("add", "перчатки")); await sleep(300); await B.click("#f-save"); await sleep(200);
    await sync(A); await sync(B); await sync(A);
    const a = await names(A, "items"), bb = await names(B, "items");
    check(["Маска", "Баф", "Перчатки"].every(n => a.includes(n) && bb.includes(n)), "одновременные добавления потерялись: A=" + a + " B=" + bb);
  });

  // ---------- 5. Поездка на двоих ----------
  await scenario("Поездка: позвать, вступить, общее, траты, балансы, убрать участника, сменить ссылку", async (o) => {
    mock = createMock(); mock.addUser("uA", "a@a.ru", "pass12", "Алексей"); mock.addUser("uB", "b@b.ru", "pass12", "Митяй");
    const A = track(o, await phone({ uid: "uA" }));
    await A.click("#qv-open"); await sleep(300); await A.click("#tp-add"); await A.fill("#tp-name", "Шерегеш"); await A.click("#tp-form button[type=submit]"); await sleep(700);
    await A.click("#ex-open"); await A.click("#ex-add"); await A.fill("#ex-name", "продукты"); await A.fill("#ex-amt", "3000"); await A.click("#ex-form button[type=submit]"); await sleep(300); await A.click("#ex .sh-x");
    await A.click("#trip-invite"); await sleep(2500);
    const link = await A.inputValue("#ti-link"); check(/#join=/.test(link), "нет ссылки-приглашения: " + link); await A.click("#ti .sh-x");
    const B = track(o, await phone({ uid: "uB", hash: link.slice(link.indexOf("#")) })); await sleep(2500);
    check(mock.db.trip_members.length === 2, "Митяй не вступил: участников " + mock.db.trip_members.length);
    check((await B.evaluate(() => document.querySelector("header").innerText)).includes("Шерегеш"), "у Митяя не открылась поездка");
    // общее и трата от B
    await B.fill(".common-add input", "палатка"); await B.click(".common-add button[type=submit]"); await sleep(300);
    await B.click("#ex-open"); await B.click("#ex-add"); await B.fill("#ex-name", "бензин"); await B.fill("#ex-amt", "1000"); await B.click("#ex-form button[type=submit]"); await sleep(300); await B.click("#ex .sh-x");
    await sync(B); await sync(A); await sync(B);
    const trip = (await all(A, "quivers")).find(q => q.kind === "trip");
    check(trip && (trip.exp || []).length === 2, "у Алексея не 2 траты: " + JSON.stringify(trip && trip.exp));
    check((await names(A, "items")).includes("Палатка"), "палатка не дошла до Алексея");
    // балансы одинаковые у обоих
    const bal = async (p) => { await p.click("#ex-open"); await sleep(300); const t = await p.evaluate(() => document.getElementById("ex").innerText); await p.click("#ex .sh-x"); return (t.match(/-?\d[\d\s]*₽/g) || []).join(","); };
    check(await bal(A) === await bal(B), "балансы у Алексея и Митяя разные");
    // убрать Митяя, передать «Без хозяина»
    await A.click("#trip-avs"); await sleep(300);
    await A.locator("#tm-list .tm-row").filter({ hasText: "Митяй" }).locator(".tm-kick").click(); await sleep(300);
    await A.click("#kk-go"); await sleep(2500);
    check(mock.db.trip_members.length === 1, "Митяй остался в поездке");
    const t2 = (await all(A, "quivers")).find(q => q.kind === "trip");
    check((t2.exp || []).length === 2, "траты пропали после удаления участника");
    await sync(B);
    check(!(await all(B, "quivers")).some(q => q.kind === "trip"), "у убранного Митяя поездка осталась");
    // старая ссылка больше не пускает
    const ok = await B.evaluate(async ([t, inv]) => { const r = await fetch("https://jtmujxxpcqjddauitrio.supabase.co/rest/v1/rpc/join_trip", { method: "POST", headers: { apikey: "k", Authorization: "Bearer " + (await window.__kolchan.get("meta", "cloudSession")).access_token, "Content-Type": "application/json" }, body: JSON.stringify({ p_trip: t, p_invite: inv, p_name: "x" }) }); return r.json(); }, [trip.id, link.split(".").pop()]);
    check(ok === false, "старая ссылка всё ещё пускает");
  });

  // ---------- 6. «Выйти» и вход снова: поездка не удаляется у всех (баг 10.11) ----------
  await scenario("«Выйти» и вход снова: поездка остаётся у всех", async (o) => {
    mock = createMock(); mock.addUser("uA", "a@a.ru", "pass12", "Алексей");
    const A = track(o, await phone({ uid: "uA" }));
    await A.click("#qv-open"); await sleep(300); await A.click("#tp-add"); await A.fill("#tp-name", "Кировск"); await A.click("#tp-form button[type=submit]"); await sleep(700);
    await A.fill(".common-add input", "чай"); await A.click(".common-add button[type=submit]"); await sleep(300);
    await sync(A);
    const live = () => mock.db.trip_records.filter(r => !r.deleted).length; const before = live();
    check(before >= 2, "поездка не ушла на сервер");
    await A.evaluate(() => window.__kolchanLogout()); await sleep(300); await A.click("#acc-logout-yes"); await sleep(1500);
    check((await all(A, "items")).length === 0, "после «Выйти» телефон не очистился");
    // вход снова
    await A.fill("#acc-mail-in", "a@a.ru"); await A.fill("#acc-pass", "pass12"); await A.press("#acc-pass", "Enter"); await sleep(3500);
    check(live() === before, "после нового входа на сервере стало " + live() + " записей поездки вместо " + before);
    check((await all(A, "quivers")).some(q => q.name === "Кировск"), "поездка не вернулась на телефон");
  });

  // ---------- 7. Выход не стирает несохранённое; устаревший вход ----------
  await scenario("Выход без связи отменяется; устаревший вход не теряет вещи; выход только на этом устройстве", async (o) => {
    mock = createMock(); mock.addUser("uA", "a@a.ru", "pass12", "Алексей");
    const A = track(o, await phone({ uid: "uA" })), B = track(o, await phone({ uid: "uA" }));
    await A.evaluate(() => window.__kolchanAction("add", "очки")); await sleep(300); await A.click("#f-save"); await sleep(200);
    mock.setDown(true);
    await A.evaluate(() => window.__kolchanLogout()); await sleep(300); await A.click("#acc-logout-yes"); await sleep(1500);
    check((await names(A, "items")).includes("Очки"), "выход без связи стёр несохранённую вещь");
    mock.setDown(false);
    // B выходит — у A вход не должен слететь
    await sync(A);
    await B.evaluate(() => window.__kolchanLogout()); await sleep(300); await B.click("#acc-logout-yes"); await sleep(1500);
    check(mock.log.some(l => l.includes("/auth/v1/logout?scope=local")), "выход не local");
    await A.evaluate(() => window.__kolchan.put("meta", Object.assign({}, { key: "x" }))); await sync(A);
    check(!(await A.evaluate(() => document.body.innerText)).includes("Вход устарел"), "выход на B выкинул A");
    // устаревший вход
    const s = await A.evaluate(() => window.__kolchan.get("meta", "cloudSession"));
    await A.evaluate((s) => window.__kolchan.put("meta", Object.assign({}, s, { refresh_token: "dead", expires_at: Date.now() - 1000 })), s);
    await A.goto("about:blank"); await A.goto(BASE); await sleep(2500);
    check((await names(A, "items")).includes("Очки"), "устаревший вход потерял вещь");
  });

  // ---------- 8. Безопасность ----------
  await scenario("Безопасность: чужой HTML не выполняется, подкинутые записи не попадают в личную базу", async (o) => {
    mock = createMock(); mock.addUser("uA", "a@a.ru", "pass12", "Алексей");
    const A = track(o, await phone({ uid: "uA" }));
    await A.evaluate(() => { window.__pwned = 0; });
    const X = "<img src=x onerror=window.__pwned++>";
    await A.evaluate((X) => window.__kolchanAction("add", X), X); await sleep(300); await A.click("#f-save"); await sleep(300);
    await A.click("#qv-open"); await sleep(300); await A.click("#tp-add"); await A.fill("#tp-name", X); await A.click("#tp-form button[type=submit]"); await sleep(700);
    await sync(A);
    const t = mock.db.trips[0].id;
    // «друг» пишет мимо правил — сервер не пускает
    mock.db.trip_records.push({ trip_id: t, coll: "items", id: "evil", data: { name: "В мой колчан", q: "main" }, deleted: false });
    await sync(A);
    check(!(await names(A, "items")).includes("В мой колчан"), "подкинутая запись попала в личную базу");
    check(await A.evaluate(() => window.__pwned) === 0, "чужой HTML выполнился");
  });

  // ---------- 9. Устойчивость ----------
  await scenario("Устойчивость: база на телефоне после фона, журнал действий", async (o) => {
    mock = createMock(); mock.addUser("uA", "a@a.ru", "pass12", "Алексей");
    const A = track(o, await phone({ uid: "uA" }));
    await A.evaluate(() => window.__kolchanAction("add", "фонарь")); await sleep(300); await A.click("#f-save"); await sleep(300);
    // iOS закрыл соединение с IndexedDB
    await A.evaluate(() => new Promise(r => { const q = indexedDB.open("kolchan"); q.onsuccess = () => { q.result.close(); r(); }; }));
    await A.evaluate(() => window.__kolchanAction("add", "компас")); await sleep(300); await A.click("#f-save"); await sleep(400);
    check((await names(A, "items")).includes("Компас"), "после закрытия базы вещь не сохранилась");
    await sync(A);
    const kinds = mock.db.events.map(e => e.kind);
    check(kinds.includes("open") && kinds.includes("create"), "журнал не пишется: " + kinds.join(","));
  });

  await browser.close(); server.close();
  const bad = results.filter(r => !r.ok);
  const md = "# QA Колчана — " + new Date().toISOString().slice(0, 16).replace("T", " ") + "\n\n| | Сценарий | с | Что не так |\n|---|---|---|---|\n" +
    results.map(r => "| " + (r.ok ? "✅" : "❌") + " | " + r.name + " | " + r.s + " | " + (r.err || "") + " |").join("\n") +
    "\n\nИтог: " + (results.length - bad.length) + " из " + results.length + " прошли.\n";
  fs.writeFileSync(path.join(__dirname, "report.md"), md);
  console.log("\n" + (bad.length ? "❌ Упало " + bad.length + " из " + results.length : "✅ Все " + results.length + " сценариев прошли"));
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
