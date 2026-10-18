"""Inputs shared by fit_games.py and build.py (standard library only)."""

import csv
import glob
import json
import math
import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CN = os.path.join(REPO, "data", "cn")
HERE = os.path.dirname(os.path.abspath(__file__))
TAGS = ["Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"]
GRADES = ["S", "A", "B", "C"]
RARITIES = ["Silver", "Gold", "Prismatic"]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def logit(p):
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def sigmoid(x):
    return 1 / (1 + math.exp(-x))


def live_patch():
    with open(os.path.join(CN, "history", "patches.csv"), encoding="utf-8") as f:
        return list(csv.DictReader(f))[-1]["patch"]


def champion_stats(patch=None):
    """{champion id: row} from by_patch.csv for the live (or given) patch, numbers as floats."""
    patch = patch or live_patch()
    out = {}
    with open(os.path.join(CN, "history", "by_patch.csv"), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["patch"] == patch:
                out[r["champion_id"]] = {
                    "name": r["name"],
                    "win_rate": float(r["win_rate"]),
                    "pick_rate": float(r["pick_rate"]),
                    "damage": float(r["avg_damage_ratio"]),
                    "tank": float(r["avg_tank_ratio"]),
                    "kp": float(r["avg_participation_rate"]),
                    "dead": float(r["avg_death_time"]),
                }
    return out


def builds():
    """{champion id: builds json} from data/cn/builds/."""
    out = {}
    for f in glob.glob(os.path.join(CN, "builds", "*.json")):
        d = load(f)
        if "augments" in d:
            out[str(d["id"])] = d
    return out


def augment_rules():
    return load(os.path.join(REPO, "guide", "augment_rules.json"))


def fair_augments():
    """{augment id: row} from data/cn/augments.json with `fair` win rate: within each rarity, the
    pick-rate slope is taken out and the rarity re-centred on 50% (same as web/src/lib/augment-winrate.ts)."""
    rows = load(os.path.join(CN, "augments.json"))["augments"]
    groups = {}
    for r in rows:
        groups.setdefault(str(r.get("tier") or "").lower(), []).append(r)
    out = {}
    for g in groups.values():
        n = len(g)
        mp = sum(r["pick_rate"] for r in g) / n
        mw = sum(r["win_rate"] for r in g) / n
        sxx = sum((r["pick_rate"] - mp) ** 2 for r in g)
        slope = sum((r["pick_rate"] - mp) * (r["win_rate"] - mw) for r in g) / sxx if n > 2 and sxx > 0 else 0
        for r in g:
            out[str(r["augment_id"])] = dict(r, fair=r["win_rate"] - slope * (r["pick_rate"] - mp) - (mw - 0.5))
    return out


def data_dragon():
    """{champion id: {"name", "tags", "stats"}} from the newest Data Dragon copy in the repo."""
    dirs = sorted(glob.glob(os.path.join(REPO, "web", "public", "assets", "dd", "[0-9]*")),
                  key=lambda p: [int(x) for x in os.path.basename(p).split(".")])
    data = load(os.path.join(dirs[-1], "data", "en_US", "champion.json"))["data"]
    return {v["key"]: {"name": v["name"], "tags": v["tags"], "stats": v["stats"]} for v in data.values()}


def augment_on_champion(stats, builds_, fair):
    """Pieces of the per-champion augment win rate model: for each augment, how far its fair win rate sits
    above the champions that take it (dev), and each (champion, augment) grade and pick share."""
    w, rows = {}, []
    for c, b in builds_.items():
        if c not in stats:
            continue
        for a in b["augments"]["all"]:
            weight = stats[c]["pick_rate"] * a["pick_rate"]
            w.setdefault(str(a["id"]), []).append((weight, stats[c]["win_rate"]))
            rows.append((c, str(a["id"]), a.get("grade"), a["pick_rate"]))
    dev = {}
    for a, lst in w.items():
        tot = sum(x for x, _ in lst)
        if a in fair and tot > 0:
            dev[a] = fair[a]["fair"] - sum(x * wr for x, wr in lst) / tot
    return dev, rows


def augment_win_rate(champ_wr, dev, grade, model):
    """Estimated win rate of one augment on one champion (logit scale, see fit_games.py)."""
    z = logit(champ_wr) + model["lambda"] * logit(0.5 + dev) + model["grade"].get(grade or "", 0.0)
    return sigmoid(z)
