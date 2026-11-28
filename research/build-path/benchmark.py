"""Benchmark of ways to build a champion's full item path (Nico 2026-11-28: "extrapolate full build like lolalytics",
"see if there's other options that might be better for determining build").

Inputs are public data only (AramHex 16.23 single items, ordered 3-item cores and champion games; 101's top-10 six-item
builds). Every method gets the same core (the best-scoring ordered core) and fills the slots after it; it differs only
in how. Shared scorer: win rate shrunk toward the champion's win rate (m games), the same for every method.

Methods
  popular    most-held single items after the core (pick rate only).
  best_wr    best shrunk win rate single items with pick >= 1% (today's per-slot fallback, roughly).
  real_full  best shrunk real six-item build that holds the core; else best_wr (today's card, roughly).
  chain      lolalytics-style: item N given items 1..N-1, from the six-item builds that hold them, shrunk toward the
             single-item pick share (a games); picks the most likely next item.
  chain_wr   chain, but picks the best shrunk win rate among next items with conditional share >= 5%.
  cooc       single-item score plus co-occurrence (PMI over six-item builds and cores) with items already chosen.
  beam       beam search (width 8) over cooc's score, best total path.
  shrunk     real_full with each real build's win rate shrunk toward the mean of its items' single win rates.

Evaluation (held out: the owner archive, all ten players, never used as input)
  agree      share of the player's late items (after their first three legendaries) that the path's late items hold,
             averaged; how well the path predicts what players finish with.
  follow     win rate of players who hold 2+ of the path's late items minus those who hold 0-1, each against their
             champion's AramHex win rate (pp, correlational), with SE.
  real       share of champions whose path is one of 101's real six-item builds.
    python3 research/build-path/benchmark.py
"""
import json, gzip, math, os, collections, itertools
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARCH = "/mnt/project-files/private/owner-games/timelines-compact.jsonl.gz"
P = os.path.join(ROOT, "data/aramhex/patches/16.23")
dd = json.load(open(os.path.join(ROOT, "web/public/assets/dd/16.23.1/data/en_US/item.json")))["data"]
BOOTS = {int(k) % 10000 for k, v in dd.items() if "Boots" in v["tags"]}
FIN = {int(k) % 10000 for k, v in dd.items() if v.get("gold", {}).get("total", 0) >= 2000 and not v.get("into") and "Boots" not in v["tags"]}
B = lambda i: i % 10000
items = json.load(open(f"{P}/items.json")); cores = json.load(open(f"{P}/cores.json"))
M = 400  # shrink games

champs = {}
for c, row in items.items():
    g, w = row["all"]; p0 = w / g
    single = {}
    for i, (gi, wi) in row["items"].items():
        i = B(int(i))
        if i in FIN: a = single.setdefault(i, [0, 0]); a[0] += gi; a[1] += wi
    cn = os.path.join(ROOT, f"data/cn/builds/{c}.json")
    full = []
    if os.path.exists(cn):
        for f in json.load(open(cn))["items"].get("full_builds", []):
            s = frozenset(B(i) for i in f["items"] if B(i) in FIN)
            gm = f["pick_rate"] * g; full.append((s, gm, f["win_rate"] * gm))
    cr = [([B(i) for i in k], gi, wi) for k, gi, wi in cores.get(c, [])]
    champs[int(c)] = dict(g=g, p0=p0, single=single, full=full, cores=cr)

def sh(g, w, p0, m=M): return (w + m * p0) / (g + m)

def core_of(C):
    if not C["cores"]: return []
    return max(C["cores"], key=lambda r: sh(r[1], r[2], C["p0"]))[0]

def L(C):  # legendary slots: the top real build's count, else 5
    return len(max(C["full"], key=lambda f: f[1])[0]) if C["full"] else 5

def cand(C, used): return [i for i, (g, _) in C["single"].items() if i not in used and g / C["g"] >= 0.01]

def fill(C, path, key):
    path = list(path)
    while len(path) < L(C):
        cs = cand(C, set(path))
        if not cs: break
        path.append(max(cs, key=lambda i: key(i, path)))
    return path

def popular(C): return fill(C, core_of(C), lambda i, p: C["single"][i][0])
def best_wr(C): return fill(C, core_of(C), lambda i, p: sh(*C["single"][i], C["p0"]))

def real_full(C, shrink=False):
    core = set(core_of(C)); best = None
    for s, gm, wm in C["full"]:
        if not core <= s: continue
        prior = sum(sh(*C["single"].get(i, (0, 0)), C["p0"]) for i in s) / len(s) if shrink else C["p0"]
        sc = sh(gm, wm, prior, 200 if shrink else M)
        if best is None or sc > best[0]: best = (sc, s)
    if not best: return best_wr(C)
    return core_of(C) + sorted(best[1] - core, key=lambda i: -C["single"].get(i, (0, 0))[0])

def cond(C, S, i, a=300):
    nS = sum(gm for s, gm, _ in C["full"] if S <= s); nSi = sum(gm for s, gm, _ in C["full"] if S | {i} <= s)
    marg = C["single"][i][0] / C["g"]
    return (nSi + a * marg) / (nS + a)

def chain(C): return fill(C, core_of(C), lambda i, p: cond(C, frozenset(p), i))
def chain_wr(C):
    return fill(C, core_of(C), lambda i, p: (cond(C, frozenset(p), i) >= 0.05, sh(*C["single"][i], C["p0"])))

def pmi_table(C):
    pair, one, tot = collections.Counter(), collections.Counter(), 0
    rows = [(s, gm) for s, gm, _ in C["full"]] + [(frozenset(k), gi) for k, gi, _ in C["cores"]]
    for s, gm in rows:
        tot += gm
        for i in s: one[i] += gm
        for a, b in itertools.combinations(sorted(s), 2): pair[a, b] += gm
    def pmi(a, b):
        a, b = min(a, b), max(a, b)
        if not tot or not one[a] or not one[b]: return 0.0
        return math.log((pair[a, b] + 1) * tot / ((one[a] + 1) * (one[b] + 1)))
    return pmi

LAM = 0.01
def cooc(C):
    pmi = pmi_table(C)
    return fill(C, core_of(C), lambda i, p: sh(*C["single"][i], C["p0"]) + LAM * sum(pmi(i, j) for j in p) / max(1, len(p)))

def beam(C, W=8):
    pmi = pmi_table(C); core = core_of(C)
    def score(p): return sum(sh(*C["single"][i], C["p0"]) for i in p if i in C["single"]) + LAM * sum(pmi(a, b) for a, b in itertools.combinations(p, 2)) / 3
    beams = [core]
    while len(beams[0]) < L(C):
        nxt = [b + [i] for b in beams for i in cand(C, set(b))]
        if not nxt: break
        uniq = {frozenset(b[3:]): b for b in nxt}
        beams = sorted(uniq.values(), key=score, reverse=True)[:W]
    return beams[0]

METHODS = dict(popular=popular, best_wr=best_wr, real_full=real_full, chain=chain, chain_wr=chain_wr, cooc=cooc, beam=beam,
               shrunk=lambda C: real_full(C, True))
paths = {m: {c: f(C) for c, C in champs.items() if C["cores"]} for m, f in METHODS.items()}

players = []
for line in gzip.open(ARCH, "rt"):
    for p in json.loads(line)["players"]:
        if p["champ"] not in champs: continue
        seq = []
        for e in p["items"]:
            i = B(e[2])
            if e[1] == "purchased" and i in FIN and i not in seq: seq.append(i)
        if len(seq) >= 4: players.append((p["champ"], seq, p["win"]))

out = {}
for m, P_ in paths.items():
    ag, hi, lo = [], [], []
    for c, seq, win in players:
        if c not in P_: continue
        late = set(P_[c][3:]); mine = set(seq[3:6])
        ag.append(len(late & mine) / len(mine))
        x = win - champs[c]["p0"]
        (hi if len(late & set(seq)) >= 2 else lo).append(x)
    mean = lambda a: sum(a) / len(a)
    var = lambda a: sum((v - mean(a)) ** 2 for v in a) / (len(a) - 1)
    d = mean(hi) - mean(lo); se = math.sqrt(var(hi) / len(hi) + var(lo) / len(lo))
    real = sum(any(frozenset(P_[c]) == s for s, _, _ in champs[c]["full"]) for c in P_) / len(P_)
    out[m] = dict(agree=round(mean(ag), 3), follow_pp=round(100 * d, 1), se_pp=round(100 * se, 1), followers=len(hi), real=round(real, 2))
    print(m, out[m])
json.dump(dict(players=len(players), methods=out), open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "benchmark.json"), "w"), indent=1)
