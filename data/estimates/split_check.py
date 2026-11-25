#!/usr/bin/env python3
"""Re-test of the split skill cues (lib/augment-skills.ts CHAMPION_SPLITS) on Mayhem games: split_check.json.

Nico approved 2026-11-25: check the split cues (Katarina: Q to 3, then max E) against his games and public data as
they come in, drop any that don't hold up, and re-run the check as data grows (weekly maintenance).

Who counts: every player in the archived lobbies (the other nine players and the archive owner, reported apart).
A split player put exactly 3 points into the split ability before the maxed ability reached 4 (an intentional
split; one that follows right after an estimated augment pick is reactive and left out). The comparison group is the
same champion's players who maxed the same ability from the start (the order the cue replaces).

Leading indicators, not only wins (house rule): damage to champions and gold earned at minute 8, when the split's
points matter most, each standardised within the champion; plus the win rate.

Verdict per cue:
  drop      split players clearly behind on the leading indicators (mean of the two z <= -2) with >= MIN_SPLITS splits,
            or the win gap z <= -2 with >= 3 * MIN_SPLITS splits
  keep      clearly ahead or level with enough splits
  too few   fewer than MIN_SPLITS intentional splits: the cue stays on its original evidence

Usage: python3 data/estimates/split_check.py /path/to/DeepARAM-PC/archive
Standard library only. Only aggregate counts are written here.
"""

import collections
import gzip
import json
import math
import os
import re
import sys

import common as cm
from skill_orders import owner_of

OUT = os.path.join(cm.HERE, "split_check.json")
MINUTE = 8
MIN_SPLITS = 10
Z_DROP = -2.0
PICK_LEVELS = (7, 11, 15)  # augment picks are estimated at the first death after reaching these levels


def splits():
    src = open(os.path.join(cm.REPO, "web", "src", "lib", "augment-skills.ts"), encoding="utf-8").read()
    block = src[src.index("export const CHAMPION_SPLITS"):]
    block = block[:block.index("};")]
    return {m[0]: {"first": m[1], "weak": bool(m[2])} for m in
            re.findall(r"(\w+): \{ first: \"([QWE])\", points: 3(, weak: true)? \}", block)}


def rows(archive, champs):
    names = {v: k for k, v in json.load(open(os.path.join(cm.REPO, "web", "src", "data", "champion-ids.json"))).items()}
    tdir, gdir = os.path.join(archive, "timelines"), os.path.join(archive, "games")
    me = owner_of(gdir)
    out = []
    for f in sorted(os.listdir(tdir)):
        try:
            t = json.load(gzip.open(os.path.join(tdir, f)))
            g = json.load(gzip.open(os.path.join(gdir, f)))
        except (OSError, ValueError):
            continue
        t = t.get("info", t)
        frames = t.get("frames", [])
        if len(frames) <= MINUTE:
            continue
        ids = {pi["participantId"]: pi.get("player", {}).get("puuid") for pi in g.get("participantIdentities", [])}
        sk, lvl, deaths = collections.defaultdict(list), collections.defaultdict(dict), collections.defaultdict(list)
        for fr in frames:
            for e in fr.get("events", []):
                if e["type"] == "SKILL_LEVEL_UP" and e.get("levelUpType", "NORMAL") == "NORMAL" and e.get("skillSlot") in (1, 2, 3):
                    sk[e["participantId"]].append((e["timestamp"], "QWE"[e["skillSlot"] - 1]))
                elif e["type"] == "LEVEL_UP":
                    lvl[e["participantId"]].setdefault(e["level"], e["timestamp"])
                elif e["type"] == "CHAMPION_KILL":
                    deaths[e.get("victimId")].append(e["timestamp"])
        for p in g["participants"]:
            pid, ch = p["participantId"], names.get(p["championId"])
            if ch not in champs or len(sk[pid]) < 9:
                continue
            pf = frames[MINUTE]["participantFrames"].get(str(pid), {})
            seq = [s for _, s in sk[pid]]
            c9 = collections.Counter(seq[:9])
            first3 = next((s for i, s in enumerate(seq) if collections.Counter(seq[:i + 1])[s] == 3), None)
            top = max("QWE", key=lambda x: c9[x])
            sp = champs[ch]["first"]
            kind = None
            if first3 == top and top != sp:
                kind = ("std", top)
            elif first3 == sp and c9[sp] == 3 and c9[top] >= 4 and top != sp:
                i3 = [i for i, s in enumerate(seq) if s == sp][2]
                ts3 = sk[pid][i3][0]
                piv = next((ts for ts, s in sk[pid] if s == top and ts > ts3), None)
                picks = []
                for L in PICK_LEVELS:
                    lt = lvl[pid].get(L)
                    if lt is not None:
                        nd = [d for d in deaths[pid] if d >= lt]
                        picks.append(nd[0] if nd else None)
                reactive = piv is not None and any(pk is not None and ts3 < pk <= piv for pk in picks)
                kind = ("reactive" if reactive else "split", top)
            if not kind:
                continue
            out.append({"champ": ch, "kind": kind[0], "max": kind[1], "own": ids.get(pid) == me and me is not None,
                        "win": 1 if p["stats"].get("win") else 0,
                        "dmg": pf.get("damageStats", {}).get("totalDamageDoneToChampions", 0), "gold": pf.get("totalGold", 0)})
    return out


def zdiff(a, b):
    """z of mean(a) - mean(b) (Welch)."""
    if len(a) < 2 or len(b) < 2:
        return None
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    va = sum((x - ma) ** 2 for x in a) / (len(a) - 1)
    vb = sum((x - mb) ** 2 for x in b) / (len(b) - 1)
    se = math.sqrt(va / len(a) + vb / len(b))
    return round((ma - mb) / se, 2) if se > 0 else None


def main():
    archive = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DEEPARAM_ARCHIVE", os.path.expanduser("~/deeparam-pc/archive"))
    champs = splits()
    data = rows(archive, champs)
    by = collections.defaultdict(list)
    for r in data:
        by[r["champ"]].append(r)
    # standardise the indicators within each champion (all its rows), so champions pool fairly
    for ch, rs in by.items():
        for key in ("dmg", "gold"):
            m = sum(r[key] for r in rs) / len(rs)
            sd = math.sqrt(sum((r[key] - m) ** 2 for r in rs) / max(1, len(rs) - 1)) or 1
            for r in rs:
                r[key + "_z"] = (r[key] - m) / sd
    out = {}
    pooled = {"split": [], "std": []}
    for ch, cfg in sorted(champs.items()):
        rs = by.get(ch, [])
        maxed = collections.Counter(r["max"] for r in rs if r["kind"] == "split").most_common(1)
        if not maxed:  # no split yet: compare with the champion's most common max (the order the cue replaces)
            maxed = collections.Counter(r["max"] for r in rs if r["kind"] == "std").most_common(1)
        target = maxed[0][0] if maxed else None
        sp = [r for r in rs if r["kind"] == "split" and r["max"] == target]
        st = [r for r in rs if r["kind"] == "std" and r["max"] == target]
        zd, zg, zw = (zdiff([r[k] for r in sp], [r[k] for r in st]) for k in ("dmg_z", "gold_z", "win"))
        lead = round((zd + zg) / 2, 2) if zd is not None and zg is not None else None
        if len(sp) < MIN_SPLITS:
            verdict = "too few"
        elif (lead is not None and lead <= Z_DROP) or (zw is not None and zw <= Z_DROP and len(sp) >= 3 * MIN_SPLITS):
            verdict = "drop"
        else:
            verdict = "keep"
        if cfg["weak"]:
            pooled["split"] += sp
            pooled["std"] += st
        out[ch] = {"split": f"{cfg['first']} to 3, then max {target or '?'}", "weak": cfg["weak"],
                   "splits": len(sp), "own_splits": sum(r["own"] for r in sp),
                   "reactive": sum(1 for r in rs if r["kind"] == "reactive"), "standard": len(st),
                   "win_split": round(sum(r["win"] for r in sp) / len(sp), 3) if sp else None,
                   "win_standard": round(sum(r["win"] for r in st) / len(st), 3) if st else None,
                   "z_damage8": zd, "z_gold8": zg, "z_lead": lead, "z_win": zw, "verdict": verdict}
    ps, pt = pooled["split"], pooled["std"]
    pool = {"splits": len(ps), "standard": len(pt),
            "z_damage8": zdiff([r["dmg_z"] for r in ps], [r["dmg_z"] for r in pt]),
            "z_gold8": zdiff([r["gold_z"] for r in ps], [r["gold_z"] for r in pt]),
            "z_win": zdiff([r["win"] for r in ps], [r["win"] for r in pt])}
    res = {"minute": MINUTE, "min_splits": MIN_SPLITS, "z_drop": Z_DROP, "players": len(data),
           "weak_pooled": pool, "champions": out}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
        f.write("\n")
    for ch, v in out.items():
        print(f"{ch:10} {v['split']:22} splits {v['splits']:3} (own {v['own_splits']}) std {v['standard']:4} "
              f"lead z {v['z_lead']} win z {v['z_win']} -> {v['verdict']}")
    print("weak pooled:", pool)


if __name__ == "__main__":
    main()
