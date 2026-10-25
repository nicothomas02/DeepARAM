"""The Simulator's page text is all in web/public/i18n/simulator/en.json (the site's languages are
translated from it), and every page loads the language script before its own scripts."""
from __future__ import annotations

import subprocess
import sys

from sim_paths import SIM_DIR, VIEWER_DIR


def test_english_dictionary_is_current(sim_bins):
    r = subprocess.run([sys.executable, str(SIM_DIR / "tools" / "i18n_strings.py"), "--check"],
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, "run python3 simulator/tools/i18n_strings.py\n" + r.stdout + r.stderr


def test_pages_load_i18n_first():
    for page in ("index.html", "full.html", "team.html"):
        html = (VIEWER_DIR / page).read_text(encoding="utf-8")
        i18n = html.find('src="i18n.js')
        assert i18n > 0, page
        for script in ("replay.js", "team.js", "sim-panel.js"):
            at = html.find(f'src="{script}')
            assert at < 0 or at > i18n, f"{page}: {script} loads before i18n.js"
