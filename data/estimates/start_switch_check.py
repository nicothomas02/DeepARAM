#!/usr/bin/env python3
"""Re-test of the augment-driven start switches (start_switch_check.json).

The apps switch the starting items once an augment is the first pick (engine rule augmentStart; data/cn/builds/*.json
augment_starts, from data/aramhex/merge.py mark_augment_starts: Upgrade Stormsurge -> Hextech Alternator on Ahri).
That rule rests on what players buy, not on whether it helps. Nico approved 2026-11-25: check each switch on leading
indicators and remove the ones that don't hold up.

Test, per augment (pooled over the champions that have a switch for it): of the archive's players who took the augment
first on such a champion, those who bought the switched start in the first minute against those who didn't. Leading
indicators at minute 8: damage to champions and gold earned, each standardised within the champion; plus the win rate.

Verdict per augment:
  drop      followers clearly behind: mean of the two indicator z <= -2 with >= MIN_EACH players on each side,
            or win z <= -2 with >= 3 * MIN_EACH on each side
  keep      enough players on each side and not clearly behind
  too few   the switch stays on its original evidence (what first-pickers buy)

Usage: python3 data/estimates/start_switch_check.py /path/to/DeepARAM-PC/archive
Standard library only; the owner's own games are left out (as augment_starts.py). Only aggregates are written.
"""

import collections
import glob
import gzip
import json
import math
import os
import sys

import common as cm
from split_check import zdiff

OUT = os.path.join(cm.HERE, "start_switch_check.json")
START_MS = 60_000
MINUTE = 8
MIN_EACH = 10
Z_DROP = -2.0


def switches():
    """{champion id: {augment id: set(start items)}} from the champion build files."""
    out = {}
    for f in glob.glob(os.path.join(cm.REPO, "data", "cn", "builds", "*.json")):
        d = cm.load(f)
        a = d.get("augment_starts") or {}
        if a:
            out[int(d["id"])] = {int(k): {i % 10000 if i > 100000 else i for i in v} for k, v in a.items()}
    return out


def rows(archive, sw):
    gdir, tdir = os.path.join(archive, "games"), os.path.join(archive, "timelines")
    out = []
    for f in sorted(os.listdir(gdir)):
        tp = os.path.join(tdir, f)
        if not os.path.exists(tp):
            continue
        try:
            g = json.load(gzip.open(os.path.join(gdir, f)))
            t = json.load(gzip.open(tp))
        except (OSError, ValueError):
            continue
        t = t.get("info", t)
        frames = t.get("frames", [])
        if len(frames) <= MINUTE:
            continue
        owner = next((pi["participantId"] for pi in g.get("participantIdentities", [])
                      if pi.get("player", {}).get("puuid") == g.get("_ownerPuuid")), None)
        buys = collections.defaultdict(set)
        for fr in frames:
            for e in fr["events"]:
                if e["timestamp"] >= START_MS:
                    break
                if e["type"] == "ITEM_PURCHASED":
                    buys[e["participantId"]].add(e["itemId"])
        for p in g["participants"]:
            pid, c = p["participantId"], p["championId"]
            if pid == owner or c not in sw:
                continue
            pf = frames[MINUTE]["participantFrames"].get(str(pid), {})
            a1 = p["stats"].get("playerAugment1")
            out.append({"champ": c, "first": a1, "follow": a1 in sw[c] and sw[c][a1] <= buys[pid],
                        "win": 1 if p["stats"].get("win") else 0,
                        "dmg": pf.get("damageStats", {}).get("totalDamageDoneToChampions", 0), "gold": pf.get("totalGold", 0)})
    return out


def main():
    archive = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DEEPARAM_ARCHIVE", os.path.expanduser("~/deeparam-pc/archive"))
    sw = switches()
    data = rows(archive, sw)
    by = collections.defaultdict(list)
    for r in data:
        by[r["champ"]].append(r)
    for rs in by.values():
        for key in ("dmg", "gold"):
            m = sum(r[key] for r in rs) / len(rs)
            sd = math.sqrt(sum((r[key] - m) ** 2 for r in rs) / max(1, len(rs) - 1)) or 1
            for r in rs:
                r[key + "_z"] = (r[key] - m) / sd
    names = cm.load(os.path.join(cm.REPO, "web", "src", "data", "augment-names.json"))
    augs = sorted({a for v in sw.values() for a in v})
    out = {}
    for a in augs:
        rs = [r for r in data if r["first"] == a and a in sw[r["champ"]]]
        fo, no = [r for r in rs if r["follow"]], [r for r in rs if not r["follow"]]
        zd, zg, zw = (zdiff([r[k] for r in fo], [r[k] for r in no]) for k in ("dmg_z", "gold_z", "win"))
        lead = round((zd + zg) / 2, 2) if zd is not None and zg is not None else None
        if min(len(fo), len(no)) < MIN_EACH:
            verdict = "too few"
        elif (lead is not None and lead <= Z_DROP) or (zw is not None and zw <= Z_DROP and min(len(fo), len(no)) >= 3 * MIN_EACH):
            verdict = "drop"
        else:
            verdict = "keep"
        out[str(a)] = {"name": names.get(str(a), ""), "champions": sum(1 for v in sw.values() if a in v),
                       "followed": len(fo), "other": len(no),
                       "win_followed": round(sum(r["win"] for r in fo) / len(fo), 3) if fo else None,
                       "win_other": round(sum(r["win"] for r in no) / len(no), 3) if no else None,
                       "z_damage8": zd, "z_gold8": zg, "z_lead": lead, "z_win": zw, "verdict": verdict}
    fo = [r for r in data if r["follow"]]
    no = [r for r in data if r["first"] in sw[r["champ"]] and not r["follow"]]
    pool = {"followed": len(fo), "other": len(no), "z_damage8": zdiff([r["dmg_z"] for r in fo], [r["dmg_z"] for r in no]),
            "z_gold8": zdiff([r["gold_z"] for r in fo], [r["gold_z"] for r in no]), "z_win": zdiff([r["win"] for r in fo], [r["win"] for r in no])}
    res = {"minute": MINUTE, "min_each": MIN_EACH, "z_drop": Z_DROP, "players": len(data), "pooled": pool, "augments": out}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
        f.write("\n")
    for a, v in sorted(out.items(), key=lambda kv: -(kv[1]["followed"] + kv[1]["other"])):
        print(f"{v['name'][:24]:24} champs {v['champions']:3} followed {v['followed']:3} other {v['other']:3} "
              f"lead z {v['z_lead']} win z {v['z_win']} -> {v['verdict']}")
    print("pooled:", pool)


if __name__ == "__main__":
    main()
