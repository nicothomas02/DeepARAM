"""Champions whose players do better never buying boots (Nico 2026-11-27: drop boots from the build where skipping
them is better, no separate "No boots" row).

Never-buyers are players who bought no boots at all, Boots (1001) included, in a game of 10+ minutes. Selling boots late
is a different decision (archive 2026-11-24: -2.6 +- 2.4 pts) and doesn't count. Public stats can't tell these apart:
AramHex's boots lists leave out most no-boots games' reasons (about 46% of a champion's games have none of its listed
boots), so this uses purchase timelines.

Per champion: never-buyers' win rate minus buyers', matched on game length (5-minute buckets, the buyers' rate in the
same bucket), then shrunk toward the all-champion difference (empirical Bayes). A champion is listed under "skip"
only when the shrunk difference is positive with z >= 3.4 (a 5% false-positive bar across 173 champions) and it has
at least 30 never-buyers. The site card and the apps' path drop boots for listed champions (lib/card-score.ts
skipsBoots).

    python data/estimates/no_boots.py <timelines-compact.jsonl.gz> [--out data/estimates/no_boots.json]

Input: the owner's archive purchase timelines (all ten players, private). Output: counts only, no names or games.
"""
from __future__ import annotations

import argparse, ast, collections, gzip, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
BOOTS = {1001, 2422, 3005, 3006, 3009, 3010, 3013, 3020, 3047, 3111, 3117, 3158}
Z, MIN_NEVER = 3.4, 30


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("timelines")
    ap.add_argument("--out", default=os.path.join(HERE, "no_boots.json"))
    a = ap.parse_args()
    P = lambda x: ast.literal_eval(x) if isinstance(x, str) else x
    rows = []  # (champion key, duration bucket, never, win)
    games = 0
    for line in gzip.open(a.timelines, "rt", encoding="utf-8"):
        g = json.loads(line)
        if g["duration"] < 600:
            continue
        games += 1
        b = int(g["duration"] // 300)
        for p in g["players"]:
            never = not any(x[1] == "purchased" and x[2] in BOOTS for x in P(p["items"]))
            rows.append((str(p["champ"]), b, never, p["win"] in (True, "True")))
    by = collections.defaultdict(list)
    for r in rows:
        by[r[0]].append(r)

    def diff(rs):
        cell = collections.defaultdict(lambda: [0, 0])
        for _, b, never, w in rs:
            if not never:
                cell[b][0] += 1; cell[b][1] += w
        d = [w - cell[b][1] / cell[b][0] for _, b, never, w in rs if never and cell[b][0] >= 5]
        if len(d) < 2:
            return None
        m = sum(d) / len(d)
        # binomial standard error (a sample SD from a handful of games can be near zero)
        return m, 0.5 / math.sqrt(len(d)), len(d), sum(1 for r in rs if not r[2])

    overall = diff(rows)
    per = {c: diff(rs) for c, rs in by.items()}
    per = {c: v for c, v in per.items() if v}
    ms = [v[0] for v in per.values()]
    mu = overall[0]
    tau2 = max(0.0, sum((m - mu) ** 2 for m in ms) / len(ms) - sum(v[1] ** 2 for v in per.values()) / len(per))
    out, skip = {}, []
    for c, (m, se, n, nb) in sorted(per.items()):
        k = tau2 / (tau2 + se ** 2) if tau2 > 0 else 0.0
        shr = mu + k * (m - mu)
        sse = math.sqrt(k) * se if k > 0 else se
        z = shr / sse if sse > 0 else 0.0
        out[c] = {"never": n, "bought": nb, "diff": round(100 * m, 1), "se": round(100 * se, 1), "shrunk": round(100 * shr, 1), "z": round(z, 2)}
        if n >= MIN_NEVER and shr > 0 and z >= Z:
            skip.append(int(c))
    res = {
        "_about": "Champions whose players win more never buying boots, matched on game length and shrunk (data/estimates/no_boots.py). "
        "skip = champions whose card and path drop boots. Counts from the owner's archived games, all ten players.",
        "games": games, "overall": {"diff": round(100 * overall[0], 1), "se": round(100 * overall[1], 1), "never": overall[2]},
        "tau": round(100 * math.sqrt(tau2), 2), "skip": sorted(skip), "champions": out,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    print(f"{games} games, overall never-buyers {res['overall']}, spread between champions {res['tau']} pts, skip {skip}")


if __name__ == "__main__":
    main()
