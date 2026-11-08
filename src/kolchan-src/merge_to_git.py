"""Merge the Claude page export (dir of per-doc JSON) into kolchan-data/data.json, same rules as the app."""
import json, glob, os, sys, time
EXP, DATA_FILE, OUT_ART = sys.argv[1], sys.argv[2], sys.argv[3]
C = ["places", "bags", "items", "quivers"]
def stamp(r): return max([r.get("_t") or 0, r.get("updatedAt") or 0] + [x.get("t") or 0 for x in (r.get("log") or [])])
def merge_log(a, b):
    m = {}
    for x in (a or []) + (b or []): m["|".join(str(x.get(k, "")) for k in ("t", "kind", "to", "from", "note"))] = x
    return sorted(m.values(), key=lambda x: x.get("t") or 0)[-80:]
def canon(r): return json.dumps(dict(sorted(r.items())), ensure_ascii=False, separators=(",", ":"))  # same as the app: only top-level keys sorted
art = {c: {} for c in C}
for c in C:
    for f in glob.glob(f"{EXP}/{c}/*.json"):
        d = json.load(open(f)); d["id"] = os.path.basename(f)[:-5]; art[c][d["id"]] = d
git = json.load(open(DATA_FILE))
gitm = {c: {r["id"]: r for r in git.get(c, [])} for c in C}
now = int(time.time() * 1000)
merged = {c: [] for c in C}; report = {"to_git": [], "to_page": []}
for c in C:
    for i in sorted(set(art[c]) | set(gitm[c])):
        a, g = art[c].get(i), gitm[c].get(i)
        if a and g:
            a_cmp = {k: v for k, v in a.items() if k != "_t"}; g_cmp = {k: v for k, v in g.items() if k != "_t"}
            if canon(a_cmp) == canon(g_cmp): out = g
            elif stamp(a) > stamp(g):
                out = dict(a); out["_t"] = now
                if a.get("log") or g.get("log"): out["log"] = merge_log(g.get("log"), a.get("log"))
                report["to_git"].append((c, out.get("name")))
            else:
                out = dict(g)
                if a.get("log") or g.get("log"): out["log"] = merge_log(g.get("log"), a.get("log"))
                report["to_page"].append((c, out.get("name")))
        elif a:
            out = dict(a); out["_t"] = now; report["to_git"].append((c, a.get("name")))
        else:
            out = g; report["to_page"].append((c, g.get("name")))
        merged[c].append(out)
order = {"places": lambda r: r.get("order", 0), "bags": lambda r: r.get("order", 0), "quivers": lambda r: r.get("order", 0), "items": lambda r: r["id"]}
lines = ["{", '"app": "kolchan", "version": 1, "exportedAt": %d,' % now]
for c in C:
    if c == "quivers" and not merged[c]: continue
    lines += ['"%s": [' % c, ",\n".join(canon(r) for r in sorted(merged[c], key=order[c])), "],"]
lines += ['"photos": []', "}"]
open(DATA_FILE, "w", encoding="utf-8").write("\n".join(lines) + "\n")
json.load(open(DATA_FILE))
# records the page must be updated with
page = {c: [r for r in merged[c] if canon({k: v for k, v in r.items() if k not in ("_t",)}) != canon({k: v for k, v in (art[c].get(r["id"]) or {}).items() if k not in ("_t", "id")} | {"id": r["id"]})] for c in C}
json.dump(page, open(OUT_ART, "w"), ensure_ascii=False)
print(json.dumps({"to_git": report["to_git"], "to_page": report["to_page"], "counts": {c: len(merged[c]) for c in C}}, ensure_ascii=False))
