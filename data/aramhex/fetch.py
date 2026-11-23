#!/usr/bin/env python3
"""Download the AramHex Mayhem dataset (github.com/czgreat/aramhex-data, CC BY-NC 4.0) into compact per-patch files.

AramHex publishes real game and win counts from China-server ARAM Mayhem games: champions, champion x augment,
summoner spell pairs, finished items and boots held at game end, the top three ordered 3-item cores and Weapon of
Destiny's first legendary item. It updates every 2-4 days per patch. data/aramhex/merge.py lays these numbers over
the 101 feed's files in data/cn (101 keeps what AramHex doesn't have: skill orders, starting items, six-item builds,
teammates, damage share, daily trends).

Writes data/aramhex/patches/<patch>/ with [games, wins] pairs:
  heroes.json        {champion: [g, w]}
  augments.json      {champion: {augment: [g, w]}}
  spells.json        {champion: {"4+32": [g, w]}}           (pairs with at least MIN_SPELL_GAMES)
  items.json         {champion: {"all": [g, w], "items": {item: [g, w]}}}   finished items (no item augments)
  boots.json         {champion: {"all": [g, w], "items": {boots: [g, w]}}}  boots held at game end
  cores.json         {champion: [[items...], g, w]}          ordered, first three legendary items
  destiny.json       {champion: {"all": [g, w], "items": {item: [g, w]}}}  Weapon of Destiny's first legendary
  augment_info.json  {augment: rarity}
  bands/<b>/heroes.json  champion [g, w] per skill bracket (casual, mid, high = top 5%), when published
  meta.json          patch, seq, snapshot, matches, window, which tables were carried from an earlier patch
Only the "normal" rules are kept (event modes like first-prismatic are skipped). Standard library only.

Usage: python3 data/aramhex/fetch.py [--src DIR]   (DIR: a local clone instead of downloading)
"""

import argparse
import hashlib
import json
import os
import sys
import datetime as dt
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "patches")
RAW = "https://raw.githubusercontent.com/czgreat/aramhex-data/main/"
CHANGES = os.path.join(HERE, "changes.json")
UPSTREAM = os.path.join(HERE, "upstream.json")
STALL_DAYS = 5
MIN_SPELL_GAMES = 30
MIN_ITEM_GAMES = 30
# Boots: everything Boots (1001) builds into, in AramHex's own item data.
BOOTS_ROOT = "1001"


def get(src, path):
    if src:
        with open(os.path.join(src, path), "rb") as f:
            return f.read()
    with urllib.request.urlopen(RAW + path, timeout=120) as r:
        return r.read()


def gw(r):
    return [int(r["games"]), int(r["wins"])]


def dump(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"), sort_keys=True)
        f.write("\n")


def convert(src, ds, prev_hashes):
    base = ds["path"].rstrip("/") + "/"
    files = ds["files"]
    load = lambda name: json.loads(get(src, base + name)) if name in files else None
    patch = ds["patch"]
    out = os.path.join(OUT, patch)
    os.makedirs(out, exist_ok=True)
    meta = load("meta.json") or {}
    heroes = load("heroes.json") or {}
    dump(os.path.join(out, "heroes.json"), {h: gw(r) for h, r in heroes.items()})
    ha = load("hero_augments.json") or {}
    excluded = set((meta.get("excluded_augments") or {}).keys())
    dump(os.path.join(out, "augments.json"), {h: {a: gw(r) for a, r in v.items() if a not in excluded} for h, v in ha.items()})
    aug = load("augments.json") or {}
    dump(os.path.join(out, "augment_info.json"), {a: v.get("rarity") for a, v in aug.items()})
    written = ["heroes", "augments"]
    sp = load("hero_spells.json")
    if sp:
        dump(os.path.join(out, "spells.json"), {h: {k: gw(r) for k, r in v.items() if r["games"] >= MIN_SPELL_GAMES} for h, v in sp.items()})
        written.append("spells")
    carried = []
    items = load("hero_items.json")
    denom = load("equipment_recommendation_heroes.json")
    if items and denom:
        dump(os.path.join(out, "items.json"), {
            h: {"all": gw(denom[h]), "items": {i: gw(r) for i, r in v.items() if r["games"] >= MIN_ITEM_GAMES}}
            for h, v in items.items() if h in denom})
        written.append("items")
    hold = load("hero_item_holdings.json")
    eq = load("equipment_heroes.json")
    meta_items = load("item_metadata.json") or {}
    boots_ids = set(meta_items.get(BOOTS_ROOT, {}).get("into", []))
    if hold and eq and boots_ids:
        dump(os.path.join(out, "boots.json"), {
            h: {"all": gw(eq[h]), "items": {i: gw(r) for i, r in v.items() if i in boots_ids and r["games"] >= MIN_ITEM_GAMES}}
            for h, v in hold.items() if h in eq})
        written.append("boots")
    cores = load("core_builds.json")
    if cores:
        dump(os.path.join(out, "cores.json"), {h: [[[int(i) for i in c["items"]], int(c["games"]), int(c["wins"])] for c in v] for h, v in cores.items()})
        written.append("cores")
        sha = files["core_builds.json"].get("sha256")
        if sha and sha in prev_hashes.get("core_builds.json", set()):
            carried.append("cores")
    dest = load("hero_augment_items.json")
    if dest:
        d = {}
        for h, v in dest.items():
            w = v.get("3081")
            if not w:
                continue
            d[h] = {"all": [int(w.get("eligible_total", w["total"])), int(w.get("eligible_wins", w["total_wins"]))],
                    "items": {x["item"]: [int(x["games"]), int(x["wins"])] for x in w.get("items", [])}}
        dump(os.path.join(out, "destiny.json"), d)
        written.append("destiny")
        sha = files["hero_augment_items.json"].get("sha256")
        if sha and sha in prev_hashes.get("hero_augment_items.json", set()):
            carried.append("destiny")
    # Skill brackets (AramHex's own rating, not official ranks): casual, mid and top 5% ("high"; "top" is a copy).
    bands = []
    for band in ("casual", "mid", "high"):
        hb = load(f"bands/{band}/heroes.json")
        if not hb:
            continue
        os.makedirs(os.path.join(out, "bands", band), exist_ok=True)
        dump(os.path.join(out, "bands", band, "heroes.json"), {h: gw(r) for h, r in hb.items()})
        bands.append(band)
    if bands:
        written.append("bands:" + "/".join(bands))
    dump(os.path.join(out, "meta.json"), {
        "source": "AramHex (github.com/czgreat/aramhex-data), CC BY-NC 4.0",
        "patch": patch, "seq": ds.get("seq"), "snapshot_at": ds.get("snapshot_at") or meta.get("snapshot_at"),
        "matches": ds.get("matches"), "window": (ds.get("window") or meta.get("window") or {}),
        "tables": written, "carried_from_earlier_patch": carried,
        "bands": bands,
    })
    return written, carried


def watch(src, index):
    """Note notable upstream changes for Nico (2026-11-21: "keep me updated on any significant changes with aramhex or
    new things it has"): new patches or rule modes, new tables or fields, MMR bands appearing, a new schema version, a
    license change, or no new release for STALL_DAYS. Appends to changes.json ("reported": false); the daily Website
    task reports unreported entries and flips them to true."""
    try:
        with open(UPSTREAM) as f:
            old = json.load(f)
    except OSError:
        old = None
    lic = get(src, "LICENSE")
    sample = index["datasets"][0] if index["datasets"] else {}
    fields = {}
    if sample:
        base = sample["path"].rstrip("/") + "/"
        for name in ("heroes.json", "hero_augments.json", "core_builds.json", "hero_spells.json"):
            if name in sample["files"]:
                d = json.loads(get(src, base + name))
                first = next(iter(d.values()), None)
                if isinstance(first, list):
                    first = first[0] if first else {}
                elif isinstance(first, dict) and name != "heroes.json":
                    first = next(iter(first.values()), {}) if first else {}
                fields[name] = sorted(first) if isinstance(first, dict) else []
    # Augments with item data (hero_augment_items): only Weapon of Destiny (3081) so far; more would allow real
    # "with this augment, buy this item first" tips (Nico 2026-11-23).
    aug_items = []
    latest = next((d for d in reversed(index["datasets"]) if d.get("mode") == "normal" and "hero_augment_items.json" in d["files"]), None)
    if latest:
        d = json.loads(get(src, latest["path"].rstrip("/") + "/hero_augment_items.json"))
        aug_items = sorted({a for v in d.values() for a in v})
    now = {
        "augments_with_items": aug_items,
        "schema_version": index.get("schema_version"),
        "license_sha256": hashlib.sha256(lic).hexdigest(),
        "datasets": {d["path"]: {"patch": d["patch"], "mode": d.get("mode"), "seq": d.get("seq"), "bands": bool(d.get("bands")),
                                 "files": sorted(d["files"])} for d in index["datasets"]},
        "fields": fields,
        "latest_seq": index.get("latest_seq"),
        "latest_snapshot": max((d.get("snapshot_at") or "" for d in index["datasets"]), default=""),
    }
    notes = []
    if old:
        if now["schema_version"] != old.get("schema_version"):
            notes.append(f"Schema version changed: {old.get('schema_version')} -> {now['schema_version']}")
        if now["license_sha256"] != old.get("license_sha256"):
            notes.append("LICENSE file changed: check the terms still allow our use (CC BY-NC 4.0 so far)")
        for path, d in now["datasets"].items():
            o = old["datasets"].get(path)
            if not o:
                notes.append(f"New dataset: {d['patch']} {d['mode']} ({path})")
                continue
            added = sorted(set(d["files"]) - set(o["files"]))
            if added:
                notes.append(f"New tables in {path}: {', '.join(added)}")
            if d["bands"] and not o["bands"]:
                notes.append(f"MMR bands now available for {d['patch']} {d['mode']}")
        more = sorted(set(now["augments_with_items"]) - set(old.get("augments_with_items", ["3081"])))
        if more:
            notes.append(f"Items-per-augment data now covers more augments ({', '.join(more)}): real augment item tips possible")
        for name, f in now["fields"].items():
            new_f = sorted(set(f) - set(old.get("fields", {}).get(name, [])))
            if new_f and name in old.get("fields", {}):
                notes.append(f"New fields in {name}: {', '.join(new_f)}")
    try:
        snap = dt.datetime.fromisoformat(now["latest_snapshot"])
        age = (dt.datetime.now(dt.timezone.utc) - snap).days
        if age >= STALL_DAYS and (not old or old.get("stall_noted") != now["latest_snapshot"]):
            notes.append(f"No new AramHex release for {age} days (newest data {now['latest_snapshot'][:10]}); 101 covers the live patch meanwhile")
            now["stall_noted"] = now["latest_snapshot"]
        elif old and old.get("stall_noted") == now["latest_snapshot"]:
            now["stall_noted"] = old["stall_noted"]
    except ValueError:
        pass
    with open(UPSTREAM, "w") as f:
        json.dump(now, f, indent=1, sort_keys=True)
        f.write("\n")
    if notes:
        try:
            with open(CHANGES) as f:
                log = json.load(f)
        except OSError:
            log = []
        day = dt.date.today().isoformat()
        log += [{"date": day, "note": n, "reported": False} for n in notes]
        with open(CHANGES, "w") as f:
            json.dump(log, f, indent=1, ensure_ascii=False)
            f.write("\n")
    return notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="local clone of aramhex-data")
    ap.add_argument("--is-new", action="store_true", help="only print new=true|false: has AramHex published since our copy")
    a = ap.parse_args()
    index = json.loads(get(a.src, "index.json"))
    if a.is_new:
        try:
            with open(os.path.join(OUT, "index.json")) as f:
                ours = json.load(f).get("seq")
        except OSError:
            ours = None
        print(f"new={'true' if index.get('latest_seq') != ours else 'false'}")
        return 0
    # Oldest first, so a later patch can tell which tables it reuses from an earlier one (same file hash).
    sets = [d for d in index["datasets"] if d.get("mode") == "normal" and d["path"].rstrip("/") == f"patches/{d['patch']}/normal"]
    sets.sort(key=lambda d: [int(x) for x in d["patch"].split(".")])
    os.makedirs(OUT, exist_ok=True)
    seen = {}
    for ds in sets:
        written, carried = convert(a.src, ds, seen)
        for name, f in ds["files"].items():
            if f.get("sha256"):
                seen.setdefault(name, set()).add(f["sha256"])
        print(f"{ds['patch']}: {ds.get('matches'):,} games, {', '.join(written)}" + (f" (carried: {', '.join(carried)})" if carried else ""))
    for n in watch(a.src, index):
        print("upstream change:", n)
    dump(os.path.join(OUT, "index.json"), {"patches": [d["patch"] for d in sets], "latest": sets[-1]["patch"] if sets else None,
                                           "seq": index.get("latest_seq")})


if __name__ == "__main__":
    sys.exit(main())
