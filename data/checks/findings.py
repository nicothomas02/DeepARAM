#!/usr/bin/env python3
"""Bug finder and Traps for The Kitchen (/kitchen?tab=traps and ?tab=bug-finder).

Looks for builds that work on paper but may not work in the game, from four checks:

  loops   Stat loops. Some augments turn one stat into another (Tickle Monster: Attack Damage into Attack
          Speed) and some champions do too (Jhin's Whisper: Attack Speed into Attack Damage). When a chain of
          them comes back to the stat it started from, each one raises the other on paper without end. The
          game usually stops that somewhere, but not always, so each loop a champion can actually be offered
          goes to the Bug finder to test in game. Only augments seen on that champion count.
  pool    Kitchen builds (Chef Specials and the Kitchen's own builds) that use an augment the champion has
          never been seen taking, or one that isn't in Mayhem on this patch. These go to "kitchen" in the
          output, not to the site's lists.
  sim     Items the Simulator puts in a champion's best build while real builds with that item win clearly
          less than builds without it. The Simulator is right about the numbers it models, so a gap like this
          means something the fight model leaves out (positioning, team role, timing) matters more.
  gap     Augments nearly every champion gets (GAP_SHARE of them) that a popular champion has never been seen
          taking. Riot leaves some out on purpose; the rest are worth reporting.
  wasted  Augments a champion can be offered that can't do anything for their kit (a Mana augment on a
          champion without Mana). None on the live patch; it stays as a check for future patches.

data/checks/curated.json holds what happened when a finding was tried in game: 'trap' moves it to Traps,
'bug' keeps it in the Bug finder as confirmed (worth reporting), 'fine' hides it.

Writes data/checks/findings.json. Run from the repo root:
    python3 data/checks/findings.py
"""

import json
import os
from datetime import datetime, timezone
from itertools import product
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIM = ROOT / "simulator" / "data"
OUT = ROOT / "data" / "checks" / "findings.json"
CURATED = ROOT / "data" / "checks" / "curated.json"

STATS = {
    "ad": "Attack Damage",
    "ap": "Ability Power",
    "as": "Attack Speed",
    "ah": "Ability Haste",
    "ms": "Move Speed",
    "hp": "Health",
    "mana": "Mana",
    "crit": "Critical Strike Chance",
    "lethality": "Lethality",
}

# Augment effect keys (simulator/data/augments.json) that turn one stat into another: key -> (from, to).
CONVERSIONS = {
    "ad_to_ap": ("ad", "ap"),
    "ap_to_ad": ("ap", "ad"),
    "ad_to_as": ("ad", "as"),
    "as_to_crit": ("as", "crit"),
    "as_to_ah": ("as", "ah"),
    "ms_to_as": ("ms", "as"),
    "mana_to_ap": ("mana", "ap"),
    "mana_to_hp": ("mana", "hp"),
    "hp_to_lethality": ("hp", "lethality"),
    "ah_per_ap": ("ap", "ah"),
    "as_per_ap": ("ap", "as"),
    "crit_per_ap": ("ap", "crit"),
    "ap_per_bonus_hp": ("hp", "ap"),
    "ms_per_ah": ("ah", "ms"),
}

# Champions whose own kit turns one stat into another, with the ability that does it. Jhin's come from
# simulator/data/kit_passives.json (whisper_as, whisper_crit); the rest are from the champion's tooltip.
KIT = {
    "Jhin": [("as", "ad", "Whisper"), ("crit", "ad", "Whisper")],
    "Vladimir": [("hp", "ap", "Crimson Pact"), ("ap", "hp", "Crimson Pact")],
}

# Augments that need the champion's own Mana. No Mana, No Problem (mana_to_ap) is left out: it converts the Mana
# on items, so it's made for champions without Mana.
MANA_KEYS = ("mana_to_hp", "onhit_mana", "trig_max_mana", "overflow_amp_per_mana")

# Simulator vs real games: an item counts when builds with it win at least this much less than builds
# without it, and both sides hold at least MIN_SHARE of the champion's listed full builds.
SIM_GAP = 0.03
MIN_SHARE = 0.03
MIN_CHAMP_PICK = 0.02
# Pool gaps: an augment counts as common when this share of champions have been seen taking it, and a gap
# only when the champion is picked often enough that never seeing it means something.
GAP_SHARE = 0.9
GAP_CHAMP_PICK = 0.05
LOOP_MAX_EDGES = 4
LOOP_MAX_AUGS = 4


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def data():
    """Everything the checks read, in one place so tests can swap it."""
    cn = ROOT / "data" / "cn"
    builds = {}
    for p in sorted((cn / "builds").glob("*.json")):
        b = load(p)
        builds[p.stem] = b
    kitchen = []
    cook = ROOT / "data" / "cook-builds"
    if (cook / "builds.json").exists():
        kitchen += [dict(b, source="kitchen") for b in load(cook / "builds.json")["builds"]]
    if (cook / "chefs-special.json").exists():
        cs = load(cook / "chefs-special.json")
        for b in cs if isinstance(cs, list) else [cs]:
            kitchen.append(dict(b, source="chef"))
    best = ROOT / "simulator" / "viewer" / "replay-data" / "best-builds.json"
    augments = load(SIM / "augments.json")["augments"]
    # Each champion's pool is every augment seen taken on them, read fresh from the per-champion stats (the
    # Simulator's own copy in augment_pools.json is only rebuilt with the Simulator).
    key_of = {a["id"]: k for k, a in augments.items()}
    pools = load(SIM / "augment_pools.json")["pools"]
    for cid, b in builds.items():
        if "augments" in b:
            seen = {x["id"] for tier in b["augments"].values() for x in tier}
            pools[cid] = sorted(key_of[i] for i in seen if i in key_of)
    return {
        "augments": augments,
        "pools": pools,
        "champions": load(SIM / "champions.json")["champions"],
        "items": load(SIM / "items.json")["items"],
        "best": load(best)["champions"] if best.exists() else [],
        "real": {str(c["champion_id"]): c for c in load(cn / "champions.json")["champions"]},
        "builds": builds,
        "kitchen": kitchen,
        # Augments the per-champion stats have nothing on this patch: not seeing them proves nothing.
        "no_data": {a["augment_id"] for a in load(cn / "augments.json").get("no_data", [])} if (cn / "augments.json").exists() else set(),
        "patch": (SIM / "tuned_patch.txt").read_text().strip() if (SIM / "tuned_patch.txt").exists() else "",
    }


def edges_of(aug):
    e = {**aug.get("stats", {}), **aug.get("effects", {})}
    return [CONVERSIONS[k] for k in e if k in CONVERSIONS and e[k]]


def cycles(graph):
    """Simple cycles (as edge lists) in a small directed graph {node: {next nodes}}, each found once."""
    found = []
    nodes = sorted(graph)
    for start in nodes:
        stack = [(start, [start])]
        while stack:
            node, path = stack.pop()
            for nxt in sorted(graph.get(node, ())):
                if nxt == start and len(path) >= 2:
                    found.append(list(zip(path, path[1:] + [start])))
                elif nxt not in path and nxt > start and len(path) < LOOP_MAX_EDGES:
                    stack.append((nxt, path + [nxt]))
    return found


def chain_text(steps, names):
    """'Tickle Monster turns Attack Damage into Attack Speed, and Jhin's Whisper turns Attack Speed into Attack Damage'."""
    parts = []
    for (src, dst), (kind, who, champ) in steps:
        by = names.get(who, who) if kind == "aug" else f"{champ}'s {who}"
        parts.append(f"{by} turns {STATS[src]} into {STATS[dst]}")
    return ", ".join(parts[:-1]) + (", and " if len(parts) > 1 else "") + parts[-1]


def find_loops(d):
    names = {k: a["name"] for k, a in d["augments"].items()}
    convert = {k: edges_of(a) for k, a in d["augments"].items()}
    convert = {k: v for k, v in convert.items() if v}
    groups = {}
    for champ in d["champions"]:
        pool = set(d["pools"].get(str(champ["champion_id"]), []))
        providers = {}
        for k, es in convert.items():
            if k in pool:
                for e in es:
                    providers.setdefault(e, []).append(("aug", k, None))
        for src, dst, ability in KIT.get(champ["id"], []):
            providers.setdefault((src, dst), []).append(("kit", ability, champ["name"]))
        graph = {}
        for src, dst in providers:
            graph.setdefault(src, set()).add(dst)
        for cyc in cycles(graph):
            for pick in product(*(providers[e] for e in cyc)):
                augs = sorted({p[1] for p in pick if p[0] == "aug"})
                kit = any(p[0] == "kit" for p in pick)
                if not augs or len(augs) > LOOP_MAX_AUGS or len(augs) != sum(p[0] == "aug" for p in pick):
                    continue
                key = (tuple(augs), champ["id"] if kit else None)
                g = groups.setdefault(key, {"steps": list(zip(cyc, pick)), "champions": []})
                if champ["id"] not in g["champions"]:
                    g["champions"].append(champ["id"])
    out = []
    for (augs, kit_champ), g in sorted(groups.items()):
        fid = "loop-" + "+".join(augs) + (f"-{kit_champ}" if kit_champ else "")
        names_list = [names[a] for a in augs]
        start = STATS[g["steps"][0][0][0]]
        champ_name = next((c["name"] for c in d["champions"] if c["id"] == kit_champ), kit_champ)
        out.append({
            "id": fid,
            "kind": "loop",
            "title": " + ".join(names_list) + (f" on {champ_name}" if kit_champ else ""),
            "champions": sorted(g["champions"]),
            "augments": [d["augments"][a]["id"] for a in augs],
            "items": [],
            "theory": chain_text(g["steps"], names) + f". On paper each one keeps raising the other, so {start} grows without end.",
            "test": f"Take {' and '.join(names_list)}{' on ' + champ_name if kit_champ else ''}, then open your stats after each item. "
                    f"If {start} keeps climbing on its own, it's a bug worth reporting. If it settles after one step, it's a trap.",
        })
    return out


def augment_key(d, name):
    want = name.strip().lower()
    for k, a in d["augments"].items():
        if a["name"].lower() == want or k == want:
            return k
    return None


def champion_of(d, name):
    want = name.strip().lower().replace(" ", "").replace("'", "").replace(".", "")
    for c in d["champions"]:
        if c["id"].lower() == want or c["name"].lower().replace(" ", "").replace("'", "").replace(".", "") == want:
            return c
    return None


def check_pool(d, champion, augment_names):
    """Problems with a champion + augments combination: [(augment name, 'gone' | 'range' | 'unseen' | 'no_data')]."""
    c = champion_of(d, champion)
    pool = set(d["pools"].get(str(c["champion_id"]), [])) if c else set()
    out = []
    for n in augment_names:
        n = n["name"] if isinstance(n, dict) else n
        k = augment_key(d, n)
        if not k:
            out.append((n, "gone"))
        elif d["augments"][k]["id"] in d.get("no_data", ()):
            out.append((n, "no_data"))
        elif c and pool and k not in pool:
            out.append((n, "range" if range_locked(d, k, c["ranged"]) else "unseen"))
    return out


def range_locked(d, key, ranged):
    """True when an augment is almost never seen on champions with this champion's attack range type (Skilled
    Sniper on a melee champion): it's very likely ranged-only or melee-only."""
    same = [c for c in d["champions"] if c["ranged"] == ranged and str(c["champion_id"]) in d["pools"]]
    other = [c for c in d["champions"] if c["ranged"] != ranged and str(c["champion_id"]) in d["pools"]]
    rate = lambda cs: sum(key in d["pools"][str(c["champion_id"])] for c in cs) / max(len(cs), 1)  # noqa: E731
    return rate(same) <= 0.05 and rate(other) >= 0.25


def find_pool(d):
    out = []
    for b in d["kitchen"]:
        champ = champion_of(d, b.get("champion_name") or b["champion"])
        if not champ:
            continue
        for name, why in check_pool(d, champ["id"], b.get("augments", [])):
            k = augment_key(d, name)
            out.append({
                "id": f"pool-{b['id']}-{k or name.lower().replace(' ', '_')}",
                "kind": "pool",
                "title": f"{b.get('title', b['id'])}: {name} on {champ['name']}",
                "champions": [champ["id"]],
                "augments": [d["augments"][k]["id"]] if k else [],
                "items": [],
                "theory": f"The build leans on {name}.",
                "test": (f"{name} isn't in Mayhem on this patch." if why == "gone"
                         else f"There are no stats on {name} yet this patch. Check that {champ['name']} can still be offered it." if why == "no_data"
                         else f"{name} is only seen on {'melee' if champ['ranged'] else 'ranged'} champions, so {champ['name']} can't be offered it. " if why == "range"
                         else f"{champ['name']} has never been seen taking {name}, so it may not be in their augment pool. "
                              f"Check whether it's ever offered on {champ['name']}."),
                "build": b["id"],
                # For the Kitchen's own build cards (web/src/app/data/kitchen-checks.json): which augment, and why.
                "augment": name,
                "why": why,
            })
    return out


def find_sim_gaps(d):
    items = d["items"]
    out = []
    for c in d["best"]:
        champ = champion_of(d, c["champion"])
        if not champ:
            continue
        cid = str(champ["champion_id"])
        full = d["builds"].get(cid, {}).get("items", {}).get("full_builds", [])
        if len(full) < 4 or d["real"].get(cid, {}).get("pick_rate", 0) < MIN_CHAMP_PICK:
            continue
        for key in c["build"]["items"]:
            iid = items.get(key, {}).get("id")
            if iid is None:
                continue
            w = [b for b in full if iid in b["items"]]
            wo = [b for b in full if iid not in b["items"]]
            pw, po = sum(b["pick_rate"] for b in w), sum(b["pick_rate"] for b in wo)
            if pw < MIN_SHARE or po < MIN_SHARE:
                continue
            gap = sum(b["pick_rate"] * b["win_rate"] for b in w) / pw - sum(b["pick_rate"] * b["win_rate"] for b in wo) / po
            if gap > -SIM_GAP:
                continue
            name = items[key].get("name", key)
            out.append({
                "id": f"sim-{champ['id']}-{key}",
                "kind": "sim",
                "title": f"{name} on {champ['name']}",
                "champions": [champ["id"]],
                "augments": [],
                "items": [iid],
                "theory": f"The Simulator puts {name} in {champ['name']}'s best build: in a fight it adds more than the items it beats.",
                "practice": f"In real games, {champ['name']}'s builds with {name} win {abs(gap) * 100:.1f} points less often than their builds without it.",
                "gap": round(gap, 4),
                "share": round(pw, 4),
            })
    out.sort(key=lambda f: f["gap"])
    return out


def find_gaps(d):
    n = len(d["pools"])
    if not n:
        return []
    count = {}
    for pool in d["pools"].values():
        for a in pool:
            count[a] = count.get(a, 0) + 1
    common = [a for a, c in count.items() if c / n >= GAP_SHARE]
    out = []
    for c in d["champions"]:
        cid = str(c["champion_id"])
        pool = d["pools"].get(cid)
        if not pool or d["real"].get(cid, {}).get("pick_rate", 0) < GAP_CHAMP_PICK:
            continue
        missing = sorted((a for a in common if a not in pool), key=lambda a: -count[a])
        if not missing:
            continue
        names = [d["augments"][a]["name"] for a in missing]
        share = min(count[a] for a in missing) / n
        out.append({
            "id": f"gap-{c['id']}",
            "kind": "gap",
            "title": f"{c['name']} never gets {names[0]}" + (f" and {len(names) - 1} more" if len(names) > 1 else ""),
            "champions": [c["id"]],
            "augments": [d["augments"][a]["id"] for a in missing],
            "items": [],
            "theory": f"At least {int(share * 100)}% of champions get {', '.join(names[:-1]) + ' and ' + names[-1] if len(names) > 1 else names[0]}, "
                      f"but {c['name']} has never been seen taking {'them' if len(names) > 1 else 'it'}, even though {c['name']} is picked often.",
            "test": f"Play {c['name']} and watch your augment choices. If {'they' if len(names) > 1 else 'it'} never show{'' if len(names) > 1 else 's'} up, "
                    f"Riot has left {'them' if len(names) > 1 else 'it'} out for {c['name']}. If that doesn't look like it's on purpose, it's worth reporting.",
        })
    return out


def find_wasted(d):
    out = []
    for c in d["champions"]:
        if c.get("resource", {}).get("kind") == "mana":
            continue
        for k in d["pools"].get(str(c["champion_id"]), []):
            a = d["augments"].get(k)
            e = {**a.get("stats", {}), **a.get("effects", {})} if a else {}
            if any(m in e for m in MANA_KEYS):
                out.append({
                    "id": f"wasted-{k}-{c['id']}",
                    "kind": "wasted",
                    "title": f"{a['name']} on {c['name']}",
                    "champions": [c["id"]],
                    "augments": [a["id"]],
                    "items": [],
                    "theory": f"{a['name']} scales with Mana, and {c['name']} has none.",
                    "test": f"Check whether {c['name']} can be offered {a['name']} and whether it does anything. If it does nothing, it's a bug worth reporting.",
                })
    return out


def build(d=None, curated=None):
    d = d or data()
    curated = curated if curated is not None else (load(CURATED)["entries"] if CURATED.exists() else [])
    by_id = {e["id"]: e for e in curated}
    # Kitchen builds that may not be possible stay off the public lists: they're for whoever writes the next
    # Chef Special (data/checks/check_build.py) and for fixing old ones.
    kitchen = list({f["id"]: f for f in find_pool(d)}.values())
    found = {"loops": find_loops(d), "gap": find_gaps(d), "sim": find_sim_gaps(d), "wasted": find_wasted(d)}
    traps, bugs = [], []
    for kind, fs in found.items():
        for f in fs:
            cur = by_id.get(f["id"], {})
            status = cur.get("status")
            if cur.get("practice"):
                f["practice"] = cur["practice"]
            if status == "fine":
                continue
            if status == "trap" or (kind == "sim" and status != "bug"):
                f["status"] = "trap"
                traps.append(f)
            else:
                f["status"] = "confirmed" if status == "bug" else "to_test"
                bugs.append(f)
    for e in curated:
        if e.get("manual"):
            f = {k: v for k, v in e.items() if k != "manual"}
            (traps if e.get("status") == "trap" else bugs).append(f)
    order = {"confirmed": 0, "to_test": 1, "trap": 2}
    kinds = {"loop": 0, "wasted": 1, "gap": 2}
    bugs.sort(key=lambda f: (order.get(f.get("status"), 3), kinds.get(f["kind"], 4), f["title"]))
    traps.sort(key=lambda f: (f["kind"] == "sim", f["title"]))
    return {
        "patch": d["patch"],
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "checks": {**{k: len(v) for k, v in found.items()}, "kitchen": len(kitchen)},
        "traps": traps,
        "bugs": bugs,
        "kitchen": kitchen,
    }


def main():
    out = build()
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(out['traps'])} traps, {len(out['bugs'])} in the bug finder, {len(out['kitchen'])} Kitchen build problems")


if __name__ == "__main__":
    main()
