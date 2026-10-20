"""Mayhem's champion quests (rival and team pairs), written to web/src/data/rival-quests.json and their translations to
web/public/i18n/quests/<code>.json.

The pairs come from the Mayhem mode's quest list in the map file (map12.bin, CharacterQuestListConfig); the names, goals and
win rewards are the game's own strings, already translated in every client language.

Usage (from the repo root):
  python3 web/scripts/fetch_rival_quests.py
"""
import json, os, re, urllib.request
import concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.join(WEB, "src", "data", "rival-quests.json")
I18N = os.path.join(WEB, "public", "i18n", "quests")
LANGS = os.path.join(WEB, "src", "i18n", "languages.json")
CD = "https://raw.communitydragon.org/latest/game"
UA = {"User-Agent": "deeparam-quests"}

# Each quest as the map file pairs it: string key, the two champions, enemies or allies, and each champion's
# goal and reward key stems (lol.stringtable.json).
QUESTS = [
    {"key": "viktorvsjayce", "side": "enemy", "champs": {"Jayce": ("jayceinstructions", "jayce"), "Viktor": ("viktorinstructions", "viktor")}},
    {"key": "warwickvsvi", "side": "enemy", "champs": {"Warwick": ("ww_instructions", "ww"), "Vi": ("vi_instructions", "vi")}},
    {"key": "jinxvscaitlyn", "side": "enemy", "champs": {"Jinx": ("instructionsjinx", "jinx"), "Caitlyn": ("instructionscait", "caitlyn")}},
    {"key": "singedvsheimerdinger", "side": "enemy", "champs": {"Singed": ("instructions", "singed"), "Heimerdinger": ("instructions", "heimerdinger")}},
    # Jinx with Ekko on the same team: each has its own quest of the same name, with no goal or reward text.
    {"key": "jinxteam", "side": "ally", "champs": {"Jinx": (None, None), "Ekko": (None, None)}, "names": {"Jinx": "jinxteam", "Ekko": "ekkoteam"}},
]

TITLE = re.compile(r"<titleLeft>(.*?)</titleLeft>", re.S)
MAIN = re.compile(r"<mainText>(.*?)</mainText>", re.S)
FLAVOR = re.compile(r"<flavorText>.*?</flavorText>", re.S)
TAGS = re.compile(r"<[^>]+>")


def clean(s):
    s = FLAVOR.sub("", s or "").replace("<br>", " ")
    return re.sub(r"\s+", " ", TAGS.sub("", s)).strip()


def table(riot):
    url = f"{CD}/{riot.lower()}/data/menu/en_us/lol.stringtable.json"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                d = json.loads(r.read().decode("utf-8"))
                return d.get("entries", d)
        except Exception:
            if attempt == 2:
                raise


def quests(t):
    """[{champion, partner, side, name, goal, reward, rewardText}] from one language's string table."""
    out = []
    for q in QUESTS:
        champs = list(q["champs"])
        for c in champs:
            partner = champs[1] if c == champs[0] else champs[0]
            goal_key, reward_key = q["champs"][c]
            name_key = q.get("names", {}).get(c, q["key"])
            row = {"champion": c, "partner": partner, "side": q["side"], "name": clean(t.get(f"quests_{name_key}_name"))}
            if goal_key:
                row["goal"] = clean(t.get(f"quests_{q['key']}_{goal_key}"))
            if reward_key:
                tip = t.get(f"generatedtip_buffnosource_crepe_{q['key']}_{reward_key}reward_tooltip", "")
                title, main = TITLE.search(tip), MAIN.search(tip)
                if title and main:
                    row["reward"], row["rewardText"] = clean(title.group(1)), clean(main.group(1))
            out.append(row)
    return out


def main():
    langs = json.load(open(LANGS))
    with cf.ThreadPoolExecutor(4) as pool:
        tables = dict(zip([l["code"] for l in langs], pool.map(lambda l: quests(table(l["riot"])), langs)))
    en = tables["en"]
    assert all(r["name"] for r in en), "a quest name is missing from the English strings"
    with open(DATA, "w") as f:
        f.write(json.dumps(en, ensure_ascii=False, indent=1) + "\n")
    os.makedirs(I18N, exist_ok=True)
    fields = ["name", "goal", "reward", "rewardText"]
    for code, rows in tables.items():
        d = {}
        for e, r in zip(en, rows):
            for k in fields:
                if e.get(k) and r.get(k):
                    d[e[k]] = r[k]
        with open(os.path.join(I18N, f"{code}.json"), "w") as f:
            f.write(json.dumps(d, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(en)} quest rows, {len(tables)} languages")


if __name__ == "__main__":
    main()
