"""Accuracy scorecard (Nico 2026-11-23): how well each patch's DeepScore picks held up on the next patch.

For every pair of AramHex patches (T, T+1): each champion's top 5 augments and top 3 items by DeepScore at T (pooled
with earlier patches as the site does, common.pool, then shrunk like web/src/lib/card-score.ts scoreRows, with the
1/4 following rule), scored on T+1 by their lead over the champion's average there. The same for the 5 most-picked
augments / 3 most-bought items, as the baseline. Champions: how many of T's top 20 by win rate stayed above 50%.
Writes data/aramhex/scorecard.json for the Patches page. Aggregates only: no single augment's win rate is shown."""
import json
import os

import common as ah

OUT = os.path.join(ah.HERE, "scorecard.json")
FOLLOW = 0.25
MIN_GAMES_LEAD = 2000


def shrink(pooled_rows):
    """{key: (wr, games, n)} -> {key: shrunk lead} (empirical Bayes over the champion's list)."""
    keys = list(pooled_rows)
    if not keys:
        return {}
    tot = sum(pooled_rows[k][1] for k in keys)
    mean = sum(pooled_rows[k][0] * pooled_rows[k][1] for k in keys) / tot
    xs = [pooled_rows[k][0] - mean for k in keys]
    vs = [max(pooled_rows[k][0] * (1 - pooled_rows[k][0]), 0.05) / pooled_rows[k][1] for k in keys]
    m = sum(xs) / len(xs)
    tau2 = max(sum((x - m) ** 2 for x in xs) / len(xs) - sum(vs) / len(vs), 1e-5)
    return {k: tau2 / (tau2 + v) * x for k, x, v in zip(keys, xs, vs)}


def picks(now, pooled, top):
    """DeepScore top `top` with a following, and the `top` most picked."""
    s = shrink(pooled)
    maxg = max((g for g, _ in now.values()), default=0)
    ok = [k for k in s if now[k][0] >= FOLLOW * maxg or now[k][0] >= MIN_GAMES_LEAD]
    best = sorted(ok, key=lambda k: -s[k])[:top]
    popular = sorted(now, key=lambda k: -now[k][0])[:top]
    return best, popular


def score(pairs):
    leads = [x for x in pairs if x is not None]
    if not leads:
        return None
    return {"n": len(leads), "hit": round(sum(1 for x in leads if x > 0) / len(leads), 3),
            "lead": round(sum(leads) / len(leads), 4)}


def table_rows(t, cid, nested):
    r = (t or {}).get(cid)
    if r is None:
        return None
    return r["items"] if nested else r


def card(T, nxt, name, nested, top, exclude=()):
    hist_patches = [T] + ah.earlier(T)
    tables = [ah.load(p, name) for p in hist_patches]
    target = ah.load(nxt, name) or {}
    best_l, pop_l = [], []
    for cid in (tables[0] or {}):
        now = {k: v for k, v in (table_rows(tables[0], cid, nested) or {}).items() if k not in exclude and v[0] > 0}
        tg = {k: v for k, v in (table_rows(target, cid, nested) or {}).items() if k not in exclude}
        if not now or not tg:
            continue
        hist = [now]
        for t in tables[1:]:
            r = table_rows(t, cid, nested)
            if r is None:
                break
            hist.append({k: v for k, v in r.items() if k not in exclude})
        pooled = ah.pool(hist)
        lead = ah.leads(tg)
        best, popular = picks(now, pooled, top)
        best_l += [lead[k][0] if k in lead else None for k in best]
        pop_l += [lead[k][0] if k in lead else None for k in popular]
    b, p = score(best_l), score(pop_l)
    return {"deepscore": b, "popular": p} if b and p else None


def champions(T, nxt, top=20):
    a, b = ah.champion_rates(T), ah.champion_rates(nxt)
    best = sorted(a, key=lambda c: -a[c][0])[:top]
    kept = [c for c in best if c in b]
    if not kept:
        return None
    return {"n": len(kept), "still_above_50": round(sum(1 for c in kept if b[c][0] > 0.5) / len(kept), 3),
            "avg_next": round(sum(b[c][0] for c in kept) / len(kept), 4)}


def main():
    ps = ah.patches()
    out = {"note": "Each patch's DeepScore picks, scored on the next patch's games.", "pairs": []}
    for T, nxt in zip(ps, ps[1:]):
        if not (ah.has(T, "augments") and ah.has(nxt, "augments")):
            continue
        boots = set()
        for v in (ah.load(T, "boots") or {}).values():
            boots |= set(v["items"])
        row = {"from": T, "to": nxt, "to_matches": ah.matches(nxt),
               "to_partial": bool((ah.load(nxt, "meta") or {}).get("window", {}).get("end_exclusive")) and nxt == ps[-1],
               "augments": card(T, nxt, "augments", False, 5)}
        if ah.has(T, "items") and ah.has(nxt, "items"):
            row["items"] = card(T, nxt, "items", True, 3, exclude=boots)
        row["champions"] = champions(T, nxt)
        out["pairs"].append(row)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    for r in out["pairs"]:
        a = r["augments"]
        print(r["from"], "->", r["to"], "augments", a["deepscore"], "popular", a["popular"],
              "items", (r.get("items") or {}).get("deepscore"), (r.get("items") or {}).get("popular"), "champs", r["champions"])


if __name__ == "__main__":
    main()
