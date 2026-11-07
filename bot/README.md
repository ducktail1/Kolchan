# Колчан — Telegram-бот

Бот работает с той же базой, что и приложение: `data.json` в приватном репозитории.
Отвечает только владельцу (OWNER_ID), остальным молчит.

## Что умеет
- Меню кнопками: Найти, Добавить, Переложить, Места, Сумки, В пути, История.
- Просто напиши название — найдёт вещь, сумку или место.
- Карточка вещи с историей, выбор «куда» из списка, отправка и приём сумок.
- Быстрые команды текстом: `+ Маска → Дача`, `маска → Сочи`, `… // заметка`.

Каждое изменение — коммит «Бот: …» в репозитории с базой. Приложение подтягивает его при синхронизации.

## Установка (Cloudflare Workers, бесплатно)
1. @BotFather → `/newbot` → получить токен бота.
2. GitHub → Settings → Developer settings → Fine-grained tokens → новый токен:
   доступ только к репозиторию с базой, Contents: Read and write.
3. dash.cloudflare.com → Workers & Pages → Create → Worker → имя `kolchan-bot` → Deploy.
4. Edit code → заменить всё содержимым `worker.js` → Deploy.
5. Settings → Variables and Secrets:
   - `BOT_TOKEN` (Secret) — токен бота
   - `GH_TOKEN` (Secret) — токен GitHub
   - `HOOK_SECRET` (Secret) — любая длинная строка из латинских букв и цифр
   - `REPO` (Text) — `логин/kolchan-data`
6. Открыть `https://kolchan-bot.<поддомен>.workers.dev/setup?key=<HOOK_SECRET>` → «Готово!».
7. Написать боту `/start` — он пришлёт твой Telegram ID. Добавить `OWNER_ID` (Text) с этим числом.

## Вход в приложение через Telegram (бета)
Бот подтверждает вход в Колчан β для любого человека: приложение открывает `t.me/<бот>?start=login_<код>`,
человек нажимает «Войти в Колчан» (и «Поделиться номером» при входе по телефону), бот сообщает функции `tg-auth` в Supabase.
Переменные Worker: `LOGIN_URL` (Text) — `https://<проект>.supabase.co/functions/v1/tg-auth`, `LOGIN_SECRET` (Secret) — тот же, что в Supabase.
