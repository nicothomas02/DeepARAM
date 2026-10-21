#!/usr/bin/env python3
"""Write viewer/replay-data/dummy-dps.json: each champion's damage per second on a training dummy.

The home page ranks champions by this. Each champion uses its simulated best build (best-builds.json)
and hits a dummy with the average enemy's max Health, armor and magic resist, held at half Health so
abilities that scale with the target's missing (or current) Health count the same for everyone. The
dummy never fights back, so this is pure damage output.

    python3 tools/build_dummy_dps.py [--best viewer/replay-data/best-builds.json] [--out viewer/replay-data/dummy-dps.json]
"""
import argparse
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SIM = Path(__file__).resolve().parent.parent
DUMMY = "fixed_target=1,dummy_hp=0.5"


def dummy_dps(champ, build, trials, seed):
    args = [str(SIM / "mayhem_sim"), "--champ", champ, "--items", ",".join(build["items"]),
            "--set", DUMMY, "--trials", str(trials), "--seed", str(seed), "--json"]
    if build.get("augments"):
        args += ["--augs", ",".join(build["augments"])]
    out = subprocess.run(args, capture_output=True, text=True, check=True, cwd=SIM)
    return json.loads(out.stdout)["builds"][0]["summary"]["mean_dps"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--best", default=SIM / "viewer" / "replay-data" / "best-builds.json", type=Path)
    ap.add_argument("--out", default=SIM / "viewer" / "replay-data" / "dummy-dps.json", type=Path)
    ap.add_argument("--trials", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    champs = [c for c in json.loads(a.best.read_text())["champions"] if c.get("build", {}).get("items")]
    with ThreadPoolExecutor() as pool:
        dps = list(pool.map(lambda c: dummy_dps(c["champion"], c["build"], a.trials, a.seed), champs))
    rows = sorted(({"champion": c["champion"], "dps": round(d, 1)} for c, d in zip(champs, dps)),
                  key=lambda r: (-r["dps"], r["champion"]))
    a.out.write_text(json.dumps({"dummy_hp": 0.5, "champions": rows}, separators=(",", ":")) + "\n")
    print(f"{len(rows)} champions -> {a.out}")


if __name__ == "__main__":
    main()
