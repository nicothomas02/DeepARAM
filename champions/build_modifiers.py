"""Write data/wiki/mayhem_modifiers.json (and modifiers.js for the champion pages): each champion's Mayhem
damage dealt, damage taken, healing, shielding, tenacity, ability haste, attack speed and energy changes.

Usage: python3 champions/build_modifiers.py   (uses the aliases in champions/tags.json)

These adjustments are applied by Riot's game servers and aren't in any client file, so they come from the official
League of Legends wiki (Nico allowed it, 2026-10-17): the "Mode-Specific Changes" table on its ARAM page, with the
ARAM: Mayhem page's table on top ("changed to X from Y"; X is the Mayhem value). Both pages are read through the
r.jina.ai reader because the wiki refuses scripted fetches. Every value is stored with the page and the date read.

Values: percentages as fractions (+5% -> 0.05; damage taken +5% means the champion takes 5% more); ability haste in
points. Champions with no change aren't listed.
"""
import datetime, json, os, re, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = {"aram": "https://wiki.leagueoflegends.com/en-us/ARAM", "mayhem": "https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem"}
STATS = {"damage dealt": "damage_dealt", "damage received": "damage_taken", "healing done": "healing",
         "shielding done": "shielding", "tenacity": "tenacity", "ability haste": "ability_haste",
         "total attack speed": "attack_speed", "energy regeneration": "energy_regen"}
NUM = r"([-+]?\d+(?:\.\d+)?)(%?)"


def fetch(url):
    req = urllib.request.Request("https://r.jina.ai/" + url, headers={"User-Agent": "deeparam-champions"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read().decode("utf-8")


def value(num, pct):
    return round(float(num) / 100, 4) if pct else float(num)


def parse(page):
    """{champion name: (general-changes cell text)} from the page's champion table rows."""
    rows = {}
    for line in page.splitlines():
        m = re.match(r"\|\s*(?:\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\))?\[([^\]]+)\]\([^)]*\)\s*\|([^|]*)\|", line)
        if m and "Special modifiers" in m.group(2):
            rows[m.group(1).strip()] = m.group(2)
    return rows


def main():
    today = datetime.date.today().isoformat()
    aram_rows, mayhem_rows = parse(fetch(PAGES["aram"])), parse(fetch(PAGES["mayhem"]))
    tags = json.load(open(os.path.join(HERE, "tags.json")))["champions"]
    by_name = {t["name"]: alias for alias, t in tags.items()}
    out, unknown, mismatched = {}, [], []
    for name in sorted(set(aram_rows) | set(mayhem_rows)):
        alias = by_name.get(name)
        if not alias:
            unknown.append(name)
            continue
        aram = {}
        for stat, verb, num, pct in re.findall(r"\*\s*([A-Za-z ]+?) (increased|reduced) by " + NUM, aram_rows.get(name, "")):
            if stat.lower() in STATS:
                aram[STATS[stat.lower()]] = value(num, pct) * (1 if verb == "increased" else -1)
        mayhem = dict(aram)
        for stat, to, tp, frm, fp in re.findall(r"\*\s*([A-Za-z ]+?) changed to " + NUM + " from " + NUM, mayhem_rows.get(name, "")):
            key = STATS.get(stat.lower())
            if not key:
                continue
            if abs(aram.get(key, 0) - value(frm, fp)) > 1e-9:
                mismatched.append(f"{name} {key}: ARAM page {aram.get(key, 0)}, Mayhem page says from {value(frm, fp)}")
            mayhem[key] = value(to, tp)
        mayhem = {k: v for k, v in mayhem.items() if v}
        if aram or mayhem:
            entry = {"aram": aram, "mayhem": mayhem,
                     "source": PAGES["mayhem"] if name in mayhem_rows else PAGES["aram"]}
            out[alias] = entry
    # the two pages aren't always in sync; the Mayhem page's own value wins for Mayhem, and the gaps are kept here
    data = {"read": today, "pages": PAGES, "mismatches": mismatched, "champions": out}
    with open(os.path.join(os.path.dirname(HERE), "data", "wiki", "mayhem_modifiers.json"), "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    # the champion pages only need the Mayhem values; no header comment, since pages don't name data sources
    with open(os.path.join(HERE, "modifiers.js"), "w") as f:
        f.write("window.CHAMPS_MODIFIERS = " + json.dumps({a: e["mayhem"] for a, e in out.items() if e["mayhem"]},
                                                         separators=(",", ":")) + ";\n")
    print(f"{len(out)} champions with modifiers ({sum(1 for e in out.values() if e['mayhem'])} in Mayhem); "
          f"unknown names {unknown}; {len(mismatched)} ARAM mismatches")
    for m in mismatched:
        print("  ", m)


if __name__ == "__main__":
    main()
