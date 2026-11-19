#!/usr/bin/env python3
"""Print a champion's Mayhem augment pool (augments seen taken on them this patch) with each augment's live text,
plus their Q/W/E/R ability names, for designing a Chef Special with in-pool augments only.

    python3 data/checks/champion_pool.py Ashe
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "cook-builds"))
import findings as F  # noqa: E402
import check_build as C  # noqa: E402


def main():
    d = F.data()
    c = F.champion_of(d, sys.argv[1])
    if not c:
        sys.exit(f"Unknown champion: {sys.argv[1]}")
    import build_data as B
    live = B.mayhem_augments()
    slots = C.slot_augments()
    print(f"{c['name']} abilities:", ", ".join(f"{k}={v}" for k, v in C.abilities(c["champion_id"]).items()))
    for k in sorted(d["pools"].get(str(c["champion_id"]), []), key=lambda k: d["augments"][k]["name"]):
        a = d["augments"][k]
        text = (live.get(a["name"]) or {}).get("text", "")
        slot = slots.get(C._norm(a["name"]))
        print(f"{a.get('rarity', '?'):9} {a['name']}{' [' + slot + ' only]' if slot else ''} | {text}")


if __name__ == "__main__":
    main()
