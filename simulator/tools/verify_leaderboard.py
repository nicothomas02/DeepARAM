#!/usr/bin/env python3
"""Keep the Simulator leaderboard (each champion's best build), re-running every build with the native simulator.

The replay page sends every build a visitor simulates on the live patch (web/src/app/api/sim-scores); the
damage it sends is never trusted. This takes rows from the deeparam-sim D1 database (table submissions),
checks each build is legal, simulates it with the default settings on the live patch against the Survival
enemy (the same for every champion), and prints SQL that writes the result and keeps the board:

    python3 tools/verify_leaderboard.py --query            # the SELECT to run first
    python3 tools/verify_leaderboard.py rows.json > updates.sql

rows.json is that query's result: a JSON list of {id, champion, items, augments, status} with items and
augments as comma-separated keys (or {"results": [...]}). It holds the pending builds and the listed
ones, so every run checks the listed builds still work: one that no longer does (an item or augment gone,
the simulator refuses it) is deleted, the others get this run's numbers. A pending build that fails is
marked rejected. Then each champion's best build of this patch (by damage per second) is "verified"
(listed) and the rest "checked" (kept so a repeat isn't simulated again); checked and rejected rows from
an older patch are deleted. Besides damage, each row keeps the fight's other numbers in `stats` (JSON).
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIM = ROOT / "mayhem_sim"
# Survival: every champion fights the same enemy with its most popular build, until it dies (the default
# fight). Ashe is the most picked enemy; Ashe herself fights Teemo. Keep in step with SURVIVAL in
# viewer/sim-panel.js and the Survival tab's text (web/src/components/SimLeaderboard.tsx).
SURVIVAL_ENEMY, SURVIVAL_FALLBACK = "Ashe", "Teemo"
# The other numbers the simulator's modes rank by, kept with each build (summary key -> stats key).
STATS = {"damage_taken": "taken", "damage_mitigated": "mitigated", "healing": "healing", "shielding": "shielding",
         "cc_seconds": "cc"}
QUERY = ("SELECT id, champion, items, augments, status FROM submissions WHERE status IN ('pending', 'verified') "
         "ORDER BY status = 'verified' DESC, id LIMIT 500")


def sim(*args):
    out = subprocess.run([str(SIM), *args], cwd=ROOT, capture_output=True, text=True)
    return out.returncode, out.stdout, out.stderr.strip()


def sql(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(round(float(v), 4))
    return "'" + str(v).replace("'", "''") + "'"


def check(row, meta):
    """The champion's canonical id if the build is legal, else (None, reason)."""
    champ = meta["champions"].get(str(row["champion"]).lower())
    if not champ:
        return None, "unknown champion"
    items = [k for k in str(row["items"]).split(",") if k]
    augs = [k for k in str(row.get("augments") or "").split(",") if k]
    if not items or len(items) > 6 or len(set(items)) != len(items):
        return None, "items"
    if any(k not in meta["items"] for k in items):
        return None, "unknown item"
    if sum(meta["items"][k]["slot"] == "boots" for k in items) > 1:
        return None, "two boots"
    groups = [meta["items"][k]["group"] for k in items if meta["items"][k].get("group")]
    if len(set(groups)) != len(groups):
        return None, "two items of one group"
    if len(augs) > 4 or len(set(augs)) != len(augs) or any(a not in champ["augments"] for a in augs):
        return None, "augments"
    return champ["id"], None


def board(patch):
    """SQL that lists each champion's best build of this patch and keeps the rest as checked."""
    p = sql(patch)
    best = ("SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY champion ORDER BY verified_dps DESC) AS n "
            f"FROM submissions WHERE status IN ('verified', 'checked') AND patch = {p}) WHERE n = 1")
    return [
        f"DELETE FROM submissions WHERE status IN ('checked', 'rejected') AND patch != {p};",
        f"UPDATE submissions SET status = 'checked' WHERE status = 'verified' AND id NOT IN ({best});",
        f"UPDATE submissions SET status = 'verified' WHERE status = 'checked' AND id IN ({best});",
    ]


def main():
    if sys.argv[1:] == ["--query"]:
        print(QUERY + ";")
        return
    rows = json.load(open(sys.argv[1]))
    if isinstance(rows, dict):
        rows = rows.get("results", rows.get("rows", []))
    code, out, err = sim("--list", "--json")
    if code:
        sys.exit(err)
    raw = json.loads(out)
    meta = {
        "champions": {c["id"].lower(): c for c in raw["champions"]},
        "items": {i["key"]: i for i in raw["items"]},
    }
    patch = (ROOT / "data" / "tuned_patch.txt").read_text().strip()

    def fail(row, why):
        # A listed build that stopped working leaves the board; a new one is remembered as rejected.
        if row.get("status") == "verified":
            print(f"DELETE FROM submissions WHERE id = {int(row['id'])}; -- no longer works: {why}")
        else:
            print(f"UPDATE submissions SET status = 'rejected', patch = {sql(patch)}, verified_at = datetime('now') "
                  f"WHERE id = {int(row['id'])}; -- {why}")

    for row in rows:
        champ, why = check(row, meta)
        if not champ:
            fail(row, why)
            continue
        enemy = SURVIVAL_FALLBACK if champ == SURVIVAL_ENEMY else SURVIVAL_ENEMY
        args = ["--champ", champ, "--json", "--items", row["items"], "--team", enemy]
        if row.get("augments"):
            args += ["--augs", row["augments"]]
        code, out, err = sim(*args)
        if code:
            fail(row, err[:80].replace("\n", " "))
            continue
        s = json.loads(out)["builds"][0]["summary"]
        stats = {k: round(float(s[key]), 2) for key, k in STATS.items() if key in s}
        # Checked for now; board() then lists each champion's best.
        print(
            f"UPDATE submissions SET status = 'checked', champion = {sql(champ)}, verified_dps = {sql(s['mean_dps'])}, "
            f"stats = {sql(json.dumps(stats, separators=(',', ':')))}, "
            f"survival = {sql(s['survival_rate'])}, time_alive = {sql(s['time_alive'])}, patch = {sql(patch)}, "
            f"verified_at = datetime('now') WHERE id = {int(row['id'])};"
        )
    print("\n".join(board(patch)))


if __name__ == "__main__":
    main()
