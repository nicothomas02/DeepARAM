"""The fight replay ships in two editions: full.html (3D models, the website's default) and index.html
(2D, "Performance mode"), generated from one another by simulator/tools/make_full_viewer.py. Both
must work the same apart from how the arena is drawn."""
import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VIEWER = ROOT / "simulator" / "viewer"


def _maker():
    spec = importlib.util.spec_from_file_location("make_full_viewer", ROOT / "simulator" / "tools" / "make_full_viewer.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_full_edition_is_up_to_date():
    public = (VIEWER / "index.html").read_text()
    assert (VIEWER / "full.html").read_text() == _maker().full_html(public), "run python3 simulator/tools/make_full_viewer.py"


def test_2d_edition_loads_no_3d_models():
    public = (VIEWER / "index.html").read_text()
    assert 'data-edition="public"' in public
    assert "models3d.js" not in public and "importmap" not in public
    full = (VIEWER / "full.html").read_text()
    assert 'data-edition="full"' in full and "models3d.js" in full


def test_editions_differ_only_in_the_3d_models():
    public = (VIEWER / "index.html").read_text()
    full = (VIEWER / "full.html").read_text()
    # Same page apart from the edition flag, the 3D scripts and the Riot notice naming the models.
    strip = lambda h: re.sub(r'data-edition="\w+"|<!-- full-edition-scripts -->|<script type="importmap">.*?</script>\n?|<script type="module" src="models3d\.js[^"]*"></script>|The champion [a-z, ]+ belong to Riot Games\.', "", h, flags=re.S)
    assert strip(public) == strip(full)
    # replay.js only checks the edition to attach the models; sounds, abilities and the fight are shared.
    js = (VIEWER / "replay.js").read_text()
    uses = [m.start() for m in re.finditer(r"\bFULL\b", js)]
    models = js.index("// ---------- 3D models ----------")
    sounds = js.index("// ---------- ability and death sounds ----------")
    assert all(models < u < sounds for u in uses[1:]), "only the 3D models section may depend on the edition"
