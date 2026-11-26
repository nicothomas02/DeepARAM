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

def site(tmp_path, rel, matches, core_games=None, carried=()):
    """A small repo tree: an AramHex copy with release `rel`'s tables and `matches` in its meta, and the site files
    merge.py lays it over (pick rate 0.8 from the last good run). `core_games`: also an item table and one 3-item
    core per champion with that many games."""
    root = str(tmp_path)
    ah = os.path.join(root, "data", "aramhex", "patches")
    put(os.path.join(ah, "index.json"), {"patches": [PATCH], "latest": PATCH, "seq": rel["seq"]})
    put(os.path.join(ah, PATCH, "heroes.json"), {c: [rel["games"], rel["games"] // 2] for c in CHAMPIONS})
    put(os.path.join(ah, PATCH, "augments.json"), {c: {AUGMENT: [rel["held"], rel["held"] // 2]} for c in CHAMPIONS})
    put(os.path.join(ah, PATCH, "meta.json"), {"patch": PATCH, "matches": matches, "snapshot_at": "2026-11-26T09:00:00+08:00",
                                               "carried_from_earlier_patch": list(carried)})
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
        for left in ("STAGED", "SKIPPED", "CORES"):  # nothing carried over from another test's refused download
            getattr(f, left, []).clear()
        monkeypatch.setattr(sys, "argv", ["fetch.py", "--src", src])
        return f.main()
    run.ours = ours
    run.problem = lambda: f.ah.snapshot_problem(saved(ours, "heroes"), saved(ours, "meta")["matches"])
    return run


def saved(ours, name):
    with open(os.path.join(ours, "patches", PATCH, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def test_fetch_saves_a_release_whose_files_are_the_ones_its_index_lists(tmp_path, fetch):
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    assert saved(fetch.ours, "meta")["matches"] == OLD["matches"] and fetch.problem() is None
    assert fetch(upstream(tmp_path, "new", NEW)) == 0
    assert saved(fetch.ours, "meta")["matches"] == NEW["matches"] and fetch.problem() is None
    assert saved(fetch.ours, "heroes")["1"] == [NEW["games"], NEW["games"] // 2]


def test_fetch_survives_the_renamed_weapon_of_destiny_fields(tmp_path, fetch):
    """The release that broke the 11:06 UTC run: hero_augment_items.json without total_wins. The other tables and the
    new match count are saved together; the table it can't read stays as it was and is noted for the owner."""
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    destiny = snapshot(fetch.ours)[os.path.join("patches", PATCH, "destiny.json")]
    assert fetch(upstream(tmp_path, "new", NEW, destiny="new")) == 0
    assert saved(fetch.ours, "meta")["matches"] == NEW["matches"] and fetch.problem() is None
    assert "destiny" not in saved(fetch.ours, "meta")["tables"]
    assert snapshot(fetch.ours)[os.path.join("patches", PATCH, "destiny.json")] == destiny
    with open(os.path.join(fetch.ours, "changes.json"), encoding="utf-8") as f:
        notes = [e["note"] for e in json.load(f)]
    assert any("hero_augment_items.json" in n for n in notes)
    assert fetch(upstream(tmp_path, "again", NEW, destiny="new")) == 0  # noted once, not on every run
    with open(os.path.join(fetch.ours, "changes.json"), encoding="utf-8") as f:
        assert [e["note"] for e in json.load(f)] == notes


def test_fetch_that_stops_half_way_leaves_the_last_copy(tmp_path, fetch):
    """A table that can't be read after others were converted: unfixed, the new champion and augment tables were
    already on disk next to the old match count."""
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    before = snapshot(fetch.ours)
    with pytest.raises(Exception):
        fetch(upstream(tmp_path, "new", NEW, cut="hero_spells.json", hashes=False))
    assert snapshot(fetch.ours) == before


@pytest.mark.parametrize("hashes", [True, False])
def test_fetch_refuses_tables_that_are_not_the_ones_the_index_lists(tmp_path, fetch, capsys, hashes):
    """New tables behind the previous index (each file is cached on its own for five minutes): refused by the files'
    sha256 where the index lists them, and by ten players a match either way."""
    assert fetch(upstream(tmp_path, "old", OLD)) == 0
    before = snapshot(fetch.ours)
    capsys.readouterr()
    assert fetch(upstream(tmp_path, "mixed", NEW, index=OLD, hashes=hashes)) == 1
    assert snapshot(fetch.ours) == before
    err = capsys.readouterr().err
    assert "::error::" in err and ("index.json lists" in err if hashes else "170,000 games" in err)


@pytest.mark.parametrize("repeated, carried", [(19, ["cores"]), (0, [])])
def test_fetch_marks_cores_repeated_from_the_patch_before_as_carried(tmp_path, fetch, repeated, carried):
    """AramHex's 16.23 release keeps 16.22's cores for every champion but one, in a file with a new hash. Their games
    are 16.22's, so they must not be laid over 16.23's item games as its own."""
    src = os.path.join(str(tmp_path), "two")
    before = {c: (["3031", "3032", "3036"], 40000 + int(c)) for c in CHAMPIONS}
    now = {c: before[c] if int(c) <= repeated else (["3118", "4005", "4628"], 900 + int(c)) for c in CHAMPIONS}
    publish(src, [dataset(src, PATCH, NEW, cores=now), dataset(src, "16.22", OLD, cores=before)])
    assert fetch(src) == 0
    assert saved(fetch.ours, "meta")["carried_from_earlier_patch"] == carried
    assert saved(fetch.ours, "cores")["20"] == [[[3118, 4005, 4628], 920, 460]]
