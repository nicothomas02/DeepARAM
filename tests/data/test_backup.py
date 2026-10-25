"""tools/backup/backup.py: incremental repo bundles, incremental shared-folder packs, the D1 dump query."""
import json, os, sqlite3, subprocess, sys, tarfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "backup"))
import backup  # noqa: E402


def run(*args, cwd):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def origin(tmp_path):
    repo = tmp_path / "origin"
    repo.mkdir()
    run("git", "init", "-q", "-b", "main", cwd=repo)
    run("git", "config", "user.email", "t@example.com", cwd=repo)
    run("git", "config", "user.name", "t", cwd=repo)

    def commit(name):
        (repo / name).write_text(name)
        run("git", "add", name, cwd=repo)
        run("git", "commit", "-q", "-m", name, cwd=repo)
    commit("a")
    commit.repo = repo
    return commit


def prepare(tmp_path, origin, files, name):
    out = tmp_path / "backups" / name
    state = tmp_path / "state.json"
    backup.main(["prepare", "--out", str(out), "--state", str(state), "--patch", "26.21",
                 "--repo", str(origin.repo), "--files", str(files)])
    manifest = json.load(open(out / "MANIFEST.json"))
    backup.main(["finish", "--out", str(out), "--state", str(state)])
    return out, manifest


def test_backups_are_incremental_and_restore_in_order(tmp_path, origin):
    files = tmp_path / "shared"
    (files / "docs").mkdir(parents=True)
    (files / "docs" / "plan.md").write_text("v1")
    (files / "old.txt").write_text("gone soon")
    (files / "backups").mkdir()
    (files / "backups" / "staging.bin").write_text("never packed")

    first, m1 = prepare(tmp_path, origin, files, "one")
    assert m1["repo"]["new_commits"] == 1 and m1["repo"]["parts"] == ["repo.bundle"]
    assert m1["project_files"]["changed"] == 2 and m1["previous"] is None
    with tarfile.open(first / "project-files.tar.gz") as t:
        assert sorted(t.getnames()) == ["docs/plan.md", "old.txt"]
    assert (first / "RESTORE.md").exists() and not (first / "pending-state.json").exists()

    origin("b")
    (files / "docs" / "plan.md").write_text("v2")
    (files / "old.txt").unlink()
    second, m2 = prepare(tmp_path, origin, files, "two")
    assert m2["repo"]["new_commits"] == 1 and m2["previous"] == "one"
    assert m2["project_files"]["changed"] == 1 and m2["project_files"]["removed"] == ["old.txt"]

    # Nothing new: no bundle, no tarball.
    third, m3 = prepare(tmp_path, origin, files, "three")
    assert m3["repo"]["parts"] == [] and m3["project_files"]["parts"] == []
    assert not (third / "repo.bundle").exists()

    # Replaying the bundles oldest first rebuilds main.
    restored = tmp_path / "restored"
    run("git", "init", "-q", str(restored), cwd=tmp_path)
    for b in (first, second):
        run("git", "fetch", "-q", str(b / "repo.bundle"), "refs/heads/*:refs/heads/*", cwd=restored)
    head = subprocess.run(["git", "rev-parse", "main"], cwd=restored, capture_output=True, text=True).stdout.strip()
    assert head == m2["repo"]["refs"]["refs/heads/main"]


def test_split_big_files(tmp_path, monkeypatch):
    monkeypatch.setattr(backup, "PART", 10)
    f = tmp_path / "x.bin"
    f.write_bytes(bytes(range(25)))
    parts = backup.split_big(str(f))
    assert parts == ["x.bin.part001", "x.bin.part002", "x.bin.part003"]
    assert b"".join((tmp_path / p).read_bytes() for p in parts) == bytes(range(25))


def test_d1_query_round_trips(capsys):
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE t (id INTEGER, name TEXT, blob TEXT)")
    db.executemany("INSERT INTO t VALUES (?, ?, ?)", [(1, "it's", None), (2, "two\nlines", "{}")])
    backup.main(["d1-query", "t", "id", "name", "blob"])
    dump = db.execute(capsys.readouterr().out).fetchone()[0]
    copy = sqlite3.connect(":memory:")
    copy.execute("CREATE TABLE t (id INTEGER, name TEXT, blob TEXT)")
    copy.executescript(dump)
    assert copy.execute("SELECT * FROM t ORDER BY id").fetchall() == db.execute("SELECT * FROM t ORDER BY id").fetchall()
