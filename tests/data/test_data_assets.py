"""Self-hosted assets: every /assets/... file that shipped pages and data point at is in web/public/assets/
(babec446 #87 no broken icons; dbd8c7ac #80 / 6aefa76e #85 self-hosted paths and missing icons)."""
import os
import re

import pytest

from deeparam_data_helpers import (ASSETS, asset_exists, asset_paths, embed_transform, load_json, read,
                                   repo, shipped_embed_files)

# Known missing files: {(repo file, /assets path)}. Empty today; add an entry (and report it) only for a real gap.
KNOWN_MISSING = set()


def _refs(files, transform=True):
    out = []
    for f in files:
        text = read(f)
        if transform:
            text = embed_transform(text)
        out += [(f, p) for p in asset_paths(text)]
    return out


EMBED_FILES = shipped_embed_files()


def test_embed_file_list_covers_the_tabs():
    roots = {f.split(os.sep)[0] for f in EMBED_FILES}
    assert {"dashboard", "guide", "champions", "tools", "simulator"} <= roots
    assert not any(f.endswith((".py", ".md")) for f in EMBED_FILES)
    assert not any(f.startswith(os.path.join("dashboard", "data") + os.sep) for f in EMBED_FILES)


@pytest.mark.parametrize("path", EMBED_FILES)
def test_shipped_page_assets_exist(path):
    refs = _refs([path])
    missing = [p for _, p in refs if not asset_exists(p) and (path, p) not in KNOWN_MISSING]
    assert not missing, f"{path} points at {len(missing)} missing assets: {missing[:10]}"
    known = [p for _, p in refs if (path, p) in KNOWN_MISSING and not asset_exists(p)]
    if known:
        pytest.xfail(f"known missing assets in {path}: {known}")


def test_generated_data_has_asset_paths():
    """Guard against the scan silently finding nothing (a path format change would make every check pass)."""
    for f in ("guide/data.js", "guide/history.js", "champions/data.js"):
        assert len(_refs([f])) > 10, f


def test_shipped_pages_use_no_outside_asset_hosts():
    """After the site build's rewrites, pages load nothing from outside hosts (fonts, images, models, scripts)."""
    url = re.compile(r"https?://[^\s\"'`<>()\\]+")
    # SVG/XML namespaces (not requests), and the site itself (My Stats run from the helper links back to it)
    allowed = re.compile(r"^(http://www\.w3\.org/|https://deeparam\.com/)")
    bad = []
    for f in EMBED_FILES:
        for u in url.findall(embed_transform(read(f))):
            if not allowed.match(u):
                bad.append((f, u[:100]))
    assert not bad


def test_web_source_asset_paths_exist():
    files = []
    for d in ("web/src",):
        for dirpath, _, names in os.walk(repo(d)):
            # dd-swap.json lists client files that are no longer kept, mapped to their official copies
            files += [os.path.relpath(os.path.join(dirpath, n), repo()) for n in names
                      if n.endswith((".ts", ".tsx", ".css", ".json")) and n != "dd-swap.json"]
    refs = _refs(files, transform=False)
    assert refs
    missing = [(f, p) for f, p in refs if not asset_exists(p)]
    assert not missing


def test_official_copies_exist():
    """Every official copy web/src/data/dd-swap.json points at is mirrored."""
    swap = load_json("web/src/data/dd-swap.json")["paths"]
    assert len(swap) > 1000
    missing = [p for p in swap.values() if not asset_exists(p)]
    assert not missing, missing[:10]


def test_large_augment_icon_list():
    """web/src/data/augment-large-icons.json lists small icons whose coloured _large copy is mirrored; localAsset
    swaps them in, so both copies must exist."""
    for p in load_json("web/src/data/augment-large-icons.json"):
        assert p.startswith("/assets/cd/") and p.endswith("_small.png"), p
        assert "kiwi" not in p.lower(), p  # stored as "mayhem" (ae8e147b)
        assert asset_exists(p), p
        assert asset_exists(p[: -len("_small.png")] + "_large.png"), p


def test_pbe_icons_exist():
    pbe = load_json("data/pbe/kiwi-s3.json")
    icons = [x["icon"] for k in ("added", "removed", "changed") for x in pbe["augments"][k] if x.get("icon")]
    assert icons and all(asset_exists(i) for i in icons)


def test_mirror_has_no_internal_name_in_paths():
    """ae8e147b (#104): mirrored files and folders named kiwi are stored as mayhem."""
    bad = []
    for dirpath, dirs, files in os.walk(ASSETS):
        for n in dirs + files:
            if "kiwi" in n.lower():
                bad.append(os.path.relpath(os.path.join(dirpath, n), ASSETS))
    assert not bad[:20]


def test_manifest():
    m = load_json("web/public/assets/manifest.json")
    assert re.match(r"^\d+\.\d+$", m["patch"])
    assert m["ddragon_version"].startswith(m["patch"])
    assert os.path.isdir(os.path.join(ASSETS, "dd", m["ddragon_version"]))
    for k, n in m["files"].items():
        assert n >= 0 and os.path.isdir(os.path.join(ASSETS, k)), k
    for rel, parts in m.get("split", {}).items():
        for i in range(parts):
            assert os.path.isfile(os.path.join(ASSETS, rel + f".part{i}")), rel


def test_no_mirrored_file_over_host_limit():
    """Cloudflare serves static files up to 25 MiB; bigger ones must be split (fetch_assets.py split_large)."""
    cap = 25 * 1024 * 1024
    big = []
    for dirpath, _, files in os.walk(ASSETS):
        for n in files:
            p = os.path.join(dirpath, n)
            if os.path.getsize(p) > cap:
                big.append(os.path.relpath(p, ASSETS))
    assert not big
