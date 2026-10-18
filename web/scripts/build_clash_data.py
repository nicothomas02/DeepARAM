#!/usr/bin/env python3
"""Writes src/data/clash.json for the Clash page (/clash).

Regular ARAM data from Data Dragon for the live patch (src/data/dd-version.json):
- every champion's official classes, 1-10 ratings (attack, defense, magic, difficulty),
  attack range and level-18 health, armor and magic resist;
- the summoner spells ARAM allows, with cooldown and description.

The shipped file holds no source URLs, only /assets/... icon paths, which
scripts/fetch_assets.py then mirrors into public/assets.

Run from web/:  python3 scripts/build_clash_data.py
"""

import json
import re
import urllib.request
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
DD = "https://ddragon.leagueoflegends.com/cdn"


def get(url: str):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def at18(stats: dict, key: str) -> int:
    # Growth per level follows Riot's curve: base + per * (n - 1) * (0.7025 + 0.0175 * (n - 1)), n = 18.
    n = 18
    return round(stats[key] + stats.get(f"{key}perlevel", 0) * (n - 1) * (0.7025 + 0.0175 * (n - 1)))


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def main() -> None:
    version = json.loads((WEB / "src/data/dd-version.json").read_text())["version"]
    champs = get(f"{DD}/{version}/data/en_US/champion.json")["data"]
    spells = get(f"{DD}/{version}/data/en_US/summoner.json")["data"]

    out_champs = []
    for c in sorted(champs.values(), key=lambda c: c["name"]):
        s = c["stats"]
        out_champs.append(
            {
                "id": c["id"],
                "name": c["name"],
                "tags": c["tags"],
                "attack": c["info"]["attack"],
                "defense": c["info"]["defense"],
                "magic": c["info"]["magic"],
                "difficulty": c["info"]["difficulty"],
                "range": int(s["attackrange"]),
                "hp": at18(s, "hp"),
                "armor": at18(s, "armor"),
                "mr": at18(s, "spellblock"),
            }
        )

    out_spells = [
        {
            "id": sp["id"],
            "name": sp["name"],
            "cooldown": int(sp["cooldown"][0]),
            "description": clean(sp["description"]),
            "icon": f"/assets/dd/{version}/img/spell/{sp['image']['full']}",
        }
        for sp in sorted(spells.values(), key=lambda sp: sp["name"])
        if "ARAM" in sp["modes"]
    ]

    data = {"version": version, "champions": out_champs, "spells": out_spells}
    path = WEB / "src/data/clash.json"
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"Wrote {path.relative_to(WEB)}: {len(out_champs)} champions, {len(out_spells)} spells ({version})")


if __name__ == "__main__":
    main()
