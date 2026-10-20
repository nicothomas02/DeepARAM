#!/usr/bin/env python3
"""Build data/estimates/estimates.json: stats the Mayhem feed lacks, estimated from it plus fitted.json.

Sections (all for the live patch; every number here is an estimate unless noted):
  vs_average         champion damage/tank share, kill participation, time dead vs the pick-weighted
                     field (exact, from the feed)
  profiles           per champion game length, kills, deaths, assists, multikills, CS, largest spree, damage/min and its physical/magic/
                     true split, damage taken and mitigated/min, healing/min, crowd control, gold/min,
                     turret damage, each with a band (high/average/low vs the field)
  augments           per champion: each augment's win rate on that champion and its lift
  augment_pairs      per champion: the most likely augment pairs, how often, and their win rate
  augment_stages     per augment: share of picks at each of the 4 stages
  augment_items      per augment: the items most built by champions who take it
  rarity_odds        overall chance an augment is Silver/Gold/Prismatic, per stage, and stage to stage
  items              per item: win rate, lift, share of builds, how often it's item 1/2/3, augment-granted
  duos               champion pairs: win rate vs the expected one from both champions (lift)
  game_length        typical game length
  side               blue/red side win rate
  fun                short top-10 lists from the above
  item_timing        minute each item of the most common core build is finished

Usage: python3 data/estimates/build.py   (standard library only)
"""

import datetime as dt
import itertools
import json
import math
import os
import sys
from collections import defaultdict

import common as cm

MIN_PAIR = 0.003


def pick_weighted_mean(stats, key):
    tot = sum(s["pick_rate"] for s in stats.values())
    return sum(s["pick_rate"] * s[key] for s in stats.values()) / tot


def percentile(values, v):
    return round(sum(1 for x in values if x <= v) / len(values), 3)


def vs_average(stats):
    out = {}
    keys = ["damage", "tank", "kp", "dead"]
    means = {k: pick_weighted_mean(stats, k) for k in keys}
    lists = {k: [s[k] for s in stats.values()] for k in keys}
    for c, s in stats.items():
        out[c] = {k: {"value": round(s[k], 4), "average": round(means[k], 4), "delta": round(s[k] - means[k], 4),
                      "percentile": percentile(lists[k], s[k])} for k in keys}
    return out


def profiles(stats, fitted):
    dd = cm.data_dragon()
    p = fitted["profiles"]
    feats = {}
    for c, s in stats.items():
        info = dd.get(c, {"tags": [], "stats": {}})
        feats[c] = [1.0, s["damage"] * 5, s["tank"] * 5, s["kp"] * 2, s["dead"] / 100,
                    1.0 if info["stats"].get("attackrange", 500) <= 250 else 0.0] + [1.0 if t in info["tags"] else 0.0 for t in cm.TAGS]
    out = defaultdict(dict)
    for name, d in p["stats"].items():
        vals = {}
        for c in stats:
            prior = sum(a * b for a, b in zip(d["coef"], feats[c]))
            mean, n = d["champions"].get(c, [prior, 0])
            vals[c] = (mean * n + prior * p["prior_games"]) / (n + p["prior_games"])
        if name.endswith("_share"):  # the three damage types add up to 1
            continue
        ordered = sorted(vals.values())
        for c, v in vals.items():
            q = percentile(ordered, v)
            out[c][name] = {"value": round(v, 3), "band": "high" if q >= 2 / 3 else "low" if q < 1 / 3 else "average"}
    # damage split, normalised
    shares = {}
    for c in stats:
        raw = {}
        for name in ("physical_share", "magic_share", "true_share"):
            d = p["stats"][name]
            prior = sum(a * b for a, b in zip(d["coef"], feats[c]))
            mean, n = d["champions"].get(c, [prior, 0])
            raw[name[:-6]] = max((mean * n + prior * p["prior_games"]) / (n + p["prior_games"]), 0.0)
        tot = sum(raw.values()) or 1
        out[c]["damage_split"] = {k: round(v / tot, 3) for k, v in raw.items()}
    return dict(out)


START_GOLD = 1400  # gold every player starts a Mayhem game with


def item_timing(stats, builds, prof):
    """Minute each core item is finished: cumulative cost of the most common core build, less the
    starting gold, over the champion's estimated gold per minute (its earned gold includes the start)."""
    cost = {int(k): v["gold"]["total"] for k, v in cm.load(cm.dd_file("item.json"))["data"].items()}
    out = {}
    for c, b in builds.items():
        core = b["items"]["core"]
        if c not in prof or not core:
            continue
        mins = prof[c]["game_minutes"]["value"]
        gpm = prof[c]["gold_per_min"]["value"] - START_GOLD / mins
        total, times = 0, []
        for i in core[0]["items"]:
            total += cost.get(i, 0)
            times.append(round(max(total - START_GOLD, 0) / gpm, 1))
        out[c] = {"items": core[0]["items"], "minutes": times}
    return out


def augments_on_champions(stats, builds, fair, model):
    dev, _ = cm.augment_on_champion(stats, builds, fair)
    out = {}
    for c, b in builds.items():
        if c not in stats:
            continue
        wr = stats[c]["win_rate"]
        rows = []
        for a in b["augments"]["all"]:
            aid = str(a["id"])
            if aid not in dev:
                continue
            est = cm.augment_win_rate(wr, dev[aid], a.get("grade"), model)
            rows.append({"id": a["id"], "pick_rate": a["pick_rate"], "win_rate": round(est, 4), "lift": round(est - wr, 4)})
        out[c] = sorted(rows, key=lambda r: -r["win_rate"])
    return out


def augment_pairs(stats, builds, augs, tiers, top=12):
    """Pairs of augments on one champion. A pair's share of players is estimated as the product of the
    two pick rates (independence); its win rate adds both augments' lifts on the logit scale."""
    out = {}
    for c, rows in augs.items():
        wr = stats[c]["win_rate"]
        common = sorted(rows, key=lambda r: -r["pick_rate"])[:15]
        pairs = []
        for a, b in itertools.combinations(common, 2):
            share = a["pick_rate"] * b["pick_rate"]  # pick rate = share of players taking it (sums to ~4)
            if share < MIN_PAIR:
                continue
            z = cm.logit(a["win_rate"]) + cm.logit(b["win_rate"]) - cm.logit(wr)
            pairs.append({"ids": [a["id"], b["id"]], "pick_rate": round(share, 4), "win_rate": round(cm.sigmoid(z), 4)})
        out[c] = sorted(pairs, key=lambda r: -r["win_rate"])[:top]
    return out


def augment_stages(fitted):
    out = {}
    for a, v in fitted["augment_stages"].items():
        tot = sum(x[0] for x in v)
        shares = [round(x[0] / tot, 3) for x in v]
        out[a] = {"stages": shares, "usual": 1 + max(range(4), key=lambda i: shares[i])}
    return out


def rarity_odds(fair, tiers, fitted):
    picks = defaultdict(float)
    for a, r in fair.items():
        t = tiers.get(a) or r.get("tier")
        if t in cm.RARITIES:
            picks[t] += r["pick_rate"]
    tot = sum(picks.values())
    return {"overall": {t: round(picks[t] / tot, 4) for t in cm.RARITIES},
            "by_stage": fitted["stages"]["by_stage"], "next": fitted["stages"]["next"]}


def items(stats, builds, granted):
    acc = defaultdict(lambda: {"w": 0.0, "wins": 0.0, "base": 0.0, "slots": [0.0, 0.0, 0.0]})
    total_w = sum(stats[c]["pick_rate"] for c in builds if c in stats)
    for c, b in builds.items():
        if c not in stats:
            continue
        pr, cwr = stats[c]["pick_rate"], stats[c]["win_rate"]
        # Within each list, the rows an item appears in are summed; the list where it's most common
        # counts, as on the site (web/src/lib/item-pages.ts). Components and starter items only show up
        # in the starting list.
        best = {}
        for name in ("other", "boots", "starting"):
            sums = defaultdict(lambda: [0.0, 0.0])
            for row in b["items"].get(name, []):
                for i in set(row["items"]):
                    sums[i][0] += row["pick_rate"]
                    sums[i][1] += row["pick_rate"] * row["win_rate"]
            for i, m in sums.items():
                if m[0] > best.get(i, [0.0])[0]:
                    best[i] = m
        for i, (pick, wins) in best.items():
            w = pr * min(1.0, pick)
            acc[i]["w"] += w
            acc[i]["wins"] += w * wins / pick
            acc[i]["base"] += w * cwr
        for row in b["items"]["core"]:
            for pos, i in enumerate(row["items"][:3]):
                acc[i]["slots"][pos] += pr * row["pick_rate"]
    out = []
    for i, a in acc.items():
        if a["w"] <= 0:
            continue
        slot_tot = sum(a["slots"]) or 1
        out.append({"id": i, "win_rate": round(a["wins"] / a["w"], 4), "lift": round((a["wins"] - a["base"]) / a["w"], 4),
                    "build_share": round(a["w"] / total_w, 4),
                    "slots": [round(s / slot_tot, 3) for s in a["slots"]] if sum(a["slots"]) else None,
                    "granted": i in granted})
    return sorted(out, key=lambda r: -r["build_share"])


def augment_items(stats, builds, top=6):
    """Items most built by the champions who take each augment: sum over champions of
    P(champion | augment) x P(item | champion)."""
    item_by_c = {c: {i: row["pick_rate"] for row in b["items"]["other"] for i in row["items"]} for c, b in builds.items()}
    by_aug = defaultdict(lambda: defaultdict(float))
    norm = defaultdict(float)
    for c, b in builds.items():
        if c not in stats:
            continue
        for a in b["augments"]["all"]:
            w = stats[c]["pick_rate"] * a["pick_rate"]
            norm[a["id"]] += w
            for i, p in item_by_c[c].items():
                by_aug[a["id"]][i] += w * p
    return {str(a): [{"id": i, "share": round(v / norm[a], 3)} for i, v in sorted(d.items(), key=lambda x: -x[1])[:top]]
            for a, d in by_aug.items() if norm[a] > 0}


def duos(stats):
    rows = cm.load(os.path.join(cm.CN, "duos.json"))["duos"]
    out = []
    for d in rows:
        a, b = (str(x) for x in d["champion_ids"])
        if a not in stats or b not in stats:
            continue
        exp = cm.sigmoid(cm.logit(stats[a]["win_rate"]) + cm.logit(stats[b]["win_rate"]))
        out.append({"ids": [int(a), int(b)], "win_rate": d["win_rate"], "pick_rate": d["pick_rate"],
                    "expected": round(exp, 4), "lift": round(d["win_rate"] - exp, 4)})
    return sorted(out, key=lambda r: -r["lift"])


def game_length(fitted):
    # Typical length only. Per-champion short/long-game slopes showed no signal in the fitted games
    # (split-half correlation ~0), so no specialists are published until real games are in.
    return {"minutes": fitted["length_side"]["minutes"]}


def fun(stats, prof):
    def top(key_fn, n=10):
        return [int(c) for c in sorted(stats, key=key_fn, reverse=True)[:n]]
    return {
        "damage": top(lambda c: stats[c]["damage"]),
        "tank": top(lambda c: stats[c]["tank"]),
        "teamplay": top(lambda c: stats[c]["kp"]),
        "healing": top(lambda c: prof[c]["heal_per_min"]["value"]),
        "crowd_control": top(lambda c: prof[c]["cc_seconds"]["value"]),
        "multikills": top(lambda c: prof[c]["multikills"]["value"]),
        "towers": top(lambda c: prof[c]["turret_damage"]["value"]),
    }


def main():
    fitted = cm.load(os.path.join(cm.HERE, "fitted.json"))
    stats, builds, fair = cm.champion_stats(), cm.builds(), cm.fair_augments()
    rules = cm.augment_rules()
    tiers = rules["tiers"]
    granted = {g["id"] for g in rules.get("grantedItems", [])}
    augs = augments_on_champions(stats, builds, fair, fitted["augment_model"])
    prof = profiles(stats, fitted)
    out = {
        "patch": cm.live_patch(),
        "estimated": True,
        "built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "vs_average": vs_average(stats),
        "profiles": prof,
        "augments": augs,
        "augment_pairs": augment_pairs(stats, builds, augs, tiers),
        "augment_stages": augment_stages(fitted),
        "augment_items": augment_items(stats, builds),
        "rarity_odds": rarity_odds(fair, tiers, fitted),
        "items": items(stats, builds, granted),
        "duos": duos(stats),
        "game_length": game_length(fitted),
        "side": {"blue": fitted["length_side"]["blue_win_rate"], "red": round(1 - fitted["length_side"]["blue_win_rate"], 4)},
        "fun": fun(stats, prof),
        "item_timing": item_timing(stats, builds, prof),
    }
    with open(os.path.join(cm.HERE, "estimates.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"patch {out['patch']}: {len(augs)} champions, {sum(len(v) for v in augs.values())} champion augments, "
          f"{len(out['items'])} items, {len(out['duos'])} duos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
