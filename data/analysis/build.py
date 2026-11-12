"""Runs every analysis in this folder, in dependency order. `python3 data/analysis/build.py`; the daily
estimates workflow (.github/workflows/fill.yml) runs it after the Mayhem stats refresh."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c  # noqa: E402
import game_length  # noqa: E402
import item_lift  # noqa: E402
import meta_settling  # noqa: E402
import patch_forecast  # noqa: E402
import patch_impact  # noqa: E402
import playstyle_clusters  # noqa: E402

if __name__ == "__main__":
    c.write_json(c.OUT / "patch_impact.json", patch_impact.build())
    c.write_json(c.OUT / "meta_settling.json", meta_settling.build())
    c.write_json(c.OUT / "playstyle_clusters.json", playstyle_clusters.build())
    c.write_json(c.OUT / "patch_forecast.json", patch_forecast.build())
    c.write_json(c.OUT / "item_lift.json", item_lift.build())
    length = game_length.build()  # needs archive_aggregates.json, written by hand with owner_archive.py
    if length:
        c.write_json(c.OUT / "game_length.json", length)
    print("data/analysis: patch_impact, meta_settling, playstyle_clusters, patch_forecast, item_lift" + (", game_length" if length else "") + " written")
