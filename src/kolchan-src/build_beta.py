"""Make the beta app (kolchan-beta/) from the built app (kolchan/): its own storage, account + online base.
usage: build_beta.py <scratchpad> <version> <supabase url> <publishable key> [providers comma list]"""
import json, os, shutil, sys

base, ver = sys.argv[1], sys.argv[2]
url = sys.argv[3] if len(sys.argv) > 3 else ""
key = sys.argv[4] if len(sys.argv) > 4 else ""
providers = [p for p in (sys.argv[5] if len(sys.argv) > 5 else "").split(",") if p]
src, out = os.path.join(base, "kolchan"), os.path.join(base, "kolchan-beta")
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(src, out)
os.remove(os.path.join(out, "INSTRUKCIYA.txt")) if os.path.exists(os.path.join(out, "INSTRUKCIYA.txt")) else None

def edit(name, pairs):
    p = os.path.join(out, name); s = open(p, encoding="utf-8").read()
    for a, b in pairs:
        assert a in s, (name, a)
        s = s.replace(a, b)
    open(p, "w", encoding="utf-8").write(s)

cfg = json.dumps({"url": url.rstrip("/"), "key": key, "providers": providers, "tgBot": "mykolchanbot", "beta": True}, ensure_ascii=False)
edit("index.html", [
    ('<meta name="apple-mobile-web-app-title" content="Колчан">', '<meta name="apple-mobile-web-app-title" content="Колчан β">'),
    ('<script src="friends.js"></script>', '<script src="friends.js"></script>\n<script>window.__CLOUD = ' + cfg + ';</script>\n<script src="cloud.js"></script>'),
    ('"kolchan.q"', '"kolchanb.q"'),
    ('<script src="local.js"></script>', '<script>window.__KOLCHAN_AVA = true;</script>\n<script src="local.js"></script>'),
])
edit("local.js", [('const DB_NAME = "kolchan",', 'const DB_NAME = "kolchan-beta",')])
edit("friends.js", [('"kolchan.installSeen"', '"kolchanb.installSeen"')])
edit("manifest.webmanifest", [('"name": "Колчан"', '"name": "Колчан β"'), ('"short_name": "Колчан"', '"short_name": "Колчан β"')])
edit("sw.js", [
    ('const VERSION = "' + ver + '";', 'const VERSION = "beta-' + ver + '";'),
    ('"friends.js"', '"friends.js", "cloud.js"'),
    ('  if (new URL(req.url).pathname.includes("/beta/")) return;   // the beta app has its own worker\n', ''),
])
shutil.copy(os.path.join(base, "kolchan-src", "cloud.js"), out)
print("beta built", sorted(os.listdir(out)), "providers", providers, "configured", bool(url and key))
