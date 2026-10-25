"""PBE tab data: data/pbe/kiwi-s3.json (written up from tools/datamine/ output; icons by tools/datamine/icons.py).
The Next.js PBE page renders its strings as they are, so they must be player-facing (1f9bd4d2 #100, 4be9b95b #44)."""
import datetime as dt
import re

import pytest

from deeparam_data_helpers import asset_exists, champion_names, flatten_strings, load_json, walk_numbers

PBE_TIERS = {"silver", "gold", "prismatic"}
DIRECTIONS = {"buff", "nerf", "none", "unclear", "mixed"}

# Wording that names where the data comes from or the mode's internals; none of it may reach the page.
FORBIDDEN = [
    r"communitydragon", r"cdragon", r"datamin", r"\bkiwi\b", r"kiwi_", r"\bGoH_", r"guest of honor", r"internally",
    r"hash-named", r"\bbin\b", r"\.bin\b", r"string ?table", r"in the strings", r"in the data\b", r"tencent", r"\bchina\b",
    r"github", r"cloudflare",
]


@pytest.fixture(scope="module")
def pbe():
    return load_json("data/pbe/kiwi-s3.json")


def test_top_level(pbe):
    assert {"meta", "fame", "augments", "championOverrides", "headliners", "championChanges", "itemChanges",
            "modeChanges"} <= set(pbe)


def test_meta(pbe):
    m = pbe["meta"]
    dt.date.fromisoformat(m["dataAsOf"])
    assert m["mode"] == "ARAM: Mayhem"
    for k in ("pbe", "live"):
        assert re.match(r"^\d+\.\d+\.\d+$", m["builds"][k]), k
    pbe_v = tuple(map(int, m["builds"]["pbe"].split(".")[:2]))
    live_v = tuple(map(int, m["builds"]["live"].split(".")[:2]))
    assert pbe_v > live_v
    assert m["augmentPool"]["live"] > 0 and m["augmentPool"]["pbe"] > 0
    assert isinstance(m["notes"], list) and all(isinstance(n, str) and n for n in m["notes"])


def test_augment_counts_match_lists(pbe):
    a, m = pbe["augments"], pbe["meta"]
    assert m["augmentCounts"]["added"] == len(a["added"])
    assert m["augmentCounts"]["removed"] == len(a["removed"])
    # the pool changes by exactly what was added and removed
    assert m["augmentPool"]["pbe"] - m["augmentPool"]["live"] == len(a["added"]) - len(a["removed"])


def test_augment_entries(pbe):
    a = pbe["augments"]
    for kind in ("added", "removed", "changed"):
        for x in a[kind]:
            assert x["name"], (kind, x)
            if kind != "changed" or "tier" in x:
                assert x["tier"] in PBE_TIERS, (kind, x)
            if x.get("icon"):
                assert x["icon"].startswith("/assets/augments/" + ("live/" if kind == "removed" else "pbe/")), x
    for x in a["changed"]:
        assert x["changes"] and x.get("direction", "none") in DIRECTIONS
        for c in x["changes"]:
            assert c["stat"] and c["live"] != c["pbe"], (x["name"], c)
    for x in a["added"]:
        assert x["description"] is None or "@" not in x["description"]
    removed = {x["name"] for x in a["removed"]}
    added = {x["name"] for x in a["added"]}
    assert not removed & added


def test_augment_icons_are_self_hosted(pbe):
    """icons.py copies each icon to web/public/assets/augments/<pbe|live>/ and writes that path."""
    missing = [x["icon"] for kind in ("added", "removed", "changed") for x in pbe["augments"][kind]
               if x.get("icon") and not asset_exists(x["icon"])]
    assert not missing


def test_champions_named_in_pbe_data_exist(pbe):
    names = champion_names()
    used = [c["champion"] for c in pbe["championOverrides"]] + [c["champion"] for c in pbe["championChanges"]["list"]]
    # band members are champions, plus the odd joke member ("a Poro")
    used += [mbr for b in pbe["fame"]["bands"] for mbr in b["members"] if not mbr[0].islower()]
    assert sorted(set(used) - names) == []
    for c in pbe["championOverrides"]:
        assert c["ability"] in ("P", "Q", "W", "E", "R") and c["live"] != c["pbe"]


def test_fame_bands(pbe):
    bands = pbe["fame"]["bands"]
    ids = [b["id"] for b in bands]
    assert len(ids) == len(set(ids))
    unlock = [b["unlockFame"] for b in bands]
    # Only bands new on the test server are listed, so the first need not start unlocked.
    assert all(u >= 0 for u in unlock) and unlock == sorted(unlock)
    ranks = list(pbe["fame"]["superstarRank"]["rankNames"].values())
    assert ranks == sorted(ranks)


def test_headliners(pbe):
    ids = [h["id"] for h in pbe["headliners"]["list"]]
    assert ids and len(ids) == len(set(ids))
    assert all(h["name"] and h["effect"] for h in pbe["headliners"]["list"])


def test_numbers_non_negative(pbe):
    for path, n in walk_numbers(pbe):
        assert n >= 0, path


@pytest.mark.parametrize("pattern", FORBIDDEN)
def test_no_internal_or_source_wording(pbe, pattern):
    """1f9bd4d2 (#100) and 4be9b95b (#44): no codename, internal ids or data-origin wording in what the page shows."""
    rx = re.compile(pattern, re.I)
    hits = [s for s in flatten_strings(pbe) if rx.search(s)]
    assert not hits
