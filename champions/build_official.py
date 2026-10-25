"""Write champions/official.json: each champion's official roles and difficulty from Riot's champion pages.

Usage: python3 champions/build_official.py   (uses the aliases in champions/tags.json; run build_regions.py first)
Also writes profile.js (region, roles, difficulty per champion) for the champion page banner.

Reads https://www.leagueoflegends.com/en-us/champions/ for the champion links, then each champion page's
__NEXT_DATA__ ("role.roles[].name" and "difficulty" {name, value, maxValue}). Output: {"difficulty": [level names],
"champions": {alias: {"roles": [...], "difficulty": 1-3}}}. Every page also has passive/Q/W/E/R preview videos on
Riot's CDN; they aren't mirrored (outside host), so they're left out here.
"""
import json, os, re, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = "https://www.leagueoflegends.com/en-us/champions/"
SPECIAL = {"wukong": "MonkeyKing", "nunuwillump": "Nunu", "renataglasc": "Renata"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 deeparam-champions"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def next_data(html):
    return re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S).group(1)


def main():
    norm = lambda s: re.sub(r"[^a-z]", "", s.lower())  # noqa: E731
    aliases = {norm(a): a for a in json.load(open(os.path.join(HERE, "tags.json")))["champions"]}
    slugs = sorted(set(re.findall(r'/en-us/champions/([a-z0-9-]+)/', next_data(get(SITE)))))
    out, levels, unmatched = {}, {}, []
    for slug in slugs:
        t = next_data(get(SITE + slug + "/"))
        m = re.search(r'"role":\{"label":"[^"]*","roles":(\[.*?\])\},"difficulty":(\{.*?\})', t)
        title = (re.search(r'"title":"([^"]+)"', t) or [None, slug])[1]
        key = SPECIAL.get(norm(title)) or SPECIAL.get(norm(slug)) or aliases.get(norm(title)) or aliases.get(norm(slug))
        if not m or not key:
            unmatched.append(slug)
            continue
        diff = json.loads(m.group(2))
        levels[diff["value"]] = diff["name"]
        out[key] = {"roles": [r["name"] for r in json.loads(m.group(1))], "difficulty": diff["value"]}
    res = {"difficulty": [levels.get(i) for i in range(1, max(levels) + 1)], "champions": dict(sorted(out.items()))}
    with open(os.path.join(HERE, "official.json"), "w") as f:
        json.dump(res, f, indent=1, ensure_ascii=False)
        f.write("\n")
    # the champion page's banner line: home region (regions.json), official roles and difficulty
    regions = json.load(open(os.path.join(HERE, "regions.json")))
    region_name = {r["key"]: r["name"] for r in regions["regions"]}
    profile = {a: {"region": " · ".join(region_name[r] for r in regions["champions"].get(a, []) if r != "unaffiliated") or None,
                   "roles": c["roles"], "difficulty": res["difficulty"][c["difficulty"] - 1]} for a, c in res["champions"].items()}
    with open(os.path.join(HERE, "profile.js"), "w") as f:
        f.write("window.CHAMPS_PROFILE = " + json.dumps(profile, ensure_ascii=False, separators=(",", ":")) + ";\n")
    missing = sorted(set(aliases.values()) - set(out))
    print(f"{len(out)} champions; levels {res['difficulty']}; unmatched pages {unmatched}; no page for {missing}")


if __name__ == "__main__":
    main()
