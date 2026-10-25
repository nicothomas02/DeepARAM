"""Write champions/regions.json: each champion's home region, from Riot's League of Legends Universe site.

Usage: python3 champions/build_regions.py   (run after build_data.py; uses the aliases in champions/tags.json)

Format: {"regions": [{"key": "freljord", "name": "Freljord"}, ...], "champions": {"Ashe": ["freljord"], ...}}.
Each champion gets a list so a second region can be added later; Universe gives one region per champion.
Champions with no region are under "unaffiliated" (Universe's own key, named "Runeterra" there).
"""
import json, os, re, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = "https://universe-meeps.leagueoflegends.com/v1/en_us/search/index.json"


def norm(s):
    return re.sub(r"[^a-z]", "", s.lower())


def main():
    req = urllib.request.Request(INDEX, headers={"User-Agent": "deeparam-champions"})
    with urllib.request.urlopen(req, timeout=120) as r:
        uni = json.load(r)
    names = {f["slug"]: f["name"] for f in uni["factions"]}
    names.setdefault("unaffiliated", "Runeterra")
    tags = json.load(open(os.path.join(HERE, "tags.json")))["champions"]
    by_key = {}
    for c in uni["champions"]:
        for k in (c["slug"], c["name"]):
            by_key[norm(k)] = c["associated-faction-slug"] or "unaffiliated"
    champions, missing = {}, []
    for alias, t in sorted(tags.items()):
        region = by_key.get(norm(t["name"])) or by_key.get(norm(alias))
        if region:
            champions[alias] = [region]
        else:
            missing.append(alias)
    label = lambda k: re.sub(r"^The ", "", names.get(k, k.replace("-", " ").title()))  # noqa: E731
    used = sorted({r for rs in champions.values() for r in rs}, key=lambda k: (k == "unaffiliated", label(k)))
    out = {"regions": [{"key": k, "name": label(k)} for k in used],
           "champions": champions}
    with open(os.path.join(HERE, "regions.json"), "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{len(champions)} champions in {len(used)} regions; no region found for {missing}")


if __name__ == "__main__":
    main()
