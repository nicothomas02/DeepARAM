"""tools/verify_leaderboard.py keeps the Simulator leaderboard: pending builds are simulated, the best 10
are listed, the rest kept as checked, and a listed build that stops working is removed."""
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
    "time_alive REAL, verified_at TEXT, UNIQUE(build_key, patch))"
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


def test_keeps_top_10_and_removes_broken_builds(sim_bins, tmp_path):
    db = sqlite3.connect(":memory:")
    db.execute(SCHEMA)
    for i in range(12):
        items = ",".join(ITEMS[i:] + ITEMS[:i])
        db.execute("INSERT INTO submissions (champion, items, augments, build_key, patch, created) "
                   "VALUES ('Jinx', ?, '', ?, '', datetime('now'))", (",".join(items.split(",")[:4]), f"b{i}"))
    db.execute("INSERT INTO submissions (champion, items, augments, build_key, patch, created) "
               "VALUES ('Jinx', 'not_an_item', '', 'bad', '', datetime('now'))")
    db.execute("INSERT INTO submissions (champion, items, augments, build_key, patch, created, status) "
               "VALUES ('Jinx', 'collector', '', 'old', 'old patch', datetime('now'), 'checked')")
    run(db, tmp_path)
    assert counts(db) == {"verified": 10, "checked": 2, "rejected": 1}  # the old patch's row is gone
    listed = [r[0] for r in db.execute("SELECT verified_dps FROM submissions WHERE status = 'verified'")]
    kept = [r[0] for r in db.execute("SELECT verified_dps FROM submissions WHERE status = 'checked'")]
    assert min(listed) >= max(kept)

    # A listed build whose item no longer exists leaves the board; the best checked one takes its place.
    best = db.execute("SELECT id FROM submissions WHERE status = 'verified' ORDER BY verified_dps DESC").fetchone()[0]
    db.execute("UPDATE submissions SET items = 'gone_item' WHERE id = ?", (best,))
    sql = run(db, tmp_path)
    assert f"DELETE FROM submissions WHERE id = {best};" in sql
    assert db.execute("SELECT COUNT(*) FROM submissions WHERE id = ?", (best,)).fetchone()[0] == 0
    assert counts(db) == {"verified": 10, "checked": 1, "rejected": 1}
