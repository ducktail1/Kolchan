#!/bin/sh
# Превью kolchan.test: собирает страницу с подменённым Supabase внутри (вход уже выполнен).
# usage: src/preview.sh <seed.json> <out.html> [title]
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
python3 "$SRC/kolchan-src/build.py" "$SRC" preview >/dev/null
python3 "$SRC/kolchan-src/build_main.py" "$SRC" preview https://jtmujxxpcqjddauitrio.supabase.co sb_publishable_PrBfsQIYFTYLzoqWso1CHA_ED-qe00L email,telegram >/dev/null
python3 "$SRC/kolchan-src/single_beta.py" "$SRC" "$2" "$1" kolchan "${3:-kolchan.test}"
