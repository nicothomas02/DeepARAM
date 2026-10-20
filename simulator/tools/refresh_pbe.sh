#!/bin/sh
# Rebuilds the simulator's PBE patch data (the Live/PBE switch in the replay's simulation panel)
# from the current PBE patch, for the daily PBE check. Needs only Python 3 and network access:
# the browser engine loads replay-data/pbe/ at run time, so nothing has to be recompiled.
#   sh simulator/tools/refresh_pbe.sh        (from anywhere in the repo)
# Then commit simulator/data/pbe/ and simulator/viewer/replay-data/pbe/ if they changed.
set -e
cd "$(dirname "$0")/.."
mkdir -p data/pbe viewer/replay-data/pbe
python3 tools/build_champion_pool.py --pbe
python3 tools/build_items.py --pbe
python3 tools/build_augments.py --pbe
python3 tools/build_augment_pools.py --pbe
python3 tools/strip_notes.py viewer/replay-data/pbe data/pbe/champions.json data/pbe/items.json data/pbe/augments.json data/pbe/augment_pools.json
# A new build time alone isn't a change: put the old files back so there's nothing to commit.
if git diff --quiet -I '"built_at"' -- data/pbe viewer/replay-data/pbe 2>/dev/null &&
   [ -z "$(git ls-files --others --exclude-standard -- data/pbe viewer/replay-data/pbe)" ]; then
  git checkout -- data/pbe viewer/replay-data/pbe
  echo "refresh_pbe: PBE simulator data unchanged"
else
  echo "refresh_pbe: PBE simulator data changed:"
  git status --short -- data/pbe viewer/replay-data/pbe
fi
