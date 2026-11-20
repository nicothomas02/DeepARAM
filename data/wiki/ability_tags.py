#!/usr/bin/env python3
"""Each champion ability tagged with the League wiki's own game terms, for Chef Special design and the combo scan.

The wiki's ability data (Template:Data <Champion>/<Ability>) marks mechanics with {{tip|...}} keywords that follow
the game's internal coding: dash vs blink, channel, airborne (knock up / knock back), stun, root, on-hit, basic
attack reset, and so on, plus fields such as projectile, spell effects and grounded. Matching augments to kits by
these tags is far more reliable than keyword guessing on tooltip text. Writes data/wiki/ability_tags.json:

    {"Vayne": {"Q": {"name": "Tumble", "tips": ["basic attack", "dash", ...], "projectile": "", ...}, ...}, ...}

    python3 data/wiki/ability_tags.py
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://wiki.leagueoflegends.com/en-us/api.php"
OUT = Path(__file__).with_name("ability_tags.json")
CD = Path(__file__).resolve().parents[2] / "web/public/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1"
SLOTS = ["I", "Q", "W", "E", "R"]  # I = innate (passive)
FIELDS = ["targeting", "affects", "damagetype", "projectile", "spelleffects", "spellshield", "grounded",
          "knockdown", "cdstart", "cast time", "cooldown"]
TEXT_FIELDS = re.compile(r"^\|(blurb\d*|description\d*|notes)\s*=", re.M)


PLURAL = {"dashes": "dash", "dashing": "dash", "blinks": "blink", "blinking": "blink", "slows": "slow",
          "stuns": "stun", "roots": "root", "heals": "heal", "healing": "heal", "shields": "shield",
          "champions": "champion", "minions": "minion", "monsters": "monster", "turrets": "turret",
          "stacks": "stack", "critically strike": "critical strike", "basic attacks": "basic attack",
          "knocks up": "airborne", "knock up": "airborne", "knocked up": "airborne", "knock back": "airborne",
          "knocks back": "airborne", "knockback": "airborne", "abilities": "ability", "channeling": "channel",
          "channels": "channel", "channeled": "channel", "clones": "clone"}

# wiki keyword -> trigger tag the combo scan and augments use (immobilize = what Mayhem augments call an
# immobilize: stun, root, snare, suppression, sleep; airborne is its own tag. Charm, taunt, fear and flee are
# forced action, and polymorph is not an immobilize (Nico 2026-11-20))
TAGS = {"dash": "dash", "blink": "blink", "channel": "channel", "airborne": "airborne", "stun": "immobilize",
        "root": "immobilize", "snare": "immobilize", "suppression": "immobilize", "sleep": "immobilize",
        "charm": "forced action", "taunt": "forced action", "fear": "forced action", "flee": "forced action",
        "berserk": "forced action",
        "immobilize": "immobilize", "on-hit": "on-hit", "on-attack": "on-attack", "basic attack reset": "attack reset",
        "shield": "shield", "heal": "heal", "clone": "clone", "pet": "pet", "untargetable": "untargetable",
        "invisible": "stealth", "camouflage": "stealth", "slow": "slow", "ground": "ground", "grounded": "ground",
        "spellblade": "spellblade", "critical strike": "crit", "stack": "stack", "persistent damage": "dot",
        "damage over time": "dot", "proc damage": "proc", "area damage": "aoe", "resurrection": "revive",
        "zombie state": "zombie", "polymorph": "polymorph", "silence": "silence", "disarm": "disarm",
        "knockdown": "knockdown", "projectile": "projectile", "trap": "trap", "toggle": "toggle",
        "recast": "recast", "transform": "transform", "ally": "ally", "allies": "ally", "omnivamp": "heal",
        "life steal": "heal", "tether": "tether", "terrain": "terrain"}


def canon(t):
    t = t.strip().lower()
    return PLURAL.get(t, t)


def get(params):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": "deeparam-data/1.0"})
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"wiki request failed: {params.get('titles', '')[:80]}")


def champions():
    rows = json.loads((CD / "champion-summary.json").read_text(encoding="utf-8"))
    return sorted({r["name"] for r in rows if r.get("id", -1) > 0})


WIKI_NAME = {"Nunu & Willump": "Nunu"}  # champion name -> the wiki's page name when they differ


def parse(text):
    """Ability name, the set of {{tip|...}} keywords used in its text fields, and the data fields."""
    name = re.match(r"\{\{\{\{\{1[^}]*\}\}\}\|([^|]+)\|", text) or re.search(r"\}\}\}\|([^|{}\n]+)\|", text[:300])
    field = {}
    for f in FIELDS:
        m = re.search(r"^\|" + re.escape(f) + r"\s*=([^\n]*)", text, re.M)
        field[f] = m.group(1).strip() if m else ""
    # text fields run until the next |field= line. Tips in the descriptions describe what the ability does;
    # tips in the notes are often edge cases ("does not become invisible"), so they are kept apart.
    core, notes = [], []
    for m in TEXT_FIELDS.finditer(text):
        nxt = re.search(r"^\|[a-z ]+\d*\s*=", text[m.end():], re.M)
        part = text[m.end(): m.end() + (nxt.start() if nxt else len(text))]
        (notes if m.group(1) == "notes" else core).append(part)
    tips = sorted({canon(t) for t in re.findall(r"\{\{tip\|([^|}]+)", " ".join(core))})
    note_tips = sorted({canon(t) for t in re.findall(r"\{\{tip\|([^|}]+)", " ".join(notes))} - set(tips))
    return (name.group(1).strip() if name else ""), tips, note_tips, field


def all_data_pages(champs):
    """Every Template:Data <Champion>/<page> title, so alternate forms (Rek'Sai's Unburrow, Jayce's hammer and
    cannon, Nidalee's cougar) are found too, not only the Q/W/E/R/I redirects."""
    titles, cont = [], {}
    while True:
        res = get({"action": "query", "list": "allpages", "apprefix": "Data ", "apnamespace": 10,
                   "aplimit": 500, **cont})
        titles += [p["title"] for p in res["query"]["allpages"]]
        if "continue" not in res:
            break
        cont = {"apcontinue": res["continue"]["apcontinue"]}
        time.sleep(0.3)
    names = {WIKI_NAME.get(c, c): c for c in champs}
    out = {}
    for t in titles:
        m = re.match(r"Template:Data (.+?)/(.+)$", t)
        if m and m.group(1) in names and m.group(2) not in SLOTS:
            out.setdefault(names[m.group(1)], []).append(t)
    return out


def main():
    champs = champions()
    by_champ = all_data_pages(champs)
    titles = [t for ts in by_champ.values() for t in ts]
    pages = {}
    for i in range(0, len(titles), 50):
        res = get({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                   "titles": "|".join(titles[i:i + 50])})
        for p in res.get("query", {}).get("pages", {}).values():
            if p.get("revisions"):
                pages[p["title"]] = p["revisions"][0]["slots"]["main"]["*"]
        time.sleep(0.5)
    ids = {r["name"]: r["id"] for r in json.loads((CD / "champion-summary.json").read_text(encoding="utf-8"))
           if (CD / f"champions/{r['id']}.json").exists()}  # the summary also lists event variants (60266)
    out, missing = {}, []
    for c in champs:
        game = {}
        f = CD / f"champions/{ids.get(c, 0)}.json"
        if f.exists():
            j = json.loads(f.read_text(encoding="utf-8"))
            game = {s["spellKey"].upper(): s["name"] for s in j.get("spells", [])}
            game["I"] = j.get("passive", {}).get("name", "")
        kit = {}
        for t in by_champ.get(c, []):
            text = pages.get(t)
            m = re.search(r"^\|skill\s*=\s*([A-Za-z]+)", text or "", re.M)
            if not m:
                continue
            slot = {"P": "I", "INNATE": "I", "PASSIVE": "I"}.get(m.group(1).upper(), m.group(1).upper())
            if slot not in SLOTS:
                continue
            name, tips, note_tips, field = parse(text)
            name = t.split("/", 1)[1]
            a = kit.setdefault(slot, {"name": game.get(slot, "") or name, "forms": [], "tips": set(),
                                      "note_tips": set()})
            a["forms"].append(name)
            a["tips"] |= set(tips)
            a["note_tips"] |= set(note_tips)
            for k, v in field.items():
                if v and k not in a:
                    a[k] = v
        for slot, a in kit.items():
            a["note_tips"] = sorted(a["note_tips"] - a["tips"])
            a["tips"] = sorted(a["tips"])
            a["tags"] = sorted({TAGS[t] for t in a["tips"] if t in TAGS})
            a["forms"] = sorted(set(a["forms"]))
        missing += [f"{c} {sl}" for sl in SLOTS if sl not in kit]
        kit = {sl: kit[sl] for sl in SLOTS if sl in kit}
        out[c] = kit
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(out)} champions, {sum(len(k) for k in out.values())} abilities, missing {len(missing)}:",
          ", ".join(missing[:20]))


if __name__ == "__main__":
    main()
