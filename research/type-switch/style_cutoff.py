"""Which champion style share should a build switch need? (Nico 2026-11-28: "see if a different cutoff should be used".)
Archive, all ten players of every lobby (correlational). A player "tries" a style when one of their first two finished
legendaries is of a style (crit, on-hit, lethality, AP, fighter) and it is their first item of it. They "continue" when
one of their next two legendaries is that style again, and "revert" when neither is. Rows need two more legendaries.
Buckets by the champion's share of that style among finished items held at game end (AramHex, all players).
    python3 research/type-switch/style_cutoff.py [patch]
"""
import json, gzip, collections, math, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARCH = "/mnt/project-files/private/owner-games/timelines-compact.jsonl.gz"
PATCH = sys.argv[1] if len(sys.argv) > 1 else "16.23"
dd = json.load(open(os.path.join(ROOT, "web/public/assets/dd/16.23.1/data/en_US/item.json")))["data"]
FIN = {int(k) % 10000 for k, v in dd.items() if v.get("gold", {}).get("total", 0) >= 2000 and not v.get("into") and "Boots" not in v["tags"]}
ROLES = {v["id"] % 10000: v.get("roles", []) for v in json.load(open(os.path.join(ROOT, "simulator/data/items.json")))["items"].values() if v.get("id")}
def styles(i):
    r = set(ROLES.get(i, [])); s = set()
    if "crit" in r: s.add("crit")
    if r & {"onhit", "ap_onhit"}: s.add("onhit")
    if "lethality" in r: s.add("lethality")
    if r & {"ap", "ap_onhit", "ap_tank"}: s.add("ap")
    if r & {"ad", "ability_ad"} and not r & {"crit", "lethality", "onhit"}: s.add("fighter")
    return s
hex_ = json.load(open(os.path.join(ROOT, f"data/aramhex/patches/{PATCH}/items.json")))
share = {}
for c, row in hex_.items():
    n, tot = collections.Counter(), 0
    for i, (g, _w) in row.get("items", {}).items():
        i = int(i) % 10000
        if i not in FIN: continue
        st = styles(i)
        if not st: continue
        tot += g
        for s in st: n[s] += g
    if tot: share[int(c)] = {s: n[s] / tot for s in ("crit", "onhit", "lethality", "ap", "fighter")}
EDGES = [0, .01, .02, .03, .05, .08, .12, .2, .35]
rows = collections.defaultdict(lambda: [[0, 0], [0, 0]])  # (bucket) -> [continue [n, wins], revert [n, wins]]
per = []
for line in gzip.open(ARCH, "rt"):
    for p in json.loads(line)["players"]:
        sh = share.get(p["champ"])
        if not sh: continue
        seq = []
        for e in p["items"]:
            i = e[2] % 10000
            if e[1] == "purchased" and i in FIN and i not in seq: seq.append(i)
        if len(seq) < 3: continue
        for k in (0, 1):
            if k + 3 > len(seq): break
            for s in styles(seq[k]):
                if any(s in styles(j) for j in seq[:k]): continue
                x = sh[s]
                if x >= EDGES[-1]: continue
                b = max(j for j, e in enumerate(EDGES) if x >= e)
                cont = any(s in styles(j) for j in seq[k + 1:k + 3])
                r = rows[b][0 if cont else 1]; r[0] += 1; r[1] += p["win"]
                per.append((x, s, cont, p["win"]))
out = []
for b in range(len(EDGES) - 1):
    (nc, wc), (nr, wr) = rows[b]
    pc = wc / nc if nc else None; pr = wr / nr if nr else None
    se = math.sqrt(pc * (1 - pc) / nc + pr * (1 - pr) / nr) if nc and nr else None
    out.append({"share": f"{EDGES[b]:.0%}-{EDGES[b+1]:.0%}", "continue": [nc, round(pc, 3) if pc is not None else None],
                "revert": [nr, round(pr, 3) if pr is not None else None], "diff": round(pc - pr, 3) if se else None, "se": round(se, 3) if se else None})
for o in out: print(o)
json.dump({"patch": PATCH, "buckets": out}, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "style_cutoff.json"), "w"), indent=1)
