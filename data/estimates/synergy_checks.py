"""Viability checks for hidden gems (synergies.py): is the choice possible in the game right now, and does the
Simulator agree it's at least close to the champion's usual one?

A hidden gem comes from real games, but a rare choice can still be a trap for the site: an item the shop no
longer sells, one only an augment hands out, an augment outside the champion's pool, or a win rate from a
handful of odd games that the mechanics don't back up. Each check either drops the gem (with the reason
counted in the output) or labels how far it was checked.

Items (starting items, boots, full builds):
- shop: every item still exists and Mayhem's shop sells it (web/src/data/item-groups.json, m == 1 and not
  e == 8 like web/src/lib/items.ts inMayhem); dropped otherwise.
- granted: no item that only an augment gives (guide/augment_rules.json grantedItems); dropped otherwise.
- Simulator (boots and full builds; starting items are bought at level 1, which a level 18 fight can't test):
  the gem build against the champion's most popular full build (for boots, that build with the gem's boots in
  its place), level 18 against real enemies, scored like champion_upgrades.py (damage plus role-weighted
  healing, shielding and crowd control per second alive, plus time alive). "agrees" unless the Simulator puts
  it more than 15% below the usual build ("disagrees", still listed: the wins are real, so it marks a blind
  spot of the fight model, such as full tank builds, or something to look at); "not simulated" when an item
  isn't modelled.

Augments:
- live: still in the live augment pool (guide/augment_rules.json tiers); dropped otherwise.
- pool: every listed augment was taken by real players on that champion (100+ estimated games), which shows
  it's in the champion's pool. (The Simulator's own pool list, simulator/data/augment_pools.json, lags new
  augments: in 16.22 it missed 43, e.g. Weapon of Destiny and Bees, for almost every champion.)
- Simulator: the champion's most popular full build with and without the augment; dropped when it makes the
  champion clearly worse (more than 2%: augment gems are estimates, with no real win rate behind them), "agrees" when it helps, "no gain" in between (utility the fight can't
  see), "not simulated" when the augment isn't modelled.

Needs simulator/mayhem_sim (`make -C simulator mayhem_sim`); without it only the game-data checks run and
every gem is "not simulated".
"""

import json
import math
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

import common as cm

SIM = os.path.join(cm.REPO, "simulator")
SIM_BIN = os.path.join(SIM, "mayhem_sim")
SETTINGS = "level=18,enemy_level=18"
TRIALS = 1500
SEED = 26
ITEM_FLOOR = math.log(0.85)  # gem build may be at most 15% below the usual build in the Simulator
AUGMENT_FLOOR = math.log(0.98)
# Per role: healing + shielding and crowd control worth (against damage at 1), and how much staying alive counts
# (the same weights as champion_upgrades.py).
ROLE_WEIGHTS = {
    "marksman": (0.25, 0.25, 0.25), "mage": (0.3, 0.4, 0.25), "assassin": (0.25, 0.25, 0.25),
    "fighter": (0.5, 0.5, 0.4), "tank": (0.8, 1.0, 0.6), "support": (1.0, 1.0, 0.5),
}


def value(s, role, ref_dps):
    wh, wc, _ = ROLE_WEIGHTS.get(role, (0.4, 0.4, 0.5))
    alive = max(s["time_alive"], 1.0)
    return s["mean_dps"] + (wh * (s["healing"] + s["shielding"]) + wc * ref_dps * s["cc_seconds"]) / alive


def gain(base, new, role):
    """log(value of new / base) plus time alive at the role's weight."""
    ref = max(base["mean_dps"], 1.0)
    b, n = value(base, role, ref), value(new, role, ref)
    ws = ROLE_WEIGHTS.get(role, (0.4, 0.4, 0.5))[2]
    return math.log(max(n, 1e-6) / max(b, 1e-6)) + ws * math.log(max(new["time_alive"], 0.1) / max(base["time_alive"], 0.1))


class Checker:
    def __init__(self, builds):
        self.builds = builds
        groups = cm.load(os.path.join(cm.REPO, "web", "src", "data", "item-groups.json"))
        client = cm.load(os.path.join(cm.REPO, "web", "public", "assets", "cd", "latest", "plugins",
                                      "rcp-be-lol-game-data", "global", "default", "v1", "items.json"))
        self.exists = {i["id"] for i in client}
        self.groups = {int(k): v for k, v in groups.items()}
        rules = cm.augment_rules()
        self.granted = {g["id"] for g in rules.get("grantedItems", [])}
        self.live_augments = {int(k) for k in rules.get("tiers", {})}
        sim_items = cm.load(os.path.join(SIM, "data", "items.json"))["items"]
        self.item_key = {v["id"]: k for k, v in sim_items.items() if v.get("id")}
        self.boots = {v["id"] for v in sim_items.values() if v.get("slot") == "boots"}
        sim_augs = cm.load(os.path.join(SIM, "data", "augments.json"))["augments"]
        self.aug_key = {v["id"]: k for k, v in sim_augs.items() if v.get("id")}
        self.modeled = {k for k, v in sim_augs.items() if v.get("stats") or v.get("effects")}
        self.sim = os.path.exists(SIM_BIN)
        self.champs = {}
        if self.sim:
            try:
                listing = json.loads(subprocess.run([SIM_BIN, "--list", "--json"], capture_output=True, text=True,
                                                    cwd=SIM, check=True).stdout)
                self.champs = {str(c["key"]): c for c in listing["champions"]}
            except Exception:
                self.sim = False
        self.cache = {}
        self.dropped = {}

    # --- game data ---

    def sold(self, item):
        g = self.groups.get(item)
        return item in self.exists and (g is None or (g.get("m") == 1 and g.get("e") != 8))

    def usual_build(self, champion):
        rows = (self.builds.get(str(champion)) or {}).get("items", {}).get("full_builds") or []
        return max(rows, key=lambda r: r["pick_rate"])["items"] if rows else None

    # --- simulator ---

    def run(self, champ, items, augs=()):
        key = (champ, tuple(items), tuple(augs))
        if key not in self.cache:
            cmd = [SIM_BIN, "--champ", champ, "--items", ",".join(items), "--set", SETTINGS, "--json",
                   "--trials", str(TRIALS), "--threads", "1", "--seed", str(SEED)]
            if augs:
                cmd += ["--augs", ",".join(augs)]
            r = subprocess.run(cmd, capture_output=True, text=True, cwd=SIM)
            if r.returncode:
                self.cache[key] = None
            else:
                s = json.loads(r.stdout)["builds"][0]["summary"]
                self.cache[key] = {k: s.get(k, 0) for k in ("mean_dps", "healing", "shielding", "cc_seconds", "time_alive")}
        return self.cache[key]

    def keys(self, items):
        ks = [self.item_key.get(i) for i in items]
        return None if any(k is None for k in ks) else ks

    def item_plan(self, family, gem):
        """(champion, usual keys, gem keys) to simulate, or None when the Simulator can't test this gem."""
        c = self.champs.get(str(gem["champion"]))
        usual = self.usual_build(gem["champion"])
        if not self.sim or not c or not usual or family not in ("boots", "full_builds"):
            return None
        if family == "boots":
            if len(gem["items"]) != 1:
                return None
            old = [i for i in usual if i in self.boots]
            if not old or old[0] == gem["items"][0]:
                return None
            new = [gem["items"][0] if i == old[0] else i for i in usual]
        else:
            new = gem["items"]
        a, b = self.keys(usual), self.keys(new)
        return (c["id"], c["role"], a, b) if a and b and a != b else None

    def augment_plan(self, gem):
        c = self.champs.get(str(gem["champion"]))
        key = self.aug_key.get(gem["id"])
        usual = self.usual_build(gem["champion"])
        # Real players took it on this champion, so it is in the champion's pool; the Simulator's own pool list
        # (simulator/data/augment_pools.json) lags new augments, and those it doesn't list aren't simulated.
        if not self.sim or not c or not key or key not in self.modeled or key not in c.get("augments", []) or not usual:
            return None
        items = self.keys(usual)
        return (c["id"], c["role"], items, key) if items else None

    # --- checks ---

    def drop(self, family, reason):
        self.dropped.setdefault(family, {}).setdefault(reason, 0)
        self.dropped[family][reason] += 1

    def items(self, family, gems, jobs=None):
        keep = []
        for g in gems:
            if not all(self.sold(i) for i in g["items"]):
                self.drop(family, "not sold in the shop")
            elif any(i in self.granted for i in g["items"]):
                self.drop(family, "item only an augment gives")
            else:
                keep.append(g)
        plans = [self.item_plan(family, g) for g in keep]
        todo = {(p[0], tuple(x)) for p in plans if p for x in (p[2], p[3])}
        with ThreadPoolExecutor(jobs or os.cpu_count() or 2) as ex:
            list(ex.map(lambda t: self.run(t[0], list(t[1])), todo))
        out = []
        for g, p in zip(keep, plans):
            if not p:
                g["sim"] = "not simulated"
                out.append(g)
                continue
            base, new = self.run(p[0], p[2]), self.run(p[0], p[3])
            if not base or not new:
                g["sim"] = "not simulated"
            else:
                x = gain(base, new, p[1])
                g["sim_gain"] = round(math.exp(x) - 1, 3)
                # Real games already show these winning, so a Simulator that disagrees is shown, not hidden: it
                # flags either a blind spot of the fight model (full tank builds) or something worth a closer look.
                g["sim"] = "agrees" if x >= ITEM_FLOOR else "disagrees"
            out.append(g)
        return out

    def augments(self, gems, jobs=None):
        keep = []
        for g in gems:
            c = self.champs.get(str(g["champion"]))
            key = self.aug_key.get(g["id"])
            if g["id"] not in self.live_augments:
                self.drop("augments", "not in the live augment pool")
            else:
                keep.append(g)
        plans = [self.augment_plan(g) for g in keep]
        todo = {(p[0], tuple(p[2]), aug) for p in plans if p for aug in ((), (p[3],))}
        with ThreadPoolExecutor(jobs or os.cpu_count() or 2) as ex:
            list(ex.map(lambda t: self.run(t[0], list(t[1]), list(t[2])), todo))
        out = []
        for g, p in zip(keep, plans):
            if not p:
                g["sim"] = "not simulated"
                out.append(g)
                continue
            base, new = self.run(p[0], p[2]), self.run(p[0], p[2], [p[3]])
            if not base or not new:
                g["sim"] = "not simulated"
                out.append(g)
                continue
            x = gain(base, new, p[1])
            if x < AUGMENT_FLOOR:
                self.drop("augments", "Simulator disagrees")
                continue
            g["sim"] = "agrees" if x > 0.005 else "no gain"
            out.append(g)
        return out
