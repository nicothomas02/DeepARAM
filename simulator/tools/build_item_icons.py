#!/usr/bin/env python3
"""Write viewer/replay-data/item-icons.json: the icon file for every item the simulator models.

The replay shows the build's items as icons. The site hosts each item icon in its own copy of the
official images (/assets/dd/<version>/img/item/<file>); this maps each simulator item id, live and
PBE, to that file name. The page adds the version from /assets/manifest.json, so a new patch's
images work without rebuilding this. Mayhem's own items, which have no official copy, map to the
client icon's full path on the site instead. Same lookup as the site's build previews (web/scripts/sync-embeds.mjs).

    python3 tools/build_item_icons.py
"""
import json
from pathlib import Path

SIM = Path(__file__).resolve().parent.parent
WEB = SIM.parent / "web"
GAME_DATA = "/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/"
OUT = SIM / "viewer" / "replay-data" / "item-icons.json"


def main():
    swap = json.loads((WEB / "src" / "data" / "dd-swap.json").read_text())["paths"]
    client = json.loads((WEB / "public" / GAME_DATA.strip("/") / "v1" / "items.json").read_text())
    icon_of = {}
    for item in client:
        if not item.get("iconPath"):
            continue
        cd = GAME_DATA + item["iconPath"].replace("/lol-game-data/assets/", "", 1).lower()
        dd = swap.get(cd)
        if dd and (WEB / "public" / dd.lstrip("/")).exists():
            icon_of[item["id"]] = dd.rsplit("/", 1)[1]
        else:
            # Mayhem's own items have no official copy: the client's icon, as the site stores it.
            cd = cd.replace("kiwi", "mayhem")
            if (WEB / "public" / cd.lstrip("/")).exists():
                icon_of[item["id"]] = cd
    ids = set()
    for data in (SIM / "data", SIM / "data" / "pbe"):
        ids |= {v["id"] for v in json.loads((data / "items.json").read_text())["items"].values()}
    icons = {str(i): icon_of[i] for i in sorted(ids) if i in icon_of}
    OUT.write_text(json.dumps(icons, separators=(",", ":")) + "\n")
    missing = sorted(ids - {int(i) for i in icons})
    print(f"{len(icons)} item icons -> {OUT.relative_to(SIM)}" + (f" (no icon: {missing})" if missing else ""))


if __name__ == "__main__":
    main()
