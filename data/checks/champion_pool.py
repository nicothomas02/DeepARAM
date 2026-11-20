#!/usr/bin/env python3
"""Print a champion's Mayhem augment pool (augments seen taken on them this patch) with each augment's live text,
plus their Q/W/E/R ability names, for designing a Chef Special with in-pool augments only. The game text leaves
many numbers out (or shows a placeholder), so each line also carries the full wiki text when we have it
(data/wiki/mayhem_augments.json, refreshed by data/wiki/mayhem_augments.py), and each ability's game-term tags
(dash, blink, channel, airborne, immobilize, on-hit...) from data/wiki/ability_tags.json.

    python3 data/checks/champion_pool.py Ashe
"""
import json
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
    wiki_file = HERE.parent / "wiki" / "mayhem_augments.json"
    wiki = json.loads(wiki_file.read_text(encoding="utf-8")) if wiki_file.exists() else {}
    print(f"{c['name']} abilities:", ", ".join(f"{k}={v}" for k, v in C.abilities(c["champion_id"]).items()))
    tags_file = HERE.parent / "wiki" / "ability_tags.json"
    kit = json.loads(tags_file.read_text(encoding="utf-8")).get(c["name"], {}) if tags_file.exists() else {}
    for slot, a in kit.items():
        if a.get("tags"):
            print(f"  {'P' if slot == 'I' else slot} {a['name']}: {', '.join(a['tags'])}")
    for k in sorted(d["pools"].get(str(c["champion_id"]), []), key=lambda k: d["augments"][k]["name"]):
        a = d["augments"][k]
        text = (live.get(a["name"]) or {}).get("text", "")
        slot = slots.get(C._norm(a["name"]))
        full = wiki.get(a["name"])
        print(f"{a.get('rarity', '?'):9} {a['name']}{' [' + slot + ' only]' if slot else ''} | {text}"
              + (f" || full: {full}" if full and full != text else ""))


if __name__ == "__main__":
    main()
