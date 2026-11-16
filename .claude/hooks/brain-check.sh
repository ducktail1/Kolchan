#!/usr/bin/env bash
# Хук Stop: не даёт Claude закончить ответ, пока выжимка сессии в «втором мозге» отстаёт от работы.
# Мозг — приватный репо ducktail1/kolchan-data, рядом с этим (../kolchan-data) или в $KOLCHAN_DATA.
# Напоминает, если сегодня были коммиты (здесь или в мозге), а brain/sessions/<сегодня>.md нет
# или он старше последней работы больше чем на час. Нет мозга рядом — молчит.
input=$(cat)
# второй заход после напоминания — не зацикливаться
echo "$input" | grep -q '"stop_hook_active": *true' && exit 0

here=$(cd "$(dirname "$0")/../.." && pwd)
brain=${KOLCHAN_DATA:-$here/../kolchan-data}
[ -d "$brain/brain/sessions" ] || exit 0

today=$(TZ=Europe/Moscow date +%F)
midnight=$(TZ=Europe/Moscow date -d "$today 00:00" +%s)
file="brain/sessions/$today.md"

work_code=$(git -C "$here" log -1 --all --format=%ct 2>/dev/null || echo 0)
work_brain=$(git -C "$brain" log -1 --format=%ct -- . ":(exclude)brain/sessions" ":(exclude)backup" ":(exclude)stats.json" ":(exclude)stats-history.jsonl" 2>/dev/null || echo 0)
work=$(( work_code > work_brain ? work_code : work_brain ))
[ "${work:-0}" -lt "$midnight" ] && exit 0          # сегодня ничего не делали

summary=$(git -C "$brain" log -1 --format=%ct -- "$file" 2>/dev/null)
summary=${summary:-0}
if [ ! -f "$brain/$file" ] || [ "$summary" -eq 0 ] || [ "$work" -gt $(( summary + 3600 )) ]; then
  reason="Второй мозг: выжимка $file отсутствует или отстала от сегодняшней работы. Допиши выжимку (только суть: что сделано, решения, что дальше; без дословной переписки), закоммить и запушь в main kolchan-data, затем коротко ответь."
  printf '{"decision":"block","reason":"%s"}\n' "$reason"
fi
exit 0
