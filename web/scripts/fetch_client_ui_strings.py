"""Client wording the site reuses, in every site language, from the client's own interface strings:
Draft practice's champ-select text (i18n ns "tier-list") and the champion details screen's playstyle ratings ("champions").
Merges them into web/public/i18n/<ns>/<code>.json (the English text is the key).

Usage (from the repo root):
  python3 web/scripts/fetch_client_ui_strings.py
"""
import json, os, urllib.request
import concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, ".."))
I18N = os.path.join(WEB, "public", "i18n")
LANGS = os.path.join(WEB, "src", "i18n", "languages.json")
CD = "https://raw.communitydragon.org/latest/plugins"
UA = {"User-Agent": "deeparam-client-strings"}

# English site text -> client string key. Draft practice gives at most two rerolls, so {n} uses the "few" form where a
# language has one (Czech, Polish, Russian), else "other".
CHAMP_SELECT = {
    "PICK YOUR CHAMPION": ["subset-champions-grid-header"],
    "Blessing": ["subset-champions-blessing-card-header"],
    "You pulled an extra champion!": ["subset-champions-blessing-card-body"],
    "Available Champions": ["champion_bench_label"],
    "Re-rolled champions show up here. Click one to switch your selection.": ["champion_bench_label_tooltip"],
    "Click to switch your selection to {name}.": ["champion_bench_item_tooltip"],
    "Lock In": ["lock_in"],
    "You have no champion rerolls available.": ["reroll_tooltip[zero]"],
    "You have 1 champion reroll available.": ["reroll_tooltip[one]"],
    "You have {n} champion rerolls available.": ["reroll_tooltip[few]", "reroll_tooltip[other]"],
}
PLAYSTYLE = {
    "Damage": ["cdp_playstyle_damage_tooltip_title"],
    "Toughness": ["cdp_playstyle_toughness_tooltip_title"],
    "Crowd Control": ["cdp_playstyle_crowd_control_tooltip_title"],
    "Mobility": ["cdp_playstyle_mobility_tooltip_title"],
    "Utility": ["cdp_playstyle_utility_tooltip_title"],
    "The champion's ability to deal damage to enemy champions": ["cdp_playstyle_damage_tooltip"],
    "The champion's ability to absorb damage from enemy champions": ["cdp_playstyle_toughness_tooltip"],
    "The champion's ability to apply harmful effects like slows and stuns to enemy champions": ["cdp_playstyle_crowd_control_tooltip"],
    "The champion's ability to move quickly around the map using blinks or dashes": ["cdp_playstyle_mobility_tooltip"],
    "The champion's ability to grant beneficial effects like shields, healing, or movement speed to allied champions": ["cdp_playstyle_utility_tooltip"],
}
# (client plugin, site namespace, strings)
SOURCES = [("rcp-fe-lol-champ-select", "tier-list", CHAMP_SELECT), ("rcp-fe-lol-champion-details", "champions", PLAYSTYLE)]
VARS = {"{{championName}}": "{name}", "{{rerolls}}": "{n}"}


def table(plugin, riot):
    url = f"{CD}/{plugin}/global/{riot.lower()}/trans.json"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def strings(t, keys_by_en):
    out = {}
    for en, keys in keys_by_en.items():
        v = next((t[k] for k in keys if t.get(k)), None)
        if not v:
            continue
        for a, b in VARS.items():
            v = v.replace(a, b)
        # The one-reroll form names the number in the client; the site's key says "1".
        v = v.strip()
        out[en] = v.replace("{n}", "1") if en.startswith("You have 1 ") else v
    return out


def main():
    langs = json.load(open(LANGS))
    for plugin, ns, keys in SOURCES:
        with cf.ThreadPoolExecutor(4) as pool:
            found = dict(zip([l["code"] for l in langs], pool.map(lambda l: strings(table(plugin, l["riot"]), keys), langs)))
        for code, d in found.items():
            path = os.path.join(I18N, ns, f"{code}.json")
            cur = json.load(open(path)) if os.path.exists(path) else {}
            cur.update({en: (en if code == "en" else v) for en, v in d.items()})
            with open(path, "w") as f:
                f.write(json.dumps(cur, ensure_ascii=False, indent=1) + "\n")
        print(f"{ns}: {len(keys)} strings, {len(found)} languages")


if __name__ == "__main__":
    main()
