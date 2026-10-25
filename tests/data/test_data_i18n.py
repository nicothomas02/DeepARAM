"""The Info page and champion pages in the site's languages: guide/ and champions/ i18n.js, i18n/<code>.json (page text,
keyed by English; guide/i18n_keys.py writes en.json) and the game text in i18n/data and i18n/augments
(guide/build_data.py --languages, champions/build_i18n.py)."""
import json
import os
import re

import pytest

from deeparam_data_helpers import load_js_data, load_json, load_module, read, repo

FOLDERS = ["guide", "champions"]
LANGS = [l["code"] for l in load_json("web/src/i18n/languages.json") if l["code"] != "en"]
PLACEHOLDER = re.compile(r"\{\w+\}")


@pytest.fixture(scope="module")
def keys():
    return load_module("guide/i18n_keys.py", "i18n_keys", extra_path=["guide"])


def test_one_runtime_for_both_pages():
    """Both folders ship the same i18n.js, and it knows every site language."""
    a, b = read("guide/i18n.js"), read("champions/i18n.js")
    assert a == b
    codes = json.loads(re.search(r"const CODES = (\[[^\]]+\])", a).group(1))
    assert codes == ["en"] + LANGS


@pytest.mark.parametrize("folder", FOLDERS)
def test_pages_load_the_runtime_first(folder):
    html = read(f"{folder}/index.html")
    assert html.index('src="i18n.js"') < html.index('src="data.js"') < html.index('src="app.js"')
    assert read(f"{folder}/app.js").lstrip().startswith(("I18N.ready.then(", "// "))


@pytest.mark.parametrize("folder", FOLDERS)
def test_english_keys_are_current(keys, folder):
    """en.json lists every string the page passes to t() or marks data-t; rerun guide/i18n_keys.py when it fails."""
    assert list(load_json(f"{folder}/i18n/en.json")) == keys.keys_for(folder)


@pytest.mark.parametrize("folder", FOLDERS)
@pytest.mark.parametrize("lang", LANGS)
def test_every_language_has_every_key(folder, lang):
    en = load_json(f"{folder}/i18n/en.json")
    lo = load_json(f"{folder}/i18n/{lang}.json")
    assert set(lo) == set(en), (sorted(set(en) - set(lo))[:5], sorted(set(lo) - set(en))[:5])
    for k, v in lo.items():
        assert isinstance(v, str) and v.strip(), k
        assert sorted(PLACEHOLDER.findall(k)) == sorted(PLACEHOLDER.findall(v)), (k, v)


def test_t_call_scanner(keys):
    src = 't("A {n}", { n }) + t(x ? "B" : `C`) + t(`D ${x}`) + t(label)'
    assert keys.t_calls(src) == ["A {n}", "B", "C"]


@pytest.mark.parametrize("lang", LANGS)
def test_game_text_files(lang):
    """Every language has the game text; none of it is a link or an asset path."""
    for path in (f"guide/i18n/data/{lang}.json", f"guide/i18n/augments/{lang}.json",
                 f"champions/i18n/data/{lang}.json"):
        assert os.path.exists(repo(path)), path
        assert not re.search(r"https?://|/assets/", read(path)), path


@pytest.mark.parametrize("lang", ["fr", "ja"])
def test_game_text_matches_the_pages(lang):
    """Translations are keyed by what the pages hold: champion aliases and slots, item and augment ids, list indexes."""
    data = load_js_data("champions/data.js", "CHAMPS_DATA")
    tr = load_json(f"champions/i18n/data/{lang}.json")
    aliases = {c["alias"]: c for c in data["champions"]}
    assert set(tr["champions"]) <= set(aliases) and len(tr["champions"]) > 150
    for alias, x in tr["champions"].items():
        assert set(x.get("abilities", {})) <= {a["slot"] for a in aliases[alias]["abilities"]}
    assert set(tr["items"]) <= set(data["items"]) and set(tr["augments"]) <= set(data["augments"])
    guide = load_js_data("guide/data.js", "GUIDE_DATA")
    g = load_json(f"guide/i18n/data/{lang}.json")["guide"]

    def walk(ov, en, path):
        for k, v in ov.items():
            node = en[int(k)] if isinstance(en, list) else en[k]
            if isinstance(v, dict):
                walk(v, node, f"{path}.{k}")
            else:
                assert isinstance(node, str), f"{path}.{k}"
    walk(g, guide, "guide")
    assert g["quests"] and g["challenges"] and g["champSelect"]["keystoneAugments"]


def test_overlay_matches_lists_by_id():
    B = load_module("guide/build_data.py", "build_data_i18n", extra_path=["tools/datamine"])
    en = {"xs": [{"id": 1, "name": "A", "tier": "Gold"}, {"id": 2, "name": "B"}], "notes": ["x", "y"], "icon": "a.png"}
    lo = {"xs": [{"id": 2, "name": "Bé"}, {"id": 1, "name": "Â", "tier": "Or"}], "notes": ["x", "ÿ"], "icon": "b.png"}
    assert B.overlay(en, lo) == {"xs": {"0": {"name": "Â"}, "1": {"name": "Bé"}}, "notes": {"1": "ÿ"}}
    assert B.quest_labels("<font color='#F0C200'>QUÊTE :</font> a <font color='#F0C200'>RÉCOMPENSE :</font> b") == "QUEST: a REWARD: b"


def test_no_public_player_lookup():
    """The Info page doesn't look up other players' accounts (Nico, 2026-10-17)."""
    assert "riotId" not in read("guide/index.html") and "/api/riot/" not in read("guide/app.js")


def test_no_queue_ids_section():
    """The Info tab doesn't list queue ids (Nico, 2026-10-17)."""
    assert 'id="queues"' not in read("guide/index.html") and '$("queues")' not in read("guide/app.js")


def test_no_maps_or_summoner_spell_lists():
    """The Info tab doesn't list map skins or summoner spells (Nico, 2026-10-17)."""
    html, js = read("guide/index.html"), read("guide/app.js")
    assert not any(x in html or x in js for x in ("map-list", "spell-list"))


def test_no_archive_or_augment_history_tabs():
    """The Info tab has no Archive or Augment history tab (Nico, 2026-10-17). guide/history.js stays for Patch Recaps."""
    html, js = read("guide/index.html"), read("guide/app.js")
    assert not any(x in html for x in ('data-tab="history"', 'data-tab="archive"', 'src="history.js"'))
    assert "GUIDE_HISTORY" not in js and "set-list" not in js
