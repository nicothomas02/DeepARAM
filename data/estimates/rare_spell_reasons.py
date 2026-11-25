"""Why a rare summoner spell pair leads a champion's card (Nico 2026-11-25: "work on analyzing each individual case so
it's not generic advice for everything").

The site's lead rule (web/src/lib/card-score.ts) can put a pair without Flash on top of a champion's spells even when
under a quarter as many players take it as the top pair (the "Few players" tag). For each champion where that happens,
this file holds one reason worked out from the champion's kit (Data Dragon ability text, cited per row) and checks it
against AramHex's real games:

  edge     = the pair's win rate minus the champion's win rate over all its pairs, pooled over the patches below.
  holds    = the edge is above zero on every patch with 500+ games of the pair and above 2 SE pooled, and 1+ pt.
  tie      = it holds but is under 1 pt: about even with the usual Flash pair, so the line says so.
  mixed    = the sign flips between patches or the edge is within 2 SE: no kit reason is shown, only a generic line,
             and the row is flagged.

Kit reasons are the likely why, not a measured cause: the pair is rare, so part of its edge may be who picks it. The
hover says so. Output: rare_spell_reasons.json, read by the champion page (FewPlayers on the spell pair) and the apps
(hover or post-game only, never in-game text).

    python3 data/estimates/rare_spell_reasons.py
"""

import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATCHES = ["16.21", "16.22", "16.23"]
FLASH, GHOST, HEAL, BARRIER, IGNITE, MARK = 4, 6, 7, 21, 14, 32

# Kit templates (web/src/components/champion/FewPlayers.tsx holds the same English text; translations in
# web/public/i18n/champions). {name} = champion, {key} = ability key.
#   escape  - the kit already has a dash, blink or flight that does much of Flash's job.
#   nodash  - no escape dash: Ghost is the way to keep distance while still hitting.
#   reach   - a fighter with no dash: Ghost is how it reaches targets.
#   stick   - no long dash: Ghost keeps it on targets, Mark starts fights.
#   warpath - Hecarim: bonus move speed becomes AD.
#   engage  - the kit already moves it onto targets: Flash adds less than Ignite and Mark.
#   barrels - Gangplank: Ghost and Heal's speed move him between barrels and out of fights.
# Each row: champion -> (spell ids of the leading pair, template, ability key, the ability as Data Dragon names it).
KIT = {
    # Ghost + Barrier
    "Ahri": ((GHOST, BARRIER), "escape", "R", "Spirit Rush: dashes forward, up to three casts"),
    "Ezreal": ((GHOST, BARRIER), "escape", "E", "Arcane Shift: teleports to a nearby location"),
    "Tristana": ((GHOST, BARRIER), "escape", "W", "Rocket Jump: propels her to a distant location"),
    "Caitlyn": ((GHOST, BARRIER), "escape", "E", "90 Caliber Net: the recoil knocks Caitlyn back"),
    "MasterYi": ((GHOST, BARRIER), "escape", "Q", "Alpha Strike: teleports across the battlefield, untargetable"),
    "AurelionSol": ((GHOST, BARRIER), "escape", "W", "Astral Flight: flies over terrain in a targeted direction"),
    "Smolder": ((GHOST, BARRIER), "escape", "E", "Flap, Flap, Flap: takes flight ignoring terrain"),
    "Ziggs": ((GHOST, BARRIER), "escape", "W", "Satchel Charge: Ziggs is also knocked away, takes no damage"),
    "Yunara": ((GHOST, BARRIER), "escape", "E", "Kanmei's Steps: Move Speed and Ghosted; a dash in her R state"),
    "Ashe": ((GHOST, BARRIER), "nodash", "", "no dash or blink in Q/W/E/R"),
    "Jhin": ((GHOST, BARRIER), "nodash", "", "no dash or blink in Q/W/E/R"),
    "Jinx": ((GHOST, BARRIER), "nodash", "", "no dash or blink in Q/W/E/R"),
    "MissFortune": ((GHOST, BARRIER), "nodash", "", "no dash or blink in Q/W/E/R"),
    "Xayah": ((GHOST, BARRIER), "nodash", "", "R Featherstorm is untargetable in place, no dash"),
    "Brand": ((GHOST, BARRIER), "nodash", "", "no dash or blink in Q/W/E/R"),
    "Viktor": ((GHOST, BARRIER), "nodash", "", "no dash or blink in Q/W/E/R"),
    "Syndra": ((GHOST, BARRIER), "nodash", "", "no dash or blink in Q/W/E/R"),
    "Karthus": ((GHOST, BARRIER), "nodash", "", "no dash or blink in Q/W/E/R"),
    "Teemo": ((GHOST, BARRIER), "nodash", "", "no dash or blink; W Move Quick is speed only"),
    "TwistedFate": ((GHOST, BARRIER), "nodash", "", "R Gate teleports after 1.5 s, no instant escape"),
    "Ryze": ((GHOST, BARRIER), "nodash", "", "R Realm Warp teleports after a few seconds, no instant escape"),
    "Jayce": ((GHOST, BARRIER), "nodash", "", "hammer Q leaps onto an enemy only, no escape dash"),
    "Mordekaiser": ((GHOST, BARRIER), "reach", "", "no dash; E Death's Grasp pulls enemies in"),
    # Ghost + Mark
    "Hecarim": ((GHOST, MARK), "warpath", "", "Warpath: AD equal to a percentage of his bonus Move Speed"),
    "Gwen": ((GHOST, MARK), "stick", "", "E Skip 'n Slash: dashes a short distance"),
    "Illaoi": ((GHOST, MARK), "stick", "", "W Harsh Lesson: leaps to her target from attack range"),
    "Yorick": ((GHOST, MARK), "stick", "", "no dash in Q/W/E/R"),
    "Darius": ((GHOST, MARK), "stick", "", "R leaps to an enemy; E pulls; no escape dash"),
    "Chogath": ((GHOST, MARK), "stick", "", "no dash in Q/W/E/R"),
    "Singed": ((GHOST, MARK), "stick", "", "no dash; Q Poison Trail is laid while moving"),
    # Ignite + Mark
    "Amumu": ((IGNITE, MARK), "engage", "Q", "Bandage Toss: pulls himself to the target"),
    "Shaco": ((IGNITE, MARK), "engage", "Q", "Deceive: becomes Invisible and teleports to target location"),
    # Ghost + Heal
    "Gangplank": ((GHOST, HEAL), "barrels", "", "no dash; E Powder Keg barrels are placed and shot"),
    # Leading rare pairs with no kit reason written: their edge swings between patches (checked 2026-11-25), so only
    # the generic line shows. Rows stay here so a later data run can promote them.
    "Belveth": ((GHOST, MARK), None, "", ""),
    "Gnar": ((GHOST, MARK), None, "", ""),
    "KSante": ((GHOST, MARK), None, "", ""),
    "Ornn": ((GHOST, MARK), None, "", ""),
    "Taric": ((GHOST, MARK), None, "", ""),
    "Urgot": ((GHOST, MARK), None, "", ""),
    "Vladimir": ((GHOST, MARK), None, "", ""),
    "Zac": ((GHOST, MARK), None, "", ""),
    "Morgana": ((GHOST, BARRIER), None, "", ""),
    "Sion": ((IGNITE, MARK), None, "", ""),
    "Zed": ((GHOST, HEAL), None, "", ""),
}


def load(patch):
    path = os.path.join(ROOT, "data/aramhex/patches", patch, "spells.json")
    return json.load(open(path)) if os.path.exists(path) else {}


def edge(cid, ids):
    """Per patch and pooled: the pair's win rate minus the champion's over all its pairs (points)."""
    key = "+".join(str(i) for i in sorted(ids))
    per, g_all, num, var = [], 0, 0.0, 0.0
    for p in PATCHES:
        pairs = load(p).get(cid)
        if not pairs or key not in pairs:
            continue
        G = sum(v[0] for v in pairs.values())
        W = sum(v[1] for v in pairs.values())
        g, w = pairs[key]
        if not g:
            continue
        r = w / g
        e = r - W / G
        per.append({"patch": p, "games": g, "edge": round(e * 100, 1)})
        g_all += g
        num += e * g
        var += (r * (1 - r) / g) * g * g
    if not g_all:
        return per, None, None
    return per, num / g_all * 100, math.sqrt(var) / g_all * 100


def pick_share(cid, ids):
    """Share of the champion's games with this pair on the newest patch that has it (the apps show it as {pct})."""
    key = "+".join(str(i) for i in sorted(ids))
    for p in reversed(PATCHES):
        pairs = load(p).get(cid)
        if pairs and key in pairs:
            return round(pairs[key][0] / sum(v[0] for v in pairs.values()), 5)
    return None


def usual_flash(cid):
    """The champion's most played pair with Flash over the patches, as spell ids."""
    games = {}
    for p in PATCHES:
        for k, (g, _) in load(p).get(cid, {}).items():
            games[k] = games.get(k, 0) + g
    best = max((k for k in games if str(FLASH) in k.split("+")), key=lambda k: games[k], default=None)
    return [int(x) for x in best.split("+")] if best else None


def verdict(per, e, se):
    big = [x["edge"] for x in per if x["games"] >= 500]
    if e is None or (any(x < 0 for x in big) and any(x > 0 for x in big)) or any(x < 0 for x in big) or e <= 2 * se:
        return "mixed"
    return "tie" if e < 1 else "holds"


def main():
    ids = json.load(open(os.path.join(ROOT, "web/src/data/champion-ids.json")))
    out = {}
    for alias, (pair, template, key, kit) in sorted(KIT.items()):
        per, e, se = edge(str(ids[alias]), pair)
        v = verdict(per, e, se)
        out[alias] = {
            "spells": list(pair),
            "verdict": v,
            # A mixed row shows the generic line only (no kit reason): flagged for review.
            "template": template if v == "holds" else None,
            "key": key,
            # The keyed ability's English name (the site shows its localized name next to the key).
            "ability": kit.split(":")[0] if key else "",
            "kit": kit,
            "edge": round(e, 1) if e is not None else None,
            "se": round(se, 1) if se is not None else None,
            "patches": per,
            "usual": usual_flash(str(ids[alias])),
            "pick": pick_share(str(ids[alias]), pair),
        }
    meta = {
        "source": "AramHex real games, all MMR bands, " + ", ".join(PATCHES),
        "edge": "pair win rate minus the champion's win rate over all its pairs, points, pooled",
        "rule": "holds: above 0 on every patch with 500+ games and above 2 SE, 1+ pt; tie: holds under 1 pt; mixed: otherwise (generic line, flagged)",
        "estimated": "kit reasons are the likely why, not a measured cause",
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rare_spell_reasons.json")
    with open(path, "w") as f:
        json.dump({"meta": meta, "champions": out}, f, indent=1)
        f.write("\n")
    for a, r in out.items():
        print(f"{a:12} {r['verdict']:6} {r['edge']:+.1f}±{r['se']} {r['template']}")


if __name__ == "__main__":
    main()
