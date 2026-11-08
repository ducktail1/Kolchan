"""Build the offline Колчан app from the artifact page (veshchi.html)."""
import os, shutil, sys

base = sys.argv[1]  # scratchpad dir
VERSION = sys.argv[2] if len(sys.argv) > 2 else "dev"
src = open(os.path.join(base, "veshchi.html"), encoding="utf-8").read()
out = os.path.join(base, "kolchan")
shutil.rmtree(out, ignore_errors=True)
os.makedirs(out)

src = src.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
head_part, body_part = src.split("</style>", 1)
head_part += "</style>"

head = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Колчан">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" href="icon-192.png">
<style>
:root { color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
html, body { margin: 0; }
img { max-width: 100%; }
[hidden] { display: none !important; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); background: var(--bg); z-index: 10; }
.hdr-right { display: flex; gap: 12px; align-items: baseline; }
.ok { color: var(--accent); font-size: 14px; }
.dataBtns { display: flex; flex-direction: column; gap: 10px; }
</style>
"""

data_sheet = ("""
<div class="sheet-bg" id="data-bg" hidden>
  <div class="sheet">
    <h2>Данные</h2>
    <div class="note" id="d-stat"></div>
    <div class="note" id="d-last"></div>
    <div class="note">Версия Колчана: <b>"+VERSION+"</b></div>
    <div class="dataBtns">
      <button type="button" class="primary" id="d-export">Выгрузить файл</button>
      <label>Загрузить файл <span class="hint">заменит всю базу на этом телефоне</span>
        <input type="file" id="d-import" accept=".json,application/json">
      </label>
    </div>
    <div class="confirm" id="d-confirm" hidden>
      <span id="d-confirm-text"></span>
      <div class="row2"><button type="button" id="d-confirm-no">Отмена</button><button type="button" class="danger" id="d-confirm-yes">Заменить базу</button></div>
    </div>
    <div class="ok" id="d-msg" hidden></div>
    <details class="sync" id="s-box">
      <summary>Синхронизация с GitHub (необязательно)</summary>
      <div class="note">Для тех, кто хочет хранить копию базы в своём приватном репозитории GitHub. Без этого всё работает.</div>
      <div class="note" id="s-state"></div>
      <label>Токен GitHub <span class="hint">хранится только на этом телефоне</span>
        <input id="s-token" type="password" placeholder="github_pat_…" autocomplete="off">
      </label>
      <label>Репозиторий с базой
        <input id="s-repo" type="text" placeholder="логин/kolchan-data" autocomplete="off">
      </label>
      <div class="row2"><button type="button" id="s-save">Сохранить токен</button><button type="button" class="primary" id="s-now">Синхронизировать</button></div>
    </details>
    <div class="notice">База хранится только на этом телефоне. Время от времени нажимай «Выгрузить файл» и сохраняй копию в «Файлы» или iCloud — так ничего не потеряется, даже если сменишь телефон.</div>
    <div class="actions"><div class="right"><button type="button" id="d-close">Закрыть</button></div></div>
  </div>
</div>
<script>window.__KOLCHAN_VERSION = "__VER__";</script>
<script src="local.js"></script>
<script src="friends.js"></script>
""").replace("\"+VERSION+\"", VERSION).replace("__VER__", VERSION)

count_old = '<div class="count" id="count">Загружаю базу…</div>'
assert count_old in body_part
body_part = body_part.replace(count_old, '<div class="hdr-right">' + count_old + '<button type="button" class="link" id="data-open">Данные</button></div>')
marker = "\n<script>\n"
assert marker in body_part
body_part = body_part.replace(marker, data_sheet + marker, 1)

body_part = body_part.replace("window.claude", "window.__store")
html = head + head_part + "\n</head>\n<body>\n" + body_part.strip() + "\n</body>\n</html>\n"
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(html)
shutil.copy(os.path.join(base, "kolchan-src", "local.js"), out)
shutil.copy(os.path.join(base, "kolchan-src", "friends.js"), out)
for f in ["manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "INSTRUKCIYA.txt"]:
    shutil.copy(os.path.join(base, "app", f), out)

sw = open(os.path.join(base, "app", "sw.js"), encoding="utf-8").read()
sw = sw.replace('const VERSION = "v1";', 'const VERSION = "' + VERSION + '";').replace('"app.js"', '"local.js", "friends.js"')
open(os.path.join(out, "sw.js"), "w", encoding="utf-8").write(sw)
print("built", sorted(os.listdir(out)))
