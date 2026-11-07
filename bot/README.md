# Колчан — Telegram-бот

Бот работает с той же базой, что и приложение: `data.json` в приватном репозитории.
Отвечает только владельцу (OWNER_ID), остальным молчит.

## Что умеет
- `маска` — найти, где лежит
- `Дача`, `Eastpak` — показать, что в месте или сумке
- `+ Маска Smith → Дача` — добавить (несколько через запятую)
- `маска → Сочи`, `маска → Eastpak` — переложить вещь; `Eastpak → Кировск` — переложить сумку целиком
- `… // заметка` — заметка к перемещению
- `/places`, `/bags` — списки

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
