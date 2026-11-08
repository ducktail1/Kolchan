#!/bin/sh
# Собирает Колчан из исходников в src/ и кладёт результат в корень репо (основной) и в beta/.
# usage: src/build.sh <версия основного> <версия беты> [провайдеры основного] [провайдеры беты]
#   пример: src/build.sh 1.7.2 1.7.2-beta.21
# Ключ здесь publishable (публичный, он и так виден в приложении). Секретные ключи сюда не класть.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$SRC")"
MAIN_VER="$1"; BETA_VER="$2"
MAIN_PROV="${3:-email,telegram}"
BETA_PROV="${4:-email,telegram,google}"
[ -n "$MAIN_VER" ] && [ -n "$BETA_VER" ] || { echo "usage: src/build.sh <main ver> <beta ver> [main providers] [beta providers]"; exit 1; }
URL=https://jtmujxxpcqjddauitrio.supabase.co
KEY=sb_publishable_PrBfsQIYFTYLzoqWso1CHA_ED-qe00L
FILES="index.html local.js friends.js cloud.js sw.js manifest.webmanifest"

# бета: своя база в браузере, обязательный вход
python3 "$SRC/kolchan-src/build.py" "$SRC" "$BETA_VER"
python3 "$SRC/kolchan-src/build_beta.py" "$SRC" "$BETA_VER" "$URL" "$KEY" "$BETA_PROV"
for f in $FILES; do cp "$SRC/kolchan-beta/$f" "$REPO/beta/$f"; done

# основной: вход по желанию, «Использовать локально»
python3 "$SRC/kolchan-src/build.py" "$SRC" "$MAIN_VER"
python3 "$SRC/kolchan-src/build_main.py" "$SRC" "$MAIN_VER" "$URL" "$KEY" "$MAIN_PROV"
for f in $FILES; do cp "$SRC/kolchan/$f" "$REPO/$f"; done

echo "Готово: основной $MAIN_VER ($MAIN_PROV), бета $BETA_VER ($BETA_PROV). Не забудь CHANGELOG.md."
