"""Write the champion pages' game text in the site's other languages: i18n/data/<code>.json (champion names, titles,
ability names and text, item and augment names).

Usage: python3 champions/build_i18n.py   (run after build_data.py; it reads data.js for the English)

What it reads, for each language in web/src/i18n/languages.json:
  Data Dragon data/<locale>/championFull.json        names, titles, passive and ability names and text
  CommunityDragon <locale>/v1/items.json,            item and augment names
                  <locale>/v1/cherry-augments.json
With --tags it instead writes i18n/tag_names.json: the official champion tag names (tags.json playstyles) in each
language, from each locale's string table (champion_tag_*). Those rarely change, and each table is ~30 MB, so it isn't
part of the daily run.
Only text that differs from English is written. Page text that isn't game text is in i18n/<code>.json (i18n_keys.py).
"""
import json, os, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DD = "https://ddragon.leagueoflegends.com"
CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global"
SPELL_SLOTS = ["Q", "W", "E", "R"]


def get(url, tries=4):
    # CommunityDragon refuses Python's default User-Agent
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-champions"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except (urllib.error.URLError, ConnectionError):
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)


def clean(text):
    text = re.sub(r"<br\s*/?>", "\n", text or "")
    return re.sub(r"<[^>]+>", "", text).replace("&nbsp;", " ").strip()


def load_js(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        s = f.read()
    return json.loads(s[s.index("=") + 1:].rstrip().rstrip(";"))


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        f.write("\n")


def texts(full):
    """{champion id: {name, title, abilities: {slot: {name, text}}}} from a championFull.json"""
    out = {}
    for c in full["data"].values():
        abilities = {"P": {"name": c["passive"]["name"], "text": clean(c["passive"]["description"])}}
        for slot, s in zip(SPELL_SLOTS, c["spells"]):
            abilities[slot] = {"name": s["name"], "text": clean(s["description"])}
        out[int(c["key"])] = {"name": c["name"], "title": c["title"], "abilities": abilities}
    return out


def changed(en, lo):
    """The fields of lo that differ from en (strings, or dicts of them)."""
    if isinstance(en, dict):
        out = {k: changed(en.get(k), v) for k, v in lo.items()}
        return {k: v for k, v in out.items() if v} or None
    return lo if lo and lo != en else None


def main():
    with open(os.path.join(REPO, "web", "src", "i18n", "languages.json"), encoding="utf-8") as f:
        langs = [(l["code"], l["riot"]) for l in json.load(f) if l["code"] != "en"]
    data = load_js("data.js")
    version = get(f"{DD}/api/versions.json")[0]

    def one(lang):
        code, riot = lang
        lo = riot.lower()
        return (code, get(f"{DD}/cdn/{version}/data/{riot}/championFull.json"),
                get(f"{CD}/{lo}/v1/items.json"), get(f"{CD}/{lo}/v1/cherry-augments.json"))

    with ThreadPoolExecutor(4) as pool:
        for code, full, items, augs in pool.map(one, langs):
            lo_dd = texts(full)
            champs = {}
            for c in data["champions"]:
                x = lo_dd.get(c["id"])
                if not x:
                    continue
                ours = {"name": c["name"], "title": c["title"], "abilities": {a["slot"]: {"name": a["name"], "text": a["text"]} for a in c["abilities"]}}
                mine = {"name": x["name"], "title": x["title"],
                        "abilities": {s: v for s, v in x["abilities"].items() if s in ours["abilities"]}}
                diff = changed(ours, mine)
                if diff:
                    champs[c["alias"]] = diff
            item_names = {str(i["id"]): clean(i.get("name")) for i in items}
            aug_names = {str(a["id"]): clean(a.get("nameTRA")) for a in augs}
            out = {
                "patch": data["patch"],
                "champions": champs,
                "items": {i: item_names[i] for i, v in data["items"].items() if item_names.get(i) and item_names[i] != v["name"]},
                "augments": {i: aug_names[i] for i, v in data["augments"].items() if aug_names.get(i) and aug_names[i] != v["name"]},
            }
            write_json(os.path.join(HERE, "i18n", "data", f"{code}.json"), out)
            print(f"{code}: {len(champs)} champions, {len(out['items'])} items, {len(out['augments'])} augments")


def tag_names():
    sys.path.insert(0, HERE)
    from build_data import PLAYSTYLES, tag_key
    with open(os.path.join(REPO, "web", "src", "i18n", "languages.json"), encoding="utf-8") as f:
        langs = [(l["code"], l["riot"].lower()) for l in json.load(f) if l["code"] != "en"]
    base = CD.split("/plugins/")[0]

    def one(lang):
        code, lo = lang
        entries = get(f"{base}/game/{lo}/data/menu/en_us/lol.stringtable.json")["entries"]
        return code, {n: clean(entries[tag_key(n)]) for n in PLAYSTYLES if entries.get(tag_key(n)) and clean(entries[tag_key(n)]) != n}

    with ThreadPoolExecutor(4) as pool:
        out = dict(sorted(pool.map(one, langs)))
    with open(os.path.join(HERE, "i18n", "tag_names.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    print(f"tag names: {sum(len(v) for v in out.values())} in {len(out)} languages")


if __name__ == "__main__":
    sys.exit(tag_names() if "--tags" in sys.argv else main())
