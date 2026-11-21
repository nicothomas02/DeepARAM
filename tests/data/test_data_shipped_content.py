"""Shipped pages and data never say where the data comes from or what runs the site, and never spell the mode's
internal name. The Riot Games "not endorsed" legal notice is allowed (and required).

Regressions for 5b34aab1 (#43), 4be9b95b (#44), 0640abfc (#52), 5879fa77 (#56), 172b6e1d, d89b1443, 968bc2a2,
b174f4cf (#42), 477e80cf / 00c92dbd (China wording), 1f9bd4d2 (#100), ae8e147b (#104) and 5af34b5d (personal data).

What ships: every file web/scripts/sync-embeds.mjs copies into public/embed/ (after its rewrites), the PBE data and
the site's editable text (web/src/content/site.json). Builders (.py), READMEs and site-tab.json manifests that only
feed the nav are left out, as the build leaves them out."""
import functools
import os
import re

import pytest

from deeparam_data_helpers import embed_transform, flatten_strings, load_json, read, repo, shipped_embed_files

# (label, pattern). Matched case-insensitively against the text a visitor can get (page source included).
FORBIDDEN = [
    ("CommunityDragon", r"community ?dragon"),
    ("datamine wording", r"datamin"),
    ("Tencent", r"tencent"),
    ("101.qq.com", r"101\.qq|qq\.com"),
    ("gtimg", r"gtimg"),
    ("Riot API", r"riot api|riot key|riot_api_key"),
    ("Cloudflare", r"cloudflare"),
    ("Next.js", r"next\.js"),
    ("GitHub", r"github"),
    ("built with", r"built with"),
    ("Open full screen", r"open full screen"),
    ("China wording", r"\bchina\b|\bchinese\b|china-server"),
    ("Data Dragon", r"data ?dragon"),
    ("client/game files", r"(?:client|game)(?:'s)? files"),
    ("generator comment", r"do not edit by hand|generated (?:from|by) \w+\.py|build_data\.py|build_history\.py"),
]

# Known current violations: {(file, label)}. Empty today; add one only for a real, reported bug.
KNOWN = set()

# The one allowed credit: the match-statistics source's license (CC BY-NC 4.0) requires naming it with a link, and
# Nico chose a single line on the Info page (2026-11-21). Only that paragraph is exempt, nothing else on the page.
CREDIT = re.compile(r'<p[^>]*id="data-credit"[^>]*>.*?</p>', re.S)

EMBED_FILES = shipped_embed_files()
OTHER_FILES = ["data/pbe/kiwi-s3.json", "web/src/content/site.json"]


@functools.lru_cache(maxsize=None)
def shipped_text(f):
    if f in EMBED_FILES:
        return CREDIT.sub("", embed_transform(read(f)))
    data = load_json(f)
    return "\n".join(flatten_strings(data))  # JSON the Next.js pages render: values only, keys never show


@pytest.mark.parametrize("label,pattern", FORBIDDEN, ids=[x[0] for x in FORBIDDEN])
def test_no_data_origin_or_backend_wording(label, pattern):
    rx = re.compile(pattern, re.I)
    hits = []
    for f in list(EMBED_FILES) + OTHER_FILES:
        for m in rx.finditer(shipped_text(f)):
            t = m.string
            hits.append((f, t[max(0, m.start() - 40):m.end() + 40].replace("\n", " ")))
    unexpected = [h for h in hits if (h[0], label) not in KNOWN]
    assert not unexpected, unexpected[:10]
    if hits:
        pytest.xfail(f"known {label} wording in {sorted({h[0] for h in hits})}")


def test_internal_mode_name_never_ships():
    """ae8e147b (#104): after the build's rewrite, no shipped file spells the mode's internal name."""
    for f in list(EMBED_FILES) + OTHER_FILES:
        assert not re.search(r"kiwi", shipped_text(f), re.I), f


def test_embed_rewrite_rules_still_in_build_script():
    """The checks above assume sync-embeds.mjs still renames the internal name and points outside hosts at
    /assets/; if those rules go, shipped pages would leak both."""
    js = read("web/scripts/sync-embeds.mjs")
    assert r"[/kiwi/gi" in js
    assert r"\{\{\s*Kiwi_[^}]*\}\}" in js
    assert r"https:\/\/raw\.communitydragon\.org\/" in js and '"/assets/cd/"' in js
    assert r"\.(py|md)$" in js, "builders and notes stay out of the published copy"


def test_local_match_archive_never_ships():
    """5af34b5d: dashboard/data/ (a personal match archive) is excluded from the copy and from git."""
    js = read("web/scripts/sync-embeds.mjs")
    assert re.search(r'name:\s*"dashboard",[^}]*exclude:\s*\[\s*"data"\s*\]', js)
    assert "dashboard/data/" in read(".gitignore")
    assert not any(f.startswith(os.path.join("dashboard", "data")) for f in EMBED_FILES)


def test_web_client_code_does_not_spell_internal_name():
    """ae8e147b: browser code writes the pattern as k[i]wi so the shipped script never spells the name. Comments
    are stripped by the production bundle, so only code is checked."""
    files = [repo("web", "src", "lib", "assets.ts")]
    for dirpath, _, names in os.walk(repo("web", "src")):
        for n in names:
            p = os.path.join(dirpath, n)
            if n.endswith((".ts", ".tsx")) and read(p).lstrip().startswith(('"use client"', "'use client'")):
                files.append(p)
    for p in files:
        code = re.sub(r"/\*.*?\*/", "", read(p), flags=re.S)
        code = re.sub(r"(?<![:\"'\w])//.*$", "", code, flags=re.M)
        assert not re.search(r"kiwi", code, re.I), os.path.relpath(p, repo())


def test_riot_legal_notice_kept():
    footer = load_json("web/src/content/site.json")["footer"]
    assert "isn't endorsed by Riot Games" in footer
    assert "isn't endorsed by Riot Games" in read("simulator/viewer/index.html")


def test_pending_tabs_do_not_link_pull_requests():
    """0640abfc (#52): unfinished tabs say "Coming soon." instead of linking the repo's pull requests."""
    src = read("web/src/components/Pending.tsx")
    assert "Coming soon." in src
    assert "REPO_URL" not in src and "/pull/" not in src
    assert "Open full screen" not in read("web/src/components/Embed.tsx")


def test_info_page_credits_match_statistics():
    """The license needs the credit and its link (Nico 2026-11-21: Info page only)."""
    html = read("guide/index.html")
    m = CREDIT.search(html)
    assert m and "github.com/czgreat/aramhex-data" in m.group(0) and "by-nc/4.0" in m.group(0)
