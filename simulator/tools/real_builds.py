# Each champion's most-played real build in the simulator's item and augment names: the first full build
# with at least four items the simulator models, else the most-picked boots, core and other items; plus the
# four most-picked augments it models. Shared by tools/accuracy.py, tools/sensitivity.py and tools/validation.py.
import json, os

R = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def load(game=None):
    """Item and augment ids to the simulator's names, from game data folder `game` (default: the live data)."""
    game = game or f"{R}/simulator/data"
    items = json.load(open(f"{game}/items.json"))["items"]
    augs = json.load(open(f"{game}/augments.json"))["augments"]
    return {v["id"]: k for k, v in items.items()}, {v["id"]: k for k, v in augs.items()}


def real_build(c, by_id, aug_by_id, root=R):
    f = f"{root}/data/cn/builds/{c['champion_id']}.json"
    if not os.path.exists(f): return None
    b = json.load(open(f))
    picks = []
    for fb in b["items"].get("full_builds", []):
        ks = [by_id[i] for i in fb["items"] if i in by_id]
        if len(ks) >= 4: picks = ks; break
    if not picks:
        for grp in ("boots", "core", "other"):
            for e in b["items"].get(grp, []):
                for i in e["items"]:
                    if i in by_id and by_id[i] not in picks: picks.append(by_id[i])
    picks = picks[:6]
    a = [aug_by_id[x["id"]] for x in sorted(b["augments"]["all"], key=lambda x: -x["pick_rate"]) if x["id"] in aug_by_id][:4]
    return (picks, a) if picks else None


def rank(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v)
    i = 0
    while i < len(o):  # average ranks for ties
        j = i
        while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]: j += 1
        for k in range(i, j + 1): r[o[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(a, b):
    a, b = rank(a), rank(b); n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = sum((x - ma) ** 2 for x in a) ** 0.5; vb = sum((y - mb) ** 2 for y in b) ** 0.5
    return cov / (va * vb) if va and vb else 0.0
