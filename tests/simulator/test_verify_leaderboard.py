"""tools/verify_leaderboard.py keeps the Simulator leaderboard: pending builds are simulated, each
champion's best is listed, the rest kept as checked, and a listed build that stops working is removed."""
from __future__ import annotations

import json
import sqlite3
import subprocess
import sys

from sim_paths import SIM_DIR

TOOL = SIM_DIR / "tools" / "verify_leaderboard.py"
# The D1 table (deeparam-sim, submissions).
SCHEMA = (
    "CREATE TABLE submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, champion TEXT NOT NULL, items TEXT NOT NULL, "
    "augments TEXT NOT NULL, build_key TEXT NOT NULL, patch TEXT NOT NULL, claimed_dps REAL, ip_hash TEXT, "
    "created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', verified_dps REAL, survival REAL, "
    "time_alive REAL, verified_at TEXT, stats TEXT, UNIQUE(build_key, patch))"
)
ITEMS = ["collector", "bloodthirster", "botrk", "black_cleaver", "archangels", "actualizer",
         "blackfire", "banshees", "abyssal_mask", "atmas", "bf_sword", "amp_tome"]


def run(db, tmp_path):
    db.row_factory = sqlite3.Row
    query = subprocess.run([sys.executable, str(TOOL), "--query"], capture_output=True, text=True, check=True).stdout
    rows = tmp_path / "rows.json"
    rows.write_text(json.dumps([dict(r) for r in db.execute(query)]))
    out = subprocess.run([sys.executable, str(TOOL), str(rows)], capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stderr
    db.executescript(out.stdout)
    return out.stdout


def counts(db):
    return dict(db.execute("SELECT status, COUNT(*) FROM submissions GROUP BY status").fetchall())


def add(db, champion, items, key, patch="", status="pending"):
    db.execute("INSERT INTO submissions (champion, items, augments, build_key, patch, created, status) "
               "VALUES (?, ?, '', ?, ?, datetime('now'), ?)", (champion, items, key, patch, status))


def test_lists_each_champions_best_and_removes_broken_builds(sim_bins, tmp_path):
    db = sqlite3.connect(":memory:")
    db.execute(SCHEMA)
    for i in range(4):
        add(db, "Jinx", ",".join((ITEMS[i:] + ITEMS[:i])[:4]), f"j{i}")
        add(db, "Garen", ",".join((ITEMS[i + 4:] + ITEMS[:i + 4])[:4]), f"g{i}")
    add(db, "Jinx", "not_an_item", "bad")
    add(db, "Jinx", "collector", "old", patch="old patch", status="checked")
    run(db, tmp_path)
    assert counts(db) == {"verified": 2, "checked": 6, "rejected": 1}  # the old patch's row is gone
    for champ in ("Jinx", "Garen"):
        listed, *rest = [r[0] for r in db.execute(
            "SELECT verified_dps FROM submissions WHERE champion = ? AND status IN ('verified', 'checked') "
            "ORDER BY status = 'verified' DESC", (champ,))]
        assert listed >= max(rest)
    stats = json.loads(db.execute("SELECT stats FROM submissions WHERE status = 'verified'").fetchone()[0])
    assert {"taken", "mitigated", "healing", "cc"} <= stats.keys()

    # A listed build whose item no longer exists leaves the board; that champion's next best takes its place.
    best = db.execute("SELECT id FROM submissions WHERE status = 'verified' AND champion = 'Jinx'").fetchone()[0]
    db.execute("UPDATE submissions SET items = 'gone_item' WHERE id = ?", (best,))
    sql = run(db, tmp_path)
    assert f"DELETE FROM submissions WHERE id = {best};" in sql
    assert db.execute("SELECT COUNT(*) FROM submissions WHERE id = ?", (best,)).fetchone()[0] == 0
    assert counts(db) == {"verified": 2, "checked": 5, "rejected": 1}
