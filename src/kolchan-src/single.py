"""Pack the built app (kolchan/) into one HTML file for a Claude artifact preview."""
import re, sys, os
base = sys.argv[1]; out = sys.argv[2]
seed = sys.argv[3] if len(sys.argv) > 3 else None
title = sys.argv[4] if len(sys.argv) > 4 else "kolchan.friends"
h = open(os.path.join(base, "kolchan/index.html"), encoding="utf-8").read()
loc = open(os.path.join(base, "kolchan/local.js"), encoding="utf-8").read()
fr = open(os.path.join(base, "kolchan/friends.js"), encoding="utf-8").read()
loc = loc.replace('if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});', '')
h = h.replace('<script src="local.js"></script>', '<script>\n' + loc + '\n</script>')
h = h.replace('<script src="friends.js"></script>', '<script>\n' + fr + '\n</script>')
for pat in [r'<!doctype html>\n', r'<html lang="ru">\n', r'<head>\n', r'</head>\n', r'<body>\n', r'</body>\n', r'</html>\n',
            r'<meta charset="utf-8">\n', r'<meta name="viewport"[^>]*>\n', r'<meta name="(apple-mobile|mobile)[^>]*>\n',
            r'<link rel="(manifest|apple-touch-icon|icon)"[^>]*>\n', r'<title>[^<]*</title>\n']:
    h = re.sub(pat, '', h)
import json
pre = '<title>' + title + '</title>\n<script>window.__KOLCHAN_PREVIEW = true;</script>\n'
if seed:
    data = json.load(open(seed, encoding="utf-8"))
    data = {k: data.get(k, []) for k in ("places", "bags", "items", "quivers")}
    pre += '<script>window.__KOLCHAN_SEED = ' + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + ';</script>\n'
open(out, "w", encoding="utf-8").write(pre + h)
