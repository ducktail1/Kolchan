// Колчан: вход через Telegram (и номер телефона через бота).
// Supabase → Edge Functions → tg-auth. В настройках функции выключить «Verify JWT».
// Секрет LOGIN_SECRET (Edge Functions → Secrets) — тот же, что у бота в Cloudflare.
//
// Как это работает:
//  1. Приложение придумывает случайный код и открывает t.me/<бот>?start=login_<код>.
//  2. Человек нажимает в боте «Войти в Колчан» (и, если вход по номеру, «Поделиться номером»).
//     Бот сообщает сюда: action "confirm" / "phone" с секретом.
//  3. Приложение спрашивает сюда action "poll" с тем же кодом и получает сессию Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOGIN_SECRET = Deno.env.get("LOGIN_SECRET") || "";
const TTL = 10 * 60 * 1000;                      // код живёт 10 минут
const MAIL_DOMAIN = "tg.kolchan.app";            // служебная почта для аккаунтов из Telegram (писем туда не шлём)

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-login-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const okCode = (c: unknown) => typeof c === "string" && /^[A-Za-z0-9_-]{16,48}$/.test(c);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return J({ error: "POST only" }, 405);
  const b = await req.json().catch(() => ({}));
  const fromBot = LOGIN_SECRET !== "" && req.headers.get("x-login-secret") === LOGIN_SECRET;

  // ---- от бота: человек нажал «Войти в Колчан» ----
  if (b.action === "confirm") {
    if (!fromBot) return J({ error: "forbidden" }, 403);
    if (!okCode(b.code) || !b.tg || !b.tg.id) return J({ error: "bad request" }, 400);
    const now = new Date().toISOString();
    const { error } = await admin.from("tg_logins").upsert({
      code: b.code, tg_id: b.tg.id,
      tg_name: [b.tg.first_name, b.tg.last_name].filter(Boolean).join(" ") || null,
      tg_username: b.tg.username || null,
      mode: b.mode === "phone" ? "phone" : "tg",
      created_at: now,
      confirmed_at: b.mode === "phone" ? null : now,   // по номеру — ждём контакт
    });
    return error ? J({ error: error.message }, 500) : J({ ok: true });
  }

  // ---- от бота: человек поделился своим номером ----
  if (b.action === "phone") {
    if (!fromBot) return J({ error: "forbidden" }, 403);
    if (!b.tg_id || !b.phone) return J({ error: "bad request" }, 400);
    const since = new Date(Date.now() - TTL).toISOString();
    const { data } = await admin.from("tg_logins").select("code").eq("tg_id", b.tg_id).eq("mode", "phone")
      .is("confirmed_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(1);
    if (!data || !data.length) return J({ ok: false, reason: "no pending login" });
    const phone = String(b.phone).startsWith("+") ? String(b.phone) : "+" + b.phone;
    await admin.from("tg_logins").update({ phone, confirmed_at: new Date().toISOString() }).eq("code", data[0].code);
    return J({ ok: true });
  }

  // ---- от приложения: «ну что, подтвердили?» ----
  if (b.action === "poll") {
    if (!okCode(b.code)) return J({ error: "bad code" }, 400);
    const { data: row } = await admin.from("tg_logins").select("*").eq("code", b.code).maybeSingle();
    if (!row || !row.confirmed_at) {
      if (row && Date.now() - new Date(row.created_at).getTime() > TTL) { await admin.from("tg_logins").delete().eq("code", b.code); return J({ error: "expired" }, 410); }
      return J({ pending: true });
    }
    await admin.from("tg_logins").delete().eq("code", b.code);   // код одноразовый
    if (Date.now() - new Date(row.created_at).getTime() > TTL) return J({ error: "expired" }, 410);

    const meta = (extra: Record<string, unknown>) => Object.assign({}, extra, {
      tg_id: row.tg_id, tg_username: row.tg_username, ...(row.phone ? { phone: row.phone } : {}),
    });
    const { data: map } = await admin.from("tg_users").select("user_id").eq("tg_id", row.tg_id).maybeSingle();

    // привязка Telegram к уже открытому аккаунту
    const auth = req.headers.get("authorization") || "";
    if (b.link && auth.startsWith("Bearer ")) {
      const { data: u } = await admin.auth.getUser(auth.slice(7));
      if (!u || !u.user) return J({ error: "Вход устарел — войди заново" }, 401);
      if (map && map.user_id !== u.user.id) return J({ error: "Этот Telegram уже привязан к другому аккаунту Колчана" }, 409);
      await admin.from("tg_users").upsert({ tg_id: row.tg_id, user_id: u.user.id, phone: row.phone || null });
      const um = u.user.user_metadata || {};
      await admin.auth.admin.updateUserById(u.user.id, { user_metadata: meta({ ...um, name: um.name || row.tg_name }) });
      return J({ linked: true, user_metadata: meta({ ...um, name: um.name || row.tg_name }) });
    }

    // вход: найти аккаунт этого Telegram или создать новый
    let email: string;
    if (map) {
      const { data: gu, error } = await admin.auth.admin.getUserById(map.user_id);
      if (error || !gu.user) return J({ error: "Аккаунт не найден" }, 500);
      email = gu.user.email!;
      const um = gu.user.user_metadata || {};
      await admin.auth.admin.updateUserById(map.user_id, { user_metadata: meta({ ...um, name: um.name || row.tg_name }) });
      if (row.phone) await admin.from("tg_users").update({ phone: row.phone }).eq("tg_id", row.tg_id);
    } else {
      email = "tg" + row.tg_id + "@" + MAIL_DOMAIN;
      const { data: cu, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta({ name: row.tg_name }) });
      if (error || !cu.user) return J({ error: error ? error.message : "Не получилось создать аккаунт" }, 500);
      await admin.from("tg_users").insert({ tg_id: row.tg_id, user_id: cu.user.id, phone: row.phone || null });
    }
    const { data: lk, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (le || !lk) return J({ error: le ? le.message : "link" }, 500);
    // отдельный клиент: verifyOtp запоминает сессию пользователя в клиенте, и если сделать это на `admin`,
    // следующие запросы этой же копии функции пойдут уже от имени пользователя → «violates row-level security»
    const once = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: ses, error: ve } = await once.auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
    if (ve || !ses.session) return J({ error: ve ? ve.message : "session" }, 500);
    return J({ session: ses.session });
  }

  return J({ error: "bad request" }, 400);
});
