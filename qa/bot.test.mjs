// QA бота: заметки владельца → brain/inbox.md (GitHub и Telegram подменены в памяти).
// node qa/bot.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(fileURLToPath(import.meta.url), "../..");
const dir = mkdtempSync(join(tmpdir(), "bot-"));
const f = join(dir, "worker.mjs"); writeFileSync(f, readFileSync(join(root, "bot/worker.js"), "utf8"));
const W = await import(pathToFileURL(f));

const files = {}; const sent = []; let conflictOnce = false;
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(u), m = o.method || "GET";
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (url.hostname === "api.telegram.org") { sent.push(JSON.parse(o.body)); return J({ ok: true, result: {} }); }
  if (url.hostname === "api.github.com") {
    const path = decodeURIComponent(url.pathname.split("/contents/")[1]);
    if (m === "GET") return files[path] ? J({ content: Buffer.from(files[path].text).toString("base64"), sha: files[path].sha }) : J({ message: "Not Found" }, 404);
    if (m === "PUT") {
      const b = JSON.parse(o.body);
      if (conflictOnce) { conflictOnce = false; return J({ message: "conflict" }, 409); }
      if ((files[path] && files[path].sha) !== b.sha) return J({ message: "sha" }, 409);
      files[path] = { text: Buffer.from(b.content, "base64").toString("utf8"), sha: "s" + Math.random() }; return J({ content: { sha: files[path].sha } }, 201);
    }
  }
  throw new Error("неожиданный запрос " + u);
};
const env = { BOT_TOKEN: "t", GH_TOKEN: "g", REPO: "o/r", OWNER_ID: "42", HOOK_SECRET: "h" };
let n = 0;
const say = async (text, from = 42, reply) => {
  sent.length = 0;
  const msg = { message_id: ++n, from: { id: from }, chat: { id: from }, text };
  if (reply) msg.reply_to_message = reply;
  await W.default.fetch(new Request("https://bot/tg", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "h" }, body: JSON.stringify({ update_id: n, message: msg }) }), env);
  return sent.map(x => x.text || "").join("\n");
};
let fails = 0, k = 0;
const check = (ok, what, got) => { k++; if (!ok) { fails++; console.log("❌ " + what + (got !== undefined ? " — " + JSON.stringify(got) : "")); } else console.log("✅ " + what); };
const inbox = () => (files["brain/inbox.md"] || {}).text || "";

let r = await say("! поправить вход на ПК");
check(/Записал/.test(r) && /- \[ \] \d{4}-\d\d-\d\d \d\d:\d\d — поправить вход на ПК/.test(inbox()), "«! текст» → строка в brain/inbox.md", inbox());
r = await say("/n заметки в боте\nвторая строка");
check(/заметки в боте \/ вторая строка/.test(inbox()) && /Открытых заметок: 2/.test(r), "/n, перенос строки склеивается", r);
r = await say("📝 Заметка");
const ask = sent.find(x => x.reply_markup && x.reply_markup.force_reply);
check(ask && /Что записать/.test(r), "кнопка «📝 Заметка» спрашивает текст", r);
const url = /href="([^"]+)"/.exec(ask.text)[1];
r = await say("свайп для удаления вещей", 42, { message_id: 99, text: "Что записать?", entities: [{ type: "text_link", offset: 0, length: 1, url }], from: { is_bot: true } });
check(/свайп для удаления вещей/.test(inbox()), "ответ на вопрос → заметка", inbox());
conflictOnce = true; r = await say("! с конфликтом");
check(/с конфликтом/.test(inbox()) && /Записал/.test(r), "конфликт GitHub — повтор");
r = await say("/notes");
check(/Открытые заметки \(4\)/.test(r) && /поправить вход на ПК/.test(r), "/notes — список", r);
const before = inbox(); r = await say("! чужая заметка", 7);
check(inbox() === before && sent.length === 0, "чужому не отвечаем и не пишем");
r = await say("!");
check(/Напиши текст/.test(r) && inbox().split("\n").filter(l => l.startsWith("- [ ]")).length === 4, "пустая «!» — подсказка");
check(W.noteOf("Маска → Дача // в стирке") === null && W.noteOf("заметка: тест") === "тест", "обычные команды не путаются с заметками");
console.log(fails ? "\n❌ Упало " + fails + " из " + k : "\n✅ Все " + k + " проверок прошли");
process.exit(fails ? 1 : 0);
