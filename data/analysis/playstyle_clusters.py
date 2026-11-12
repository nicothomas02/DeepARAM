"""Champion playstyle clusters: which champions actually play alike in Mayhem, from how their games go rather
than from Riot's class labels.

Features per champion: the feed's damage share, tank share, kill participation and time dead (averaged over the
last three patches, weighted by days), plus which augments the champion takes (pick rate of the 40 most-taken
augments, scaled so this block weighs the same as the four game stats). Everything is z-scored. k-means (25
restarts per k, k from 4 to 9, the best silhouette wins) gives the groups; a 2-D PCA map gives each champion a
position for the site. Each cluster is named from the stats it stands out on, and compared with Riot's classes:
a champion whose class is rare in its cluster "plays unlike its class". Standard library only.
Output: data/analysis/playstyle_clusters.json.
"""
from __future__ import annotations

import json
import math
import random

import common as c

STATS = ("avg_damage_ratio", "avg_tank_ratio", "avg_participation_rate", "avg_death_time")
STAT_WORDS = {
    "avg_damage_ratio": ("high damage share", "low damage share"),
    "avg_tank_ratio": ("soaks damage", "takes little damage"),
    "avg_participation_rate": ("in every fight", "fights less"),
    "avg_death_time": ("dies a lot", "stays alive"),
}
TOP_AUGMENTS = 40
LAST_PATCHES = 3


def features() -> tuple[list[str], list[list[float]], list[str]]:
    """Aliases, feature rows and feature names."""
    patches = [p for p in c.patches()][-LAST_PATCHES:]
    by_patch = c.by_patch()
    ids = c.id_to_alias()
    weights = {p["patch"]: max(p["days"], 1) for p in patches}
    stats: dict[str, dict[str, float]] = {}
    for p, w in weights.items():
        for alias, row in by_patch.get(p, {}).items():
            s = stats.setdefault(alias, {k: 0.0 for k in STATS} | {"w": 0.0})
            for k in STATS:
                s[k] += w * row.get(k, 0.0)
            s["w"] += w
    aliases = sorted(a for a, s in stats.items() if s["w"] > 0)
    for a in aliases:
        for k in STATS:
            stats[a][k] /= stats[a]["w"]
    # Augment pick vectors from each champion's build file.
    picks: dict[str, dict[int, float]] = {}
    totals: dict[int, float] = {}
    alias_to_id = {v: k for k, v in ids.items()}
    for a in aliases:
        path = c.ROOT / "data" / "cn" / "builds" / f"{alias_to_id.get(a, '')}.json"
        if not path.exists():
            continue
        with open(path, encoding="utf-8") as f:
            augs = json.load(f).get("augments", {})
        allp = augs.get("all", []) if isinstance(augs, dict) else []
        picks[a] = {int(x["id"]): float(x.get("pick_rate", 0)) for x in allp if "id" in x}
        for k, v in picks[a].items():
            totals[k] = totals.get(k, 0.0) + v
    top = [k for k, _ in sorted(totals.items(), key=lambda kv: -kv[1])[:TOP_AUGMENTS]]
    names = list(STATS) + [f"aug_{k}" for k in top]
    rows = []
    for a in aliases:
        row = [stats[a][k] for k in STATS] + [picks.get(a, {}).get(k, 0.0) for k in top]
        rows.append(row)
    return aliases, rows, names


def zscore(rows: list[list[float]]) -> tuple[list[list[float]], list[float], list[float]]:
    cols = list(zip(*rows))
    means = [c.mean(col) for col in cols]
    sds = [c.sd(col) or 1.0 for col in cols]
    return [[(v - m) / s for v, m, s in zip(r, means, sds)] for r in rows], means, sds


def kmeans(X: list[list[float]], k: int, seed: int) -> tuple[list[int], float]:
    rng = random.Random(seed)
    n, d = len(X), len(X[0])
    # k-means++ seeding
    centers = [X[rng.randrange(n)]]
    while len(centers) < k:
        dist = [min(sum((a - b) ** 2 for a, b in zip(x, ce)) for ce in centers) for x in X]
        tot = sum(dist) or 1.0
        r, acc = rng.random() * tot, 0.0
        for i, dd in enumerate(dist):
            acc += dd
            if acc >= r:
                centers.append(X[i])
                break
        else:
            centers.append(X[-1])
    labels = [0] * n
    for _ in range(100):
        new = [min(range(k), key=lambda j: sum((a - b) ** 2 for a, b in zip(x, centers[j]))) for x in X]
        if new == labels:
            break
        labels = new
        for j in range(k):
            members = [X[i] for i in range(n) if labels[i] == j]
            if members:
                centers[j] = [sum(col) / len(members) for col in zip(*members)]
    inertia = sum(sum((a - b) ** 2 for a, b in zip(X[i], centers[labels[i]])) for i in range(n))
    return labels, inertia


def silhouette(X: list[list[float]], labels: list[int]) -> float:
    n = len(X)
    dist = [[math.sqrt(sum((a - b) ** 2 for a, b in zip(X[i], X[j]))) for j in range(n)] for i in range(n)]
    total = 0.0
    for i in range(n):
        own = [dist[i][j] for j in range(n) if j != i and labels[j] == labels[i]]
        if not own:
            continue
        a = sum(own) / len(own)
        b = min(
            (sum(dist[i][j] for j in range(n) if labels[j] == l) / sum(1 for j in range(n) if labels[j] == l))
            for l in set(labels)
            if l != labels[i]
        )
        total += (b - a) / max(a, b)
    return total / n


def pca2(X: list[list[float]]) -> list[list[float]]:
    """First two principal components by power iteration with deflation."""
    n, d = len(X), len(X[0])
    cov = [[sum(X[i][p] * X[i][q] for i in range(n)) / (n - 1) for q in range(d)] for p in range(d)]
    comps = []
    for _ in range(2):
        v = [1.0 / math.sqrt(d)] * d
        for _ in range(200):
            w = [sum(cov[p][q] * v[q] for q in range(d)) for p in range(d)]
            norm = math.sqrt(sum(x * x for x in w)) or 1.0
            v = [x / norm for x in w]
        lam = sum(v[p] * sum(cov[p][q] * v[q] for q in range(d)) for p in range(d))
        comps.append(v)
        cov = [[cov[p][q] - lam * v[p] * v[q] for q in range(d)] for p in range(d)]
    return [[sum(x[p] * comp[p] for p in range(d)) for comp in comps] for x in X]


def classes() -> dict[str, list[str]]:
    try:
        with open(c.ROOT / "champions" / "tags.json", encoding="utf-8") as f:
            d = json.load(f)
        return {a: (v.get("classes") or v.get("roles") or []) for a, v in d["champions"].items()}
    except (OSError, KeyError, ValueError):
        return {}


def build() -> dict:
    aliases, raw, names = features()
    if len(aliases) < 20:
        return {"built": c.now_iso(), "clusters": [], "champions": []}
    Z, _, _ = zscore(raw)
    n_stats = len(STATS)
    scale = math.sqrt(n_stats / max(len(names) - n_stats, 1))
    X = [row[:n_stats] + [v * scale for v in row[n_stats:]] for row in Z]
    best = None
    for k in range(4, 10):
        runs = [kmeans(X, k, seed) for seed in range(25)]
        labels, inertia = min(runs, key=lambda r: r[1])
        sil = silhouette(X, labels)
        if best is None or sil > best[3]:
            best = (k, labels, inertia, sil)
    k, labels, _, sil = best
    coords = pca2(X)
    cls = classes()
    display = c.champion_names()
    clusters = []
    for j in range(k):
        members = [i for i in range(len(aliases)) if labels[i] == j]
        prof = {s: c.mean(Z[i][idx] for i in members) for idx, s in enumerate(STATS)}
        strongest = sorted(prof.items(), key=lambda kv: -abs(kv[1]))[:2]
        words = [STAT_WORDS[s][0 if v > 0 else 1] for s, v in strongest if abs(v) >= 0.2]
        counts: dict[str, int] = {}
        for i in members:
            for cl in cls.get(aliases[i], []):
                counts[cl] = counts.get(cl, 0) + 1
        majority = sorted(counts.items(), key=lambda kv: -kv[1])
        clusters.append(
            {
                "id": j,
                "label": ", ".join(words).capitalize() if words else "All-rounders",
                "size": len(members),
                "profile": {s: round(v, 2) for s, v in prof.items()},
                "classes": [{"name": n, "count": v} for n, v in majority[:4]],
                "champions": [aliases[i] for i in sorted(members, key=lambda i: display.get(aliases[i], aliases[i]))],
            }
        )
    champs = []
    for i, a in enumerate(aliases):
        cl = clusters[labels[i]]
        total = sum(x["count"] for x in cl["classes"]) or 1
        share = {x["name"]: x["count"] / total for x in cl["classes"]}
        own = [o for o in cls.get(a, []) if o != "Specialist"]  # Specialist is Riot's catch-all, not a playstyle
        unlike = bool(own) and all(share.get(o, 0.0) < 0.1 for o in own)
        champs.append({"alias": a, "name": display.get(a, a), "cluster": labels[i], "x": round(coords[i][0], 3), "y": round(coords[i][1], 3), "classes": own, "unlike_class": unlike})
    return {
        "built": c.now_iso(),
        "k": k,
        "silhouette": round(sil, 3),
        "features": {"stats": list(STATS), "augments": len(names) - n_stats, "patches": LAST_PATCHES},
        "clusters": clusters,
        "champions": champs,
    }


if __name__ == "__main__":
    data = build()
    c.write_json(c.OUT / "playstyle_clusters.json", data)
    print("k", data["k"], "silhouette", data["silhouette"])
    for cl in data["clusters"]:
        print(f"  [{cl['id']}] {cl['label']} ({cl['size']}): {cl['profile']} {cl['classes'][:3]}")
        print("     ", ", ".join(cl["champions"][:14]))
    print("unlike class:", [x["name"] + " " + "/".join(x["classes"]) for x in data["champions"] if x["unlike_class"]])
