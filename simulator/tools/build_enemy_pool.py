#!/usr/bin/env python3
"""Build the simulator's enemy pool from China-server ARAM Mayhem stats (101.qq.com).

Reads the champion snapshot written by data/cn/fetch_cn.py (pick rates, damage
and damage-taken shares, time dead), adds each champion's base stats, role,
damage type and crowd-control rating from Tencent's champion files on
game.gtimg.cn, and writes simulator/data/cn_enemy_pool.json.

    python3 simulator/tools/build_enemy_pool.py
    python3 simulator/tools/build_enemy_pool.py --champions data/cn/champions.json

If the snapshot file is missing it fetches the same day's table itself.
Python 3 standard library only.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DEFAULT_CHAMPIONS = os.path.join(REPO, "data", "cn", "champions.json")
DEFAULT_OUT = os.path.join(HERE, "..", "data", "cn_enemy_pool.json")

RANK_URL = "https://mlol.qt.qq.com/go/battle_info/odp_proxy/fuwen_aram_hero_rank_v2?dtstatdate={date}"
HERO_URL = "https://game.gtimg.cn/images/lol/act/img/js/hero/{id}.js"
HERO_LIST_URL = "https://game.gtimg.cn/images/lol/act/img/js/heroList/hero_list.js"

YUNARA_ID = 804
LEVEL = 18

# What a typical late ARAM Mayhem build adds on top of level-18 base stats, by
# the champion's main role. Estimates: the CN data has no per-champion items.
# Every role also gets ~300 HP from stat augments and anvils.
ROLE_ITEMS = {
    "tank":     {"hp": 2400, "armor": 130, "mr": 100},
    "fighter":  {"hp": 1300, "armor": 60,  "mr": 40},
    "support":  {"hp": 600,  "armor": 30,  "mr": 30},
    "mage":     {"hp": 450,  "armor": 20,  "mr": 0},
    "assassin": {"hp": 300,  "armor": 20,  "mr": 0},
    "marksman": {"hp": 350,  "armor": 0,   "mr": 0},
}
AUGMENT_HP = 300

PHYS_SHARE = {"kPhysical": 1.0, "kMagic": 0.0, "kMixed": 0.5}

# Average crowd control per second across all fights (estimate). The CN data
# only rates each champion's CC from 1 to 3, so this sets the scale and the
# enemy team's ratings set how far each fight sits above or below it.
AVERAGE_CC_PER_SECOND = 0.125


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # connection resets happen; retry with backoff
            if i == tries - 1:
                raise RuntimeError(f"failed to fetch {url}: {e}") from e
            time.sleep(2 ** i)


def level_stat(base, per_level, level=LEVEL):
    n = level - 1
    return base + per_level * n * (0.7025 + 0.0175 * n)


def fetch_rank_table():
    """Fallback when data/cn/champions.json isn't there: same endpoint, newest day."""
    for back in range(1, 8):
        date = (dt.date.today() - dt.timedelta(days=back)).strftime("%Y%m%d")
        body = json.loads(get(RANK_URL.format(date=date)))
        fields = (body.get("data") or {}).get("_fieldValues") or {}
        if not fields:
            continue
        raw = next(iter(fields.values()))
        listcollect = json.loads(raw)["listcollect"] if isinstance(raw, str) else raw["listcollect"]
        champs = []
        for rec in filter(None, re.split(r"[#|]", listcollect)):
            s = rec.split("_")
            champs.append({
                "champion_id": int(s[0]), "win_rate": float(s[3]), "pick_rate": float(s[4]),
                "avg_death_time": float(s[6]), "avg_participation_rate": float(s[7]),
                "avg_damage_ratio": float(s[8]), "avg_tank_ratio": float(s[9]),
            })
        return {"meta": {"source": "101.qq.com (Tencent, official)", "champion_stat_date": date}, "champions": champs}
    raise RuntimeError("no champion table found for the last 7 days")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--champions", default=DEFAULT_CHAMPIONS, help="champions.json from data/cn/fetch_cn.py")
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    if os.path.exists(args.champions):
        with open(args.champions, encoding="utf-8") as f:
            table = json.load(f)
        print(f"using {args.champions}")
    else:
        print(f"{args.champions} not found; fetching the champion table directly")
        table = fetch_rank_table()

    hero_list = json.loads(get(HERO_LIST_URL))
    names = {int(h["heroId"]): h for h in hero_list["hero"]}

    enemies, yunara = [], None
    rows = table["champions"]
    for i, c in enumerate(rows, 1):
        cid = int(c["champion_id"])
        hero = json.loads(get(HERO_URL.format(id=cid)))["hero"]
        role = (names.get(cid, {}).get("roles") or ["fighter"])[0]
        items = ROLE_ITEMS.get(role, ROLE_ITEMS["fighter"])
        f = lambda k: float(hero.get(k) or 0)
        entry = {
            "id": hero.get("alias") or str(cid),
            "champion_id": cid,
            "name": hero.get("alias") or str(cid),
            "name_cn": hero.get("name", ""),
            "role": role,
            "weight": c["pick_rate"],
            "hp": round(level_stat(f("hp"), f("hpperlevel")) + items["hp"] + AUGMENT_HP),
            "armor": round(level_stat(f("armor"), f("armorperlevel")) + items["armor"], 1),
            "mr": round(level_stat(f("spellblock"), f("spellblockperlevel")) + items["mr"], 1),
            "cc": int(hero.get("crowdControl") or 1),
            "phys_share": PHYS_SHARE.get(hero.get("damageType"), 0.5),
            "damage_share": c["avg_damage_ratio"],
            "damage_taken_share": c["avg_tank_ratio"],
            "avg_death_time": c["avg_death_time"],
            "win_rate": c["win_rate"],
        }
        if cid == YUNARA_ID:
            yunara = entry  # her own numbers also feed the "yunara" block below
        # Every champion is a possible enemy; the simulator leaves out the one it is simulating
        # (Mayhem has no mirror matches). Yunara used to be left out entirely, from when she was
        # the only champion simulated, which broke team fights with her in them.
        enemies.append(entry)
        if i % 25 == 0:
            print(f"  {i}/{len(rows)} champions")

    if yunara is None:
        sys.exit("Yunara (804) is missing from the champion table")

    total = sum(e["weight"] for e in enemies)
    mean = lambda key: sum(e[key] * e["weight"] for e in enemies) / total
    avg_cc = mean("cc")
    avg_death = mean("avg_death_time")
    pool = {
        "meta": {
            "source": table["meta"].get("source", "101.qq.com"),
            "server": "China",
            "champion_stat_date": table["meta"].get("champion_stat_date"),
            "base_stats_version": hero_list.get("version"),
            "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "level": LEVEL,
            "notes": [
                "weight is the CN pick rate (sums to ~10 per game across all champions).",
                "hp/armor/mr are level-18 base stats from game.gtimg.cn plus an estimated late-game item package by role "
                "(see role_items) and ~300 HP from augments.",
                "cc is Tencent's 1-3 crowd-control rating; phys_share comes from the champion's damage type.",
                "damage_share and damage_taken_share are the champion's average share of their team's damage dealt and taken.",
            ],
            "role_items": ROLE_ITEMS,
        },
        "team": {
            "size": 5,
            "cc_rate_per_point": round(AVERAGE_CC_PER_SECOND / (5 * avg_cc), 5),
            "average_cc_rating": round(avg_cc, 3),
        },
        "yunara": {
            "damage_taken_share": yunara["damage_taken_share"],
            "damage_share": yunara["damage_share"],
            "avg_death_time": yunara["avg_death_time"],
            "mode_avg_death_time": round(avg_death, 1),
            "win_rate": yunara["win_rate"],
            "pick_rate": yunara["weight"],
            # Everyone's share averages 0.2 (1 of 5), so this is how much more or less
            # damage Yunara takes than the average player on her team.
            "damage_taken_factor": round(yunara["damage_taken_share"] / 0.2, 4),
        },
        "enemies": enemies,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(pool, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {len(enemies)} enemies to {os.path.relpath(args.out)}; "
          f"Yunara takes {pool['yunara']['damage_taken_factor']:.2f}x the average player's damage")


if __name__ == "__main__":
    main()
