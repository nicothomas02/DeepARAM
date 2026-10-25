"""Build history.js for the Guide's History section: every Mayhem augment change patch by patch.

Usage: python3 guide/build_history.py
Python 3 standard library only. Writes guide/history.js.

CommunityDragon keeps every past patch (raw.communitydragon.org/16.10/...). For each patch from
16.2 on (the first one whose Mayhem augment file is exported), it reads:
  game/maps/modespecificdata/kiwi.bin.json   each augment's tier and its spell's numbers (DataValues)
  v1/augment-lists.json                      which augments are in the KIWI pool (from 16.15; earlier, the Enabled flag)
  v1/cherry-augments.json                    augment names and icons
and compares each patch with the one before. Each patch's extract is cached in
~/.cache/deeparam-guide/history/, so later runs only download new patches.
"""
import http.client, json, os, re, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://raw.communitydragon.org"
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "deeparam-guide", "history")
FIRST = (16, 2)
TIERS = ["Silver", "Gold", "Prismatic"]
SKIP_VALUES = {"MaxLevel"}  # internal bookkeeping, added to many augments at once in 16.19


def get(url, tries=4):
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-guide"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == tries - 1:
                raise
        except (urllib.error.URLError, ConnectionError, http.client.HTTPException, json.JSONDecodeError):
            # HTTPException covers a download cut off midway (IncompleteRead).
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)


def exists(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "deeparam-guide"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60):
                return True
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return False
        except (urllib.error.URLError, ConnectionError, http.client.HTTPException, json.JSONDecodeError):
            # HTTPException covers a download cut off midway (IncompleteRead).
            pass
        time.sleep(2 ** attempt)
    return True


def extract(patch):
    """One patch's augments: {platform id: {tier, values, inPool, name, icon}}."""
    path = os.path.join(CACHE, f"{patch}.json")
    if os.path.exists(path) and patch != "latest":
        with open(path) as f:
            return json.load(f)
    kiwi = get(f"{BASE}/{patch}/game/maps/modespecificdata/kiwi.bin.json")
    if not kiwi:
        return None
    gd = f"{BASE}/{patch}/plugins/rcp-be-lol-game-data/global/default"
    pool = set(next((x["augmentList"] for x in get(f"{gd}/v1/augment-lists.json") or [] if x["modeName"] == "KIWI"), []))
    names = {a["id"]: a for a in get(f"{gd}/v1/cherry-augments.json") or []}
    out = {}
    for apath, a in kiwi.items():
        if not (isinstance(a, dict) and a.get("__type") == "AugmentData" and a.get("AugmentPlatformId")):
            continue
        sp = (kiwi.get(a.get("RootSpell")) or {}).get("mSpell") or {}
        values = {}
        for d in sp.get("DataValues") or []:
            v = [round(x, 4) for x in d.get("values") or []]
            if v and d["name"] not in SKIP_VALUES:
                values[d["name"]] = v[0] if len(set(v)) == 1 else v
        aid = a["AugmentPlatformId"]
        info = names.get(aid, {})
        icon = (a.get("AugmentSmallIconPath") or "").lower()
        out[str(aid)] = {
            "key": a.get("AugmentNameId") or apath.split("/")[-1],
            "name": info.get("nameTRA") or "",
            "icon": f"{BASE}/latest/game/" + re.sub(r"\.(tex|dds)$", ".png", icon) if icon else None,
            "tier": TIERS[a.get("rarity", 0)] if a.get("rarity", 0) < 3 else str(a.get("rarity")),
            # augment-lists.json starts at 16.15; before that, the enabled flag matches the pool (checked on 16.15)
            "inPool": a.get("Enabled") is not False and (not pool or apath in pool),
            "values": values,
        }
    os.makedirs(CACHE, exist_ok=True)
    if patch != "latest":
        with open(path, "w") as f:
            json.dump(out, f)
    return out


def site_paths(text):
    """Point asset URLs at the site's own copies (/assets/cd/<channel>/<path, lower case>)."""
    return re.sub(re.escape(BASE) + r"/([^\s\"']+)", lambda m: "/assets/cd/" + m.group(1).lower(), text)


def main():
    listing = get(f"{BASE}/json/") or []
    patches = sorted({tuple(map(int, x["name"].split("."))) for x in listing if re.fullmatch(r"\d+\.\d+", x["name"])})
    patches = [p for p in patches if p >= FIRST]
    snaps = []
    for p in patches:
        name = f"{p[0]}.{p[1]}"
        data = extract(name)
        if data:
            snaps.append((name, data))
            print(name, len(data), "augments,", sum(a["inPool"] for a in data.values()), "in the pool")
        else:
            print(name, "no Mayhem augment file")

    meta, events = {}, []
    for _, data in snaps:
        for aid, a in data.items():
            m = meta.setdefault(aid, {"name": "", "icon": None})
            m["name"] = a["name"] or m["name"] or a["key"]
            m["icon"] = a["icon"] or m["icon"]
            m["tier"] = a["tier"]
    for (_, old), (patch, new) in zip(snaps, snaps[1:]):
        added = sorted((i for i, a in new.items() if a["inPool"] and not (old.get(i) or {}).get("inPool")), key=lambda i: meta[i]["name"])
        removed = sorted((i for i, a in old.items() if a["inPool"] and not (new.get(i) or {}).get("inPool")), key=lambda i: meta[i]["name"])
        changed = []
        for i, a in new.items():
            b = old.get(i)
            if not b or not a["inPool"] or i in added:
                continue
            rows = []
            if a["tier"] != b["tier"]:
                rows.append({"name": "Tier", "old": b["tier"], "new": a["tier"]})
            # before 16.6 many augments' numbers weren't in this file yet; that isn't a change
            for k in sorted(set(a["values"]) | set(b["values"])) if a["values"] and b["values"] else []:
                if a["values"].get(k) != b["values"].get(k):
                    rows.append({"name": k, "old": b["values"].get(k), "new": a["values"].get(k)})
            if rows:
                changed.append({"id": i, "changes": rows})
        changed.sort(key=lambda c: meta[c["id"]]["name"])
        if added or removed or changed:
            events.append({"patch": patch, "added": added, "removed": removed, "changed": changed})
    events.reverse()

    first, last = snaps[0], snaps[-1]
    # a retired augment's icon can be gone from the current files; show none rather than a broken image
    for aid, m in meta.items():
        if aid not in last[1] and m["icon"] and not exists(m["icon"]):
            m["icon"] = None
    used = {i for e in events for i in e["added"] + e["removed"] + [c["id"] for c in e["changed"]]}
    out = {
        "from": first[0], "to": last[0],
        "startPool": sum(a["inPool"] for a in first[1].values()),
        "pool": sum(a["inPool"] for a in last[1].values()),
        "augments": {i: meta[i] for i in sorted(used, key=int)},
        "patches": events,
    }
    with open(os.path.join(HERE, "history.js"), "w") as f:
        # no header comment: the file ships to the site, and pages don't say where data comes from
        f.write("window.GUIDE_HISTORY = " + site_paths(json.dumps(out, ensure_ascii=False, separators=(",", ":"))) + ";\n")
    print(f"{len(events)} patches with changes, {len(used)} augments touched")


if __name__ == "__main__":
    main()
