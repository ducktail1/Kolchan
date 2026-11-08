"""Finish the main app (kolchan/) after build.py: avatar menu, account (optional — «Использовать локально»).
usage: build_main.py <scratchpad> <version> <supabase url> <publishable key> [providers comma list]"""
import json, os, shutil, sys

base, ver = sys.argv[1], sys.argv[2]
url, key = sys.argv[3], sys.argv[4]
providers = [p for p in (sys.argv[5] if len(sys.argv) > 5 else "").split(",") if p]
out = os.path.join(base, "kolchan")

def edit(name, pairs):
    p = os.path.join(out, name); s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert a in s, (name, a)
        s = s.replace(a, b)
    open(p, "w", encoding="utf-8").write(s)

cfg = json.dumps({"url": url.rstrip("/"), "key": key, "providers": providers, "tgBot": "mykolchanbot"}, ensure_ascii=False)
edit("index.html", [
    ('<script src="friends.js"></script>', '<script src="friends.js"></script>\n<script>window.__CLOUD = ' + cfg + ';</script>\n<script src="cloud.js"></script>'),
    ('<script src="local.js"></script>', '<script>window.__KOLCHAN_AVA = true;</script>\n<script src="local.js"></script>'),
])
edit("sw.js", [('"friends.js"', '"friends.js", "cloud.js"')])
shutil.copy(os.path.join(base, "kolchan-src", "cloud.js"), out)
print("main built", ver, "providers", providers)
