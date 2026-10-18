#!/usr/bin/env python3
"""Estimate live-patch Mayhem game counts and summoner spells per champion.

Writes data/fill/spells_games.json in the shape the site reads (web/src/lib/fill.ts):
  {patch, estimated: true, built, daily_games, total_games,
   champions: {"<champion id>": {games, spells: [{ids: [4, x], games, pick_rate, win_rate: null}]}}}
Spell rows are estimates of how often each loadout is picked; they carry no win rate.

Usage: python3 data/fill/build_estimates.py   (standard library only)
"""

import datetime as dt
import json
import os
import sys

import model as m

OUT = os.path.dirname(os.path.abspath(__file__))
MIN_SHARE = 0.01


def load(name, default):
    try:
        with open(os.path.join(OUT, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def main():
    if not load("config.json", {}).get("enabled"):
        print("data/fill is switched off (config.json); nothing built")
        return 0
    spell_model = load("spell_model.json", None)
    if not spell_model:
        print("spell_model.json missing; run fit_spells.py", file=sys.stderr)
        return 1

    live = m.patches()[-1]
    patch, days = live["patch"], int(live["days"])
    per_day, used = m.typical_daily_games()
    stats = m.patch_stats(patch)
    total = per_day * days

    # Rift spells for this patch; a brand-new patch may have none yet, so fall back one patch.
    champs = sorted(stats)
    rift = m.rift_spells(champs, patch)
    if sum(1 for v in rift.values() if v) < len(champs) // 2:
        prev = m.patches()[-2]["patch"]
        print(f"Rift spells for {patch} not out yet; using {prev}")
        rift = m.rift_spells(champs, prev)

    dd = m.data_dragon()
    out = {}
    for c, row in stats.items():
        games = float(row["pick_rate"]) * total
        tags, dd_stats = dd.get(c, ([], {}))
        probs = m.predict(spell_model, m.features(tags, m.numeric(row, dd_stats), rift.get(c, {})))
        spells = sorted(
            ({"ids": sorted([m.FLASH, s]), "games": m.round_sig(games * p), "pick_rate": round(p, 4), "win_rate": None}
             for s, p in zip(m.SPELLS, probs) if p >= MIN_SHARE),
            key=lambda r: -r["pick_rate"],
        )
        out[c] = {"games": m.round_sig(games), "spells": spells}

    result = {
        "patch": patch,
        "estimated": True,
        "built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "daily_games": m.round_sig(per_day),
        "daily_games_from": [p for p, _ in used],
        "total_games": m.round_sig(total),
        "champions": out,
    }
    with open(os.path.join(OUT, "spells_games.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"patch {patch}: {len(out)} champions, about {result['total_games']:,} games "
          f"({result['daily_games']:,}/day from {', '.join(result['daily_games_from'])})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
