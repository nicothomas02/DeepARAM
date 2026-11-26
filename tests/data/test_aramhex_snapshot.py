"""An AramHex download is all-or-nothing, and a copy whose match count doesn't fit its tables is never published.

2026-11-26, 11:06 UTC: AramHex's new 16.23 release renamed fields in one table (hero_augment_items.json). fetch.py had
already written that patch's new champion, augment, spell and item tables when it stopped on a KeyError, before the
patch's meta.json with the new match count. The workflow step keeps going when the download fails, so merge.py divided
the new tables' games (8,401,866 matches' worth) by the old count (4,991,976): every augment pick rate 1.68x too high,
six of them above 100% on the site. The fixtures below are that case in small: 10,000 matches, then 17,000."""
import hashlib
import json
import os
import sys

import pytest

from deeparam_data_helpers import load_module

PATCH = "16.23"
CHAMPIONS = [str(i) for i in range(1, 21)]
AUGMENT = "1238"
# Ten players a match, so twenty champions with 5,000 games each are 10,000 matches (8,500 each: 17,000 matches).
# The augment is held 0.8 times a match in both releases.
OLD = {"matches": 10000, "games": 5000, "held": 400, "seq": 20}
NEW = {"matches": 17000, "games": 8500, "held": 680, "seq": 22}


def load_aramhex(script, name):
    """fetch.py and merge.py `import common`, and so do the data/estimates scripts with their own common.py: load with
    that name free, then put sys.path and sys.modules back for the other test files."""
    saved_path, saved = list(sys.path), sys.modules.pop("common", None)
    try:
        return load_module(f"data/aramhex/{script}.py", name)
    finally:
        sys.path[:] = saved_path
        sys.modules.pop("common", None)
        if saved is not None:
            sys.modules["common"] = saved


def put(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(obj if isinstance(obj, str) else json.dumps(obj))


def snapshot(root):
    """{relative path: bytes} of every file under root."""
    out = {}
    for d, _, names in os.walk(root):
        for n in names:
            p = os.path.join(d, n)
            with open(p, "rb") as f:
                out[os.path.relpath(p, root)] = f.read()
    return out


# ---------------------------------------------------------------- merge.py: what gets published

def site(tmp_path, rel, matches, core_games=None, carried=(), carried_cores=(), earlier=None, builds=()):
    """A small repo tree: an AramHex copy with release `rel`'s tables and `matches` in its meta, and the site files
    merge.py lays it over (pick rate 0.8 from the last good run). `core_games`: also an item table and one 3-item
    core per champion with that many games. `earlier`: (release, matches) of a 16.22 saved next to the live patch.
    `builds`: champions with a build file."""
    root = str(tmp_path)
    ah = os.path.join(root, "data", "aramhex", "patches")
    put(os.path.join(ah, "index.json"), {"patches": ["16.22"] * bool(earlier) + [PATCH], "latest": PATCH, "seq": rel["seq"]})
    if earlier:
        put(os.path.join(ah, "16.22", "heroes.json"), {c: [earlier[0]["games"], earlier[0]["games"] // 2] for c in CHAMPIONS})
        put(os.path.join(ah, "16.22", "meta.json"), {"patch": "16.22", "matches": earlier[1]})
    put(os.path.join(ah, PATCH, "heroes.json"), {c: [rel["games"], rel["games"] // 2] for c in CHAMPIONS})
    put(os.path.join(ah, PATCH, "augments.json"), {c: {AUGMENT: [rel["held"], rel["held"] // 2]} for c in CHAMPIONS})
    put(os.path.join(ah, PATCH, "meta.json"), {"patch": PATCH, "matches": matches, "snapshot_at": "2026-11-26T09:00:00+08:00",
                                               "carried_from_earlier_patch": list(carried), "carried_cores": list(carried_cores)})
    if core_games:
        put(os.path.join(ah, PATCH, "items.json"), {c: {"all": [rel["games"], rel["games"] // 2], "items": {}} for c in CHAMPIONS})
        put(os.path.join(ah, PATCH, "cores.json"), {c: [[[3031, 3032, 3036], core_games, core_games // 2]] for c in CHAMPIONS})
    cn = os.path.join(root, "data", "cn")
    champs = [{"champion_id": int(c), "win_rate": 0.5, "pick_rate": 0.5} for c in CHAMPIONS]
    put(os.path.join(cn, "champions.json"), {"meta": {"champion_stat_date": "20261125"}, "champions": champs})
    put(os.path.join(cn, "augments.json"), {"meta": {}, "augments": [
        {"augment_id": int(AUGMENT), "win_rate": 0.5, "pick_rate": 0.8, "games": 8000, "win_rank": 1, "pick_rank": 1}]})
    put(os.path.join(cn, "history", "patches.csv"), "patch\n" + PATCH + "\n")
    put(os.path.join(cn, "history", "by_patch.csv"),
        "patch,champion_id,win_rate,pick_rate\n" + "".join(f"{PATCH},{c},0.5,0.5\n" for c in CHAMPIONS))
    put(os.path.join(cn, "history", "by_patch.json"), {"patches": [{"patch": PATCH, "days": 2}], "champions": {
        PATCH: [{"id": int(c), "win_rate": 0.5, "pick_rate": 0.5} for c in CHAMPIONS]}})
    os.makedirs(os.path.join(cn, "builds"))
    for c in builds:
        put(os.path.join(cn, "builds", c + ".json"), {"augments": {"all": []}, "items": {"core": "from 101"}})
    return root


@pytest.fixture
def merge(monkeypatch):
    m = load_aramhex("merge", "aramhex_merge")

    def at(root):
        cn = os.path.join(root, "data", "cn")
        monkeypatch.setattr(m.ah, "ROOT", root)
        monkeypatch.setattr(m.ah, "PATCHES", os.path.join(root, "data", "aramhex", "patches"))
        for name, path in (("ROOT", root), ("CN", cn), ("HIST", os.path.join(cn, "history")), ("BUILDS", os.path.join(cn, "builds")),
                           ("GAMES", os.path.join(root, "data", "stats", "games.json")),
                           ("SPELLS", os.path.join(root, "data", "fill", "spells_games.json"))):
            monkeypatch.setattr(m, name, path)
        monkeypatch.setattr(sys, "argv", ["merge.py"])
        return m
    return at


def published_pick_rate(root):
    with open(os.path.join(root, "data", "cn", "augments.json"), encoding="utf-8") as f:
        return json.load(f)["augments"][0]["pick_rate"]


def test_merge_refuses_new_tables_with_the_old_match_count(tmp_path, merge, capsys):
    """The 11:06 UTC state: new tables, old match count. Unfixed, this wrote pick_rate 13,600 / 10,000 = 1.36."""
    root = site(tmp_path, NEW, matches=OLD["matches"])
    before = snapshot(root)
    assert merge(root).main() == 1
    assert snapshot(root) == before, "a refused copy must leave every published file as it was"
    assert published_pick_rate(root) == 0.8
    err = capsys.readouterr().err
    assert "::error::" in err and "170,000 games" in err and "10,000 matches" in err


def test_merge_never_hands_out_a_match_count_that_does_not_fit(tmp_path, merge):
    m = merge(site(tmp_path, NEW, matches=OLD["matches"]))
    with pytest.raises(m.ah.SnapshotError):
        m.ah.matches(PATCH)
    with pytest.raises(m.ah.SnapshotError):
        m.merge_live_augments(False, PATCH)
    with pytest.raises(m.ah.SnapshotError):
        m.ah.champion_rates(PATCH)


@pytest.mark.parametrize("rel", [OLD, NEW])
def test_merge_publishes_a_matching_copy(tmp_path, merge, rel):
    root = site(tmp_path, rel, matches=rel["matches"])
    assert merge(root).main() == 0
    assert published_pick_rate(root) == 0.8
    with open(os.path.join(root, "data", "cn", "champions.json"), encoding="utf-8") as f:
        champs = json.load(f)["champions"]
    assert round(sum(c["pick_rate"] for c in champs), 6) == 10  # ten players a match


def test_merge_refuses_cores_with_more_games_than_the_champion(tmp_path, merge, capsys):
    """Another patch's cores counted as this patch's own (2026-11-26: 16.22's cores in the 16.23 release would have
    read as pick rates up to 240%). Marked as carried, they are simply not used."""
    root = site(tmp_path, NEW, matches=NEW["matches"], core_games=3 * NEW["games"])
    before = snapshot(root)
    assert merge(root).main() == 1
    assert snapshot(root) == before
    assert "3-item cores" in capsys.readouterr().err
    assert merge(site(tmp_path / "carried", NEW, matches=NEW["matches"], core_games=3 * NEW["games"], carried=["cores"])).main() == 0
    assert merge(site(tmp_path / "own", NEW, matches=NEW["matches"], core_games=NEW["games"] // 4)).main() == 0


def test_merge_checks_every_saved_patch_not_only_the_live_one(tmp_path, merge):
    """Earlier patches' champion rates are laid over the history files too."""
    root = site(tmp_path, NEW, matches=NEW["matches"], earlier=(NEW, OLD["matches"]))
    before = snapshot(root)
    assert merge(root).main() == 1
    assert snapshot(root) == before
    assert merge(site(tmp_path / "fits", NEW, matches=NEW["matches"], earlier=(OLD, OLD["matches"]))).main() == 0


def test_match_count_must_be_exactly_a_tenth_of_the_champion_games():
    ah = load_aramhex("merge", "aramhex_merge").ah
    heroes = {c: [5000, 2500] for c in CHAMPIONS}  # 100,000 games: 10,000 matches
    assert ah.snapshot_problem(heroes, 10000) is None
    assert ah.snapshot_problem(heroes, 9999) and ah.snapshot_problem(heroes, 10001)  # too many games, too few
    assert ah.snapshot_problem(heroes, 17000)  # an older table under a newer count
    assert ah.snapshot_problem(heroes, None) and ah.snapshot_problem(heroes, 0)  # no count at all
    assert ah.snapshot_problem({}, None) is None and ah.snapshot_problem(None, 10000) is None  # no table: nothing to lay over


def test_merge_uses_cores_only_for_champions_whose_cores_are_the_patchs_own(tmp_path, merge):
    """fetch.py lists the champions whose cores repeat an earlier patch's; the others get theirs (2026-11-26: every
    champion but Sylas)."""
    root = site(tmp_path, NEW, matches=NEW["matches"], core_games=NEW["games"] // 4, carried_cores=["1"], builds=["1", "2"])
    assert merge(root).main() == 0
    built = {}
    for c in ("1", "2"):
        with open(os.path.join(root, "data", "cn", "builds", c + ".json"), encoding="utf-8") as f:
            built[c] = json.load(f)
    assert built["1"]["items"]["core"] == "from 101" and built["1"]["sources"].get("items.core") is None
    assert built["2"]["sources"]["items.core"] == "aramhex"
    assert built["2"]["items"]["core"] == [{"items": [3031, 3032, 3036], "pick_rate": 0.25, "win_rate": 0.4998, "games": 2125, "ordered": True}]
    # a carried champion's cores may have more games than the champion (they are another patch's): not a reason to refuse
    over = site(tmp_path / "over", NEW, matches=NEW["matches"], core_games=3 * NEW["games"], carried_cores=CHAMPIONS)
    assert merge(over).main() == 0


# ---------------------------------------------------------------- fetch.py: what gets saved

def dataset(src, patch, rel, index=None, destiny="old", cut=None, hashes=True, cores=None):
    """Writes release `rel` of one patch into a local copy of the AramHex repo and returns its index.json entry.
    `index`: the release the entry describes (another one = an index that doesn't belong to the files). `cut`: a table
    that arrives cut off. `cores`: {champion: (items, games)} for core_builds.json."""
    base = os.path.join(src, "patches", patch, "normal")

    def tables(r):
        won = {"total": r["held"]} if destiny == "new" else {"total": r["held"], "total_wins": r["held"] // 2}
        return {
            "meta.json": {},
            "heroes.json": {c: {"games": r["games"], "wins": r["games"] // 2} for c in CHAMPIONS},
            "hero_augments.json": {c: {AUGMENT: {"games": r["held"], "wins": r["held"] // 2}} for c in CHAMPIONS},
            "augments.json": {AUGMENT: {"rarity": "gold"}},
            "hero_spells.json": {c: {"4+32": {"games": r["games"], "wins": r["games"] // 2}} for c in CHAMPIONS},
            "hero_augment_items.json": {c: {"3081": dict(won, items=[{"item": "3031", "games": 100, "wins": 50}])} for c in CHAMPIONS},
            **({"core_builds.json": {c: [{"items": i, "games": g, "wins": g // 2}] for c, (i, g) in cores.items()}} if cores else {}),
        }

    files = {n: json.dumps(t) for n, t in tables(rel).items()}
    for n, text in files.items():
        put(os.path.join(base, n), text[: len(text) // 2] if n == cut else text)
    listed = {n: json.dumps(t) for n, t in tables(index or rel).items()}
    return {"patch": patch, "mode": "normal", "path": f"patches/{patch}/normal", "matches": (index or rel)["matches"],
            "snapshot_at": "2026-11-26T09:00:00+08:00", "seq": (index or rel)["seq"],
            "files": {n: ({"sha256": hashlib.sha256(t.encode()).hexdigest()} if hashes else {}) for n, t in listed.items()}}


def publish(src, datasets):
    put(os.path.join(src, "index.json"), {"schema_version": 1, "latest_seq": max(d["seq"] for d in datasets), "datasets": datasets})
    put(os.path.join(src, "LICENSE"), "CC BY-NC 4.0")
    return src


def upstream(tmp_path, name, rel, **how):
    """A local copy of the AramHex repo (fetch.py --src) holding release `rel` of the one patch."""
    src = os.path.join(str(tmp_path), name)
    return publish(src, [dataset(src, PATCH, rel, **how)])


@pytest.fixture
def fetch(tmp_path, monkeypatch):
    f = load_aramhex("fetch", "aramhex_fetch")
    ours = os.path.join(str(tmp_path), "ours")
    monkeypatch.setattr(f, "OUT", os.path.join(ours, "patches"))
    monkeypatch.setattr(f, "UPSTREAM", os.path.join(ours, "upstream.json"))
    monkeypatch.setattr(f, "CHANGES", os.path.join(ours, "changes.json"))

    def run(src):
        monkeypatch.setattr(sys, "argv", ["fetch.py", "--src", src])
        return f.main()
    run.ours = ours
    run.problem = lambda patch=PATCH: f.ah.snapshot_problem(saved(ours, "heroes", patch), saved(ours, "meta", patch)["matches"])
    return run


def saved(ours, name, patch=PATCH):
    with open(os.path.join(ours, "patches", patch, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def copy(ours):
    """Everything fetch.py saves but its notes for the owner (a failed download adds one line there)."""
    return {k: v for k, v in snapshot(ours).items() if k != "changes.json"}


def notes(ours):
    path = os.path.join(ours, "changes.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [e["note"] for e in json.load(f)]


def not_saved(ours):
    return [n for n in notes(ours) if "was not saved" in n]


def test_fetch_saves_a_release_whose_files_are_the_ones_its_index_lists(tmp_path, fetch):
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    assert saved(fetch.ours, "meta")["matches"] == OLD["matches"] and fetch.problem() is None
    assert fetch(upstream(tmp_path, "new", NEW)) == 0
    assert saved(fetch.ours, "meta")["matches"] == NEW["matches"] and fetch.problem() is None
    assert saved(fetch.ours, "heroes")["1"] == [NEW["games"], NEW["games"] // 2]
    assert not not_saved(fetch.ours)


def test_fetch_survives_the_renamed_weapon_of_destiny_fields(tmp_path, fetch):
    """The release that broke the 11:06 UTC run: hero_augment_items.json without total_wins. The other tables and the
    new match count are saved together; the table it can't read stays as it was and is noted for the owner."""
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    destiny = snapshot(fetch.ours)[os.path.join("patches", PATCH, "destiny.json")]
    assert fetch(upstream(tmp_path, "new", NEW, destiny="new")) == 0
    assert saved(fetch.ours, "meta")["matches"] == NEW["matches"] and fetch.problem() is None
    assert "destiny" not in saved(fetch.ours, "meta")["tables"]
    assert snapshot(fetch.ours)[os.path.join("patches", PATCH, "destiny.json")] == destiny
    noted = notes(fetch.ours)
    assert any("hero_augment_items.json" in n for n in noted)
    assert fetch(upstream(tmp_path, "again", NEW, destiny="new")) == 0  # noted once, not on every run
    assert notes(fetch.ours) == noted


def test_fetch_that_stops_half_way_saves_nothing_and_says_so_once(tmp_path, fetch, capsys):
    """A table that can't be read after others were converted: unfixed, the new champion and augment tables were
    already on disk next to the old match count, and nothing told the owner."""
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    before = copy(fetch.ours)
    capsys.readouterr()
    assert fetch(upstream(tmp_path, "new", NEW, cut="hero_spells.json", hashes=False)) == 1
    assert copy(fetch.ours) == before
    assert "::error::AramHex download stopped" in capsys.readouterr().err
    assert len(not_saved(fetch.ours)) == 1 and f"seq {NEW['seq']} " in not_saved(fetch.ours)[0]
    assert fetch(upstream(tmp_path, "new", NEW, cut="hero_spells.json", hashes=False)) == 1  # the same release again
    assert len(not_saved(fetch.ours)) == 1 and copy(fetch.ours) == before
    assert fetch(upstream(tmp_path, "fine", NEW)) == 0  # and the release is saved once it can be read
    assert fetch.problem() is None and saved(fetch.ours, "meta")["matches"] == NEW["matches"]


@pytest.mark.parametrize("hashes", [True, False])
def test_fetch_refuses_tables_that_are_not_the_ones_the_index_lists(tmp_path, fetch, capsys, hashes):
    """New tables behind the previous index (each file is cached on its own for five minutes): refused by the files'
    sha256 where the index lists them, and by ten players a match either way."""
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    before = copy(fetch.ours)
    capsys.readouterr()
    assert fetch(upstream(tmp_path, "mixed", NEW, index=OLD, hashes=hashes)) == 1
    assert copy(fetch.ours) == before
    err = capsys.readouterr().err
    assert "::error::AramHex download refused" in err and ("index.json lists" in err if hashes else "170,000 games" in err)
    assert len(not_saved(fetch.ours)) == 1


@pytest.mark.parametrize("matches", [NEW["matches"] + 1, NEW["matches"] - 1, None])
def test_fetch_refuses_a_match_count_that_is_not_a_tenth_of_the_champion_games(tmp_path, fetch, matches):
    """Too few games for the count, too many, or no count at all."""
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    before = copy(fetch.ours)
    src = os.path.join(str(tmp_path), "off")
    ds = dataset(src, PATCH, NEW)
    ds["matches"] = matches
    assert fetch(publish(src, [ds])) == 1
    assert copy(fetch.ours) == before


def test_fetch_saves_no_patch_when_a_later_one_is_refused(tmp_path, fetch):
    """16.22 converts cleanly with new numbers, 16.23 is refused: 16.22's new tables must not be saved either."""
    src = os.path.join(str(tmp_path), "both")
    assert fetch(publish(src, [dataset(src, "16.22", OLD), dataset(src, PATCH, OLD)])) == 0
    before = copy(fetch.ours)
    src = os.path.join(str(tmp_path), "later")
    assert fetch(publish(src, [dataset(src, "16.22", NEW), dataset(src, PATCH, NEW, index=OLD)])) == 1
    assert copy(fetch.ours) == before
    assert saved(fetch.ours, "heroes", "16.22")["1"] == [OLD["games"], OLD["games"] // 2]
    src = os.path.join(str(tmp_path), "fine")
    assert fetch(publish(src, [dataset(src, "16.22", NEW), dataset(src, PATCH, NEW)])) == 0
    assert fetch.problem("16.22") is None and fetch.problem() is None and copy(fetch.ours) != before


def test_fetch_saves_nothing_when_the_upstream_notes_fail(tmp_path, fetch):
    """After the tables, fetch.py reads a few more files for its notes on upstream changes (watch). A failure there
    must not leave new tables next to the old index.json and upstream.json."""
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    before = copy(fetch.ours)
    src = upstream(tmp_path, "new", NEW)
    os.remove(os.path.join(src, "LICENSE"))
    assert fetch(src) == 1
    assert copy(fetch.ours) == before and len(not_saved(fetch.ours)) == 1


def test_fetch_lists_the_champions_whose_cores_repeat_an_earlier_patch(tmp_path, fetch):
    """AramHex's 16.23 release keeps 16.22's cores for every champion but one, in a file with a new hash. Their games
    are 16.22's, so merge.py must not lay them over 16.23's item games; the one champion with new cores gets them."""
    src = os.path.join(str(tmp_path), "two")
    before = {c: (["3031", "3032", "3036"], 40000 + int(c)) for c in CHAMPIONS}
    now = {c: before[c] if int(c) <= 18 else (["3118", "4005", "4628"], 900 + int(c)) for c in CHAMPIONS}
    earlier, later = dataset(src, "16.22", OLD, cores=before), dataset(src, PATCH, NEW, cores=now)
    for ds in (earlier, later):  # a champion with no cores in either patch (Viego's rows are []) repeats nothing
        with open(os.path.join(src, ds["path"], "core_builds.json"), encoding="utf-8") as f:
            table = json.load(f)
        table["20"] = []
        table["1"][0]["wins"] += ds is later  # a recount of wins doesn't make 16.22's games this patch's
        put(os.path.join(src, ds["path"], "core_builds.json"), table)
        del ds["files"]["core_builds.json"]["sha256"]
    assert fetch(publish(src, [later, earlier])) == 0
    meta = saved(fetch.ours, "meta")
    assert meta["carried_cores"] == [str(i) for i in range(1, 19)] and meta["carried_from_earlier_patch"] == []
    assert saved(fetch.ours, "meta", "16.22")["carried_cores"] == []
    assert saved(fetch.ours, "cores")["19"] == [[[3118, 4005, 4628], 919, 459]] and saved(fetch.ours, "cores")["20"] == []
    assert any("18 of 19 champions" in n for n in notes(fetch.ours))
