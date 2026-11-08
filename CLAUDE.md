# Колчан — для Claude

PWA-база вещей Алексея: места, сумки, вещи, история перемещений, колчаны (отдельные базы), общие поездки с тратами. Вход через Telegram, почту и Google на Supabase, Telegram-бот @mykolchanbot.

**Второй мозг проекта** — в приватном репо `ducktail1/kolchan-data`, папка `brain/`. В начале работы прочитай `brain/state.md` (что где выкачено, открытые PR) и `brain/roadmap.md` (план). Решения и почему — `brain/decisions.md`, устройство — `brain/architecture.md`. В конце крупной задачи обнови `state.md` и допиши журнал в `brain/sessions/<дата>.md`. Эта репа публичная: планы, личное и рабочее (сервер, VPN) — только в `kolchan-data`.

## Правила работы (от Алексея)
- Правки сначала в превью-артефакте **kolchan.test** (https://claude.ai/artifact/CyPehxmiwNnVR4tJp4cL5C) — копия его базы + тестовая поездка «Шерегеш 2027 (пример)». В гит — только по его команде («выкатывай», «спускай на основную и друзей»).
- Новое по умолчанию идёт только в бету (`/beta/`); в основной — когда он скажет.
- Git: ветка `dev` → PR → `main`, мержит он сам. Артефакт kolchan.friends не трогать.
- Названия писать ровно как он дал. Ничего не удалять без просьбы. Пояснительных подписей в интерфейсе не добавлять.
- Секреты никогда не просить и не принимать: токены GitHub и бота, service_role/secret ключ Supabase, пароль БД, LOGIN_SECRET, секрет Google. Он вводит их сам (GitHub Secrets, Cloudflare).
- Общаемся по-русски, коротко.

## Где что
- `src/veshchi.html` — исходник страницы (разметка, стили, логика экранов).
- `src/kolchan-src/` — `local.js` (хранилище IndexedDB), `friends.js` (приветствие, установка, ✕ в окнах), `cloud.js` (вход, синхронизация, поездки), сборочные скрипты.
- `src/app/` — шаблон service worker, манифест, иконки.
- Корень = основной Колчан (https://ducktail1.github.io/Kolchan/), `beta/` = бета. Это **собранные** файлы — руками не править, собирать из `src/`.
- `supabase/` — SQL (records, trips). `bot/worker.js` — бот на Cloudflare. `privacy.html` — политика для Google.

## Сборка
```sh
src/build.sh <версия основного> <версия беты>      # например: src/build.sh 1.7.2 1.7.2-beta.21
```
Провайдеры по умолчанию: основной `email,telegram`, бета `email,telegram,google` (третий/четвёртый аргумент меняют). Потом запись в `CHANGELOG.md`.

Превью для артефакта (мок Supabase внутри страницы):
```sh
python3 src/kolchan-src/single_beta.py src out.html <seed.json> kolchan kolchan.test
```
Сиды с вещами Алексея лежат в `kolchan-data/brain/seeds/` (личные — в эту репу не класть).

Тесты: Playwright + Chromium предустановлены; страницу отдавать локальным http-сервером, перед `goto` на другой hash — `about:blank`.
