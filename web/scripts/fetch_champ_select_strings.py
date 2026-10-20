"""Draft practice's champ-select wording, in every site language, from the client's own champ-select strings.
Merges them into web/public/i18n/tier-list/<code>.json (the English text is the key).

Usage (from the repo root):
  python3 web/scripts/fetch_champ_select_strings.py
"""
import json, os, urllib.request
import concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, ".."))
I18N = os.path.join(WEB, "public", "i18n", "tier-list")
LANGS = os.path.join(WEB, "src", "i18n", "languages.json")
CD = "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-champ-select/global"
UA = {"User-Agent": "deeparam-champ-select"}

# English site text -> client string key. Draft practice gives at most two rerolls, so {n} uses the "few" form where a
# language has one (Czech, Polish, Russian), else "other".
KEYS = {
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
VARS = {"{{championName}}": "{name}", "{{rerolls}}": "{n}"}


def table(riot):
    url = f"{CD}/{riot.lower()}/trans.json"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def strings(t):
    out = {}
    for en, keys in KEYS.items():
        v = next((t[k] for k in keys if t.get(k)), None)
        if not v:
            continue
        for a, b in VARS.items():
            v = v.replace(a, b)
        # The one-reroll form names the number in the client; the site's key says "1".
        out[en] = v.replace("{n}", "1") if en.startswith("You have 1 ") else v
    return out


def main():
    langs = json.load(open(LANGS))
    with cf.ThreadPoolExecutor(4) as pool:
        found = dict(zip([l["code"] for l in langs], pool.map(lambda l: strings(table(l["riot"])), langs)))
    for code, d in found.items():
        path = os.path.join(I18N, f"{code}.json")
        cur = json.load(open(path)) if os.path.exists(path) else {}
        cur.update({en: (en if code == "en" else v) for en, v in d.items()})
        with open(path, "w") as f:
            f.write(json.dumps(cur, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(KEYS)} strings, {len(found)} languages")


if __name__ == "__main__":
    main()
