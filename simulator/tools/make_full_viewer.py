#!/usr/bin/env python3
"""Write viewer/full.html, the 3D edition of the fight replay, from viewer/index.html.

index.html draws fights in 2D with champion icons; full.html is the same page with the 3D models added.
The website shows full.html by default and index.html when a visitor picks "Performance mode".
Run this after editing index.html:

    python3 tools/make_full_viewer.py
"""
import re
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"


def full_html(public: str) -> str:
    version = re.search(r'window\.REPLAY_VERSION = "([^"]+)"', public).group(1)
    out = public.replace('data-edition="public"', 'data-edition="full"', 1)
    out = out.replace(
        "<!-- full-edition-scripts -->",
        '<script type="importmap">{"imports": {"three": "/assets/lib/three-0.160.0/build/three.module.js",\n'
        '  "three/addons/": "/assets/lib/three-0.160.0/examples/jsm/"}}</script>\n'
        f'<script type="module" src="models3d.js?v={version}"></script>',
        1,
    )
    out = out.replace("The champion sounds and icons belong to Riot Games.",
                      "The champion models, animations, sounds and icons belong to Riot Games.", 1)
    return out


if __name__ == "__main__":
    (VIEWER / "full.html").write_text(full_html((VIEWER / "index.html").read_text()))
    print("wrote", VIEWER / "full.html")
