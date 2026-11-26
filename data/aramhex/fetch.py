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

All or nothing: the tables, upstream.json, changes.json and index.json are written together at the very end, once
every dataset is converted, every file is the one index.json lists (sha256), each patch's champion games add up to
10 x its match count and the upstream notes (watch) are made. On 2026-11-26 a KeyError half-way through 16.23 left
that patch's new tables next to its old match count (common.snapshot_problem); the files also sit behind a CDN that
caches each one for five minutes on its own, so an old index can come with new tables. A download that stops or is
refused exits 1 and saves nothing but one line in changes.json per upstream release (note_failure); index.json keeps
its old seq, so the next check asks again, and the workflow ends red after committing the rest.

Usage: python3 data/aramhex/fetch.py [--src DIR]   (DIR: a local clone instead of downloading)
"""

import argparse
import hashlib
import json
import os
import sys
import traceback
import datetime as dt
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as ah  # noqa: E402

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


def listed(src, base, name, files):
    """One file of a dataset, only if it is the file the index lists (sha256, where the index gives one)."""
    raw = get(src, base + name)
    want = (files.get(name) or {}).get("sha256")
    got = hashlib.sha256(raw).hexdigest()
    if want and got != want:
        raise ah.SnapshotError(f"{base}{name} is not the file index.json lists (sha256 {got[:12]}, listed {want[:12]})")
    return raw


STAGED = []  # (path, text): written by flush() at the very end, once every dataset has passed and watch() is done
SKIPPED = []  # "<patch> <file>": tables whose fields this script no longer reads, left as they were (watch() notes them)
CORES = []  # the core rows of the patches converted so far this run (oldest first), to spot rows carried into a later one
CARRIED_CORES = {}  # {patch: [champions whose cores are an earlier patch's, champions with cores]} (watch() notes them)


def dump(path, obj):
    STAGED.append((path, json.dumps(obj, separators=(",", ":"), sort_keys=True) + "\n"))


def flush():
    for path, text in STAGED:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    del STAGED[:]


def same_cores(a, b):
    """The same cores with the same games (wins are not compared: a recount of wins doesn't make rows a patch's own)."""
    return b is not None and sorted((tuple(i), g) for i, g, _ in a) == sorted((tuple(i), g) for i, g, _ in b)


def read_changes():
    try:
        with open(CHANGES, encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        return []


def note_failure(seq, why):
    """A download that was refused or stopped saves no tables, only this line in changes.json, once per upstream
    release, so the daily report says why the AramHex numbers stand still."""
    head = f"AramHex release seq {seq} was not saved"
    log = read_changes()
    if any(str(e.get("note", "")).startswith(head) for e in log):
        return
    log.append({"date": dt.date.today().isoformat(), "reported": False,
                "note": f"{head} (the last copy stays; later runs try again): {why}"})
    with open(CHANGES, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=1, ensure_ascii=False)
        f.write("\n")


def convert(src, ds, prev_hashes):
    base = ds["path"].rstrip("/") + "/"
    files = ds["files"]
    load = lambda name: json.loads(listed(src, base, name, files)) if name in files else None
    patch = ds["patch"]
    out = os.path.join(OUT, patch)
    meta = load("meta.json") or {}
    heroes = load("heroes.json") or {}
    why = ah.snapshot_problem({h: gw(r) for h, r in heroes.items()}, ds.get("matches"))
    if why:
        raise ah.SnapshotError(f"{base}: {why}")
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
    carried_cores = []
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
        rows = {h: [[[int(i) for i in c["items"]], int(c["games"]), int(c["wins"])] for c in v] for h, v in cores.items()}
        dump(os.path.join(out, "cores.json"), rows)
        written.append("cores")
        sha = files["core_builds.json"].get("sha256")
        if sha and sha in prev_hashes.get("core_builds.json", set()):
            carried.append("cores")
        # Champion by champion: cores that repeat an earlier patch's (same items, same games) are that patch's, not
        # this one's. AramHex's 16.23 release of 2026-11-26 keeps 16.22's cores for every champion but Sylas (its
        # notes say so) in a file with a new hash: over 16.23's own item games they would read as pick rates up to
        # 240%. merge.py skips these champions and uses the others' cores. A champion without cores ([]) is neither.
        carried_cores = sorted((h for h, v in rows.items() if v and any(same_cores(v, p.get(h)) for p in CORES)), key=int)
        CARRIED_CORES[patch] = [len(carried_cores), sum(1 for v in rows.values() if v)]
        CORES.append(rows)
    dest = load("hero_augment_items.json")
    if dest:
        d = {}
        for h, v in dest.items():
            w = v.get("3081")
            if not w:
                continue
            g, won = w.get("eligible_total", w.get("total")), w.get("eligible_wins", w.get("total_wins"))
            if g is None or won is None:
                # AramHex's 16.23 release of 2026-11-26 dropped total_wins and the eligible_* counts
                # (recommendation_style "destiny_style_v1"). The KeyError here stopped that download half-way.
                # Without the augment's wins the table has no "all" row, so it is left as it was and noted for Nico.
                d = None
                break
            d[h] = {"all": [int(g), int(won)],
                    "items": {x["item"]: [int(x["games"]), int(x["wins"])] for x in w.get("items", [])}}
        if d is None:
            SKIPPED.append(f"{patch} hero_augment_items.json")
        else:
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
        dump(os.path.join(out, "bands", band, "heroes.json"), {h: gw(r) for h, r in hb.items()})
        # Bracket augment and spell tables (Nico 2026-11-24 chose "half-and-half, live patch only": champion pages mix a
        # bracket's augment scores 50/50 with all players', web/src/lib/bracket-augments.ts). Spells are kept to re-test
        # (the one patch pair with bracket spells didn't support the mix), not shown.
        bha = load(f"bands/{band}/hero_augments.json")
        if bha:
            dump(os.path.join(out, "bands", band, "augments.json"),
                 {h: {a: gw(r) for a, r in v.items() if a not in excluded} for h, v in bha.items()})
        bsp = load(f"bands/{band}/hero_spells.json")
        if bsp:
            dump(os.path.join(out, "bands", band, "spells.json"),
                 {h: {k: gw(r) for k, r in v.items() if r["games"] >= MIN_SPELL_GAMES} for h, v in bsp.items()})
        # Bracket item, boots and core tables, saved so items can be tested against all players once two patches have
        # them (Nico 2026-11-24: "Yes"); not shown until that test beats All players.
        bit = load(f"bands/{band}/hero_items.json")
        bden = load(f"bands/{band}/equipment_recommendation_heroes.json")
        if bit and bden:
            dump(os.path.join(out, "bands", band, "items.json"), {
                h: {"all": gw(bden[h]), "items": {i: gw(r) for i, r in v.items() if r["games"] >= MIN_ITEM_GAMES}}
                for h, v in bit.items() if h in bden})
        bhold = load(f"bands/{band}/hero_item_holdings.json")
        beq = load(f"bands/{band}/equipment_heroes.json")
        if bhold and beq and boots_ids:
            dump(os.path.join(out, "bands", band, "boots.json"), {
                h: {"all": gw(beq[h]), "items": {i: gw(r) for i, r in v.items() if i in boots_ids and r["games"] >= MIN_ITEM_GAMES}}
                for h, v in bhold.items() if h in beq})
        bcores = load(f"bands/{band}/core_builds.json")
        if bcores:
            dump(os.path.join(out, "bands", band, "cores.json"),
                 {h: [[[int(i) for i in c["items"]], int(c["games"]), int(c["wins"])] for c in v] for h, v in bcores.items()})
        bands.append(band)
    if bands:
        written.append("bands:" + "/".join(bands))
    dump(os.path.join(out, "meta.json"), {
        "source": "AramHex (github.com/czgreat/aramhex-data), CC BY-NC 4.0",
        "patch": patch, "seq": ds.get("seq"), "snapshot_at": ds.get("snapshot_at") or meta.get("snapshot_at"),
        "matches": ds.get("matches"), "window": (ds.get("window") or meta.get("window") or {}),
        "tables": written, "carried_from_earlier_patch": carried, "carried_cores": carried_cores,
        "bands": bands,
    })
    if carried_cores:
        carried = carried + [f"cores of {len(carried_cores)} of {CARRIED_CORES[patch][1]} champions"]
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
        "skipped_tables": sorted(SKIPPED),
        "carried_cores": {p: c for p, c in sorted(CARRIED_CORES.items()) if c[0]},
    }
    notes = []
    for p, (n, of) in now["carried_cores"].items():
        if ((old or {}).get("carried_cores") or {}).get(p) != [n, of]:
            notes.append(f"{p}: the 3-item cores of {n} of {of} champions are an earlier patch's (same games); "
                         f"the site keeps 101's for them and uses AramHex's for the other {of - n}")
    for t in now["skipped_tables"]:
        if t not in ((old or {}).get("skipped_tables") or []):
            notes.append(f"{t}: its fields changed and fetch.py can't read it, so that table was left as it was (fetch.py needs updating)")
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
    # Staged like the tables: written by main()'s one flush, so a download that fails in here saves nothing either.
    STAGED.append((UPSTREAM, json.dumps(now, indent=1, sort_keys=True) + "\n"))
    if notes:
        day = dt.date.today().isoformat()
        log = read_changes() + [{"date": day, "note": n, "reported": False} for n in notes]
        STAGED.append((CHANGES, json.dumps(log, indent=1, ensure_ascii=False) + "\n"))
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
    seen = {}
    del STAGED[:], SKIPPED[:], CORES[:]
    CARRIED_CORES.clear()
    try:
        for ds in sets:
            written, carried = convert(a.src, ds, seen)
            for name, f in ds["files"].items():
                if f.get("sha256"):
                    seen.setdefault(name, set()).add(f["sha256"])
            print(f"{ds['patch']}: {ds.get('matches'):,} games, {', '.join(written)}" + (f" (carried: {', '.join(carried)})" if carried else ""))
        notes = watch(a.src, index)
    except Exception as e:  # refused (SnapshotError) or stopped by anything else: nothing has been written
        del STAGED[:]
        refused = isinstance(e, ah.SnapshotError)
        why = (str(e) if refused else f"{type(e).__name__}: {e}")[:300]
        if not refused:
            traceback.print_exc()
        note_failure(index.get("latest_seq"), why)
        print(f"::error::AramHex download {'refused' if refused else 'stopped'}, the last copy stays: {why}", file=sys.stderr)
        return 1
    for n in notes:
        print("upstream change:", n)
    dump(os.path.join(OUT, "index.json"), {"patches": [d["patch"] for d in sets], "latest": sets[-1]["patch"] if sets else None,
                                           "seq": index.get("latest_seq")})
    flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
