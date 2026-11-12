#!/usr/bin/env python3
"""Check a build before it goes on the site: a Chef Special, a synergy finder pick or a community build.

Catches the ways a build can work on paper and fail in the game:
  - an augment that isn't in Mayhem this patch                                                 (block)
  - an augment the champion has never been seen taking, so it may not be in their pool         (block)
  - an augment with no stats yet this patch, so its pool can't be checked                      (warn)
  - a combination on the Traps list (data/checks/findings.json, data/checks/curated.json)      (block)
  - a stat loop still waiting for an in-game test (Bug finder)                                 (warn)
  - an item the Simulator likes on the champion while real builds with it win clearly less     (warn)

Usage (from the repo root):
    python3 data/checks/check_build.py Jhin "Tickle Monster" "Big Shot" --items "Infinity Edge"
    python3 data/checks/check_build.py Rammus "Tickle Monster" --fun   # a Chef Special idea
    python3 data/checks/check_build.py --chef            # today's Chef Special
    python3 data/checks/check_build.py --kitchen         # every Kitchen build
Chef Specials are for fun (Nico, 2026-11-12): with --fun (and always with --chef / --kitchen) an augment the
champion has never been seen taking is only a "note", since the build may never come together in a real game.
Practical builds (the synergy finder, community builds) keep it as a block.

Exits 1 when anything blocks. From Python: check(champion, augments, items) -> list of problems.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import findings as F  # noqa: E402

_cache = {}


def _state():
    if not _cache:
        d = F.data()
        out = F.build(d) if not F.OUT.exists() else json.loads(F.OUT.read_text(encoding="utf-8"))
        _cache.update(d=d, findings=out)
    return _cache["d"], _cache["findings"]


def _name(x):
    return x["name"] if isinstance(x, dict) else str(x)


def check(champion, augments=(), items=(), d=None, findings=None, fun=False):
    """Problems with a build: [{"level": "block" | "warn" | "note", "message": str}]. fun=True (Chef Specials)
    turns "never seen on this champion" into a note."""
    unseen = "note" if fun else "block"
    if d is None or findings is None:
        d, findings = _state()
    out = []
    champ = F.champion_of(d, champion)
    if not champ:
        return [{"level": "block", "message": f"Unknown champion: {champion}"}]
    keys = []
    for name, why in F.check_pool(d, champ["id"], [_name(a) for a in augments]):
        if why == "gone":
            out.append({"level": "block", "message": f"{name} isn't in Mayhem this patch."})
        elif why == "no_data":
            out.append({"level": "warn", "message": f"There are no stats on {name} yet this patch: check that {champ['name']} can still be offered it."})
        elif why == "range":
            kind = "melee" if champ["ranged"] else "ranged"
            out.append({"level": unseen, "message": f"{name} is only seen on {kind} champions, so {champ['name']} almost certainly can't be offered it."})
        elif why == "unseen":
            out.append({"level": unseen, "message": f"{champ['name']} has never been seen taking {name}, so it may not be in their augment pool."})
    for a in augments:
        k = F.augment_key(d, _name(a))
        if k:
            keys.append(k)
    ids = {d["augments"][k]["id"] for k in keys}
    item_ids = set()
    for i in items:
        key = next((k for k, v in d["items"].items() if k == i or v.get("name", "").lower() == _name(i).lower() or v.get("id") == i), None)
        if key:
            item_ids.add(d["items"][key]["id"])
    for f, level in [(f, "block") for f in findings.get("traps", [])] + [(f, "warn") for f in findings.get("bugs", [])]:
        if f["kind"] not in ("loop", "sim", "wasted"):
            continue
        if f["champions"] and champ["id"] not in f["champions"]:
            continue
        need_augs, need_items = set(f.get("augments", [])), set(f.get("items", []))
        if (need_augs or need_items) and need_augs <= ids and need_items <= item_ids:
            what = "is on the Traps list" if level == "block" else "is a stat loop nobody has tested in game yet"
            msg = f"{f['title']} {what}."
            if f.get("practice"):
                msg += " " + f["practice"]
            # The Simulator vs real games gap is a warning: the build can still be fun, it just underperforms.
            out.append({"level": "warn" if f["kind"] == "sim" else level, "message": msg})
    return out


def _report(label, problems):
    if not problems:
        print(f"{label}: OK")
    for p in problems:
        print(f"{label}: {p['level'].upper()}: {p['message']}")
    return any(p["level"] == "block" for p in problems)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("champion", nargs="?")
    ap.add_argument("augments", nargs="*")
    ap.add_argument("--items", nargs="*", default=[])
    ap.add_argument("--chef", action="store_true", help="check today's Chef Special")
    ap.add_argument("--kitchen", action="store_true", help="check every Kitchen build")
    ap.add_argument("--fun", action="store_true", help="a just-for-fun build (Chef Special): unseen augments are only a note")
    a = ap.parse_args()
    d, _ = _state()
    blocked = False
    if a.chef or a.kitchen:
        builds = [b for b in d["kitchen"] if a.kitchen or b["source"] == "chef"]
        for b in {b["id"]: b for b in builds}.values():
            blocked |= _report(b["id"], check(b.get("champion_name") or b["champion"], b.get("augments", []), b.get("items", []), fun=True))
    elif a.champion:
        blocked = _report(a.champion, check(a.champion, a.augments, a.items, fun=a.fun))
    else:
        ap.error("give a champion and augments, or --chef / --kitchen")
    sys.exit(1 if blocked else 0)


if __name__ == "__main__":
    main()
