"""Build signals from past Mayhem games' timelines: every player of every game in the owner's archive, counts only.

Riot's match-history timelines (one frame a minute, plus events) give every player's stats, gold, position and
damage taken by type each minute, and a damage breakdown for every death. This script downloads them once into a
private cache on this computer, then reports eleven signals for build advice:

  1 damage type that kills, and how well enemy champions predict it (historical per-champion damage mix)
  2 burst vs sustained deaths          3 one enemy doing most of the damage   4 caught vs traded deaths
  5 legendary items as power spikes    6 gold behind or ahead                 7 enemy sustain vs anti-heal
  8 late sells and swaps               9 stat jumps at augment picks (to teach the overlay to spot them)
 10 skill max order                   11 deaths ahead of the team

Nothing per game or per player is printed or written outside the cache; output is rates and counts.

    python death_details_dir/timeline_signals.py <archive.json> [--json out.json] [--no-fetch]

Needs League open and signed in for downloading (mayhem_import's match-history service calls); with --no-fetch it
reads only the cache (%APPDATA%/Mayhem Stats/timelines, one gzip file per game).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import statistics as st
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "importer"))

from death_details import REMAKE_SECONDS, deaths_in, dmg  # noqa: E402

LEGENDARY = set([2065, 2501, 2502, 2503, 2504, 2510, 2512, 2517, 2522, 2523, 2524, 2525, 2526, 2530, 3001, 3002, 3003, 3004, 3005, 3011, 3022, 3023, 3025, 3026, 3027, 3031, 3032, 3033, 3035, 3036, 3039, 3040, 3041, 3042, 3046, 3050, 3053, 3056, 3060, 3063, 3064, 3065, 3068, 3069, 3071, 3072, 3073, 3074, 3075, 3078, 3083, 3084, 3085, 3087, 3089, 3091, 3092, 3094, 3095, 3100, 3102, 3107, 3109, 3110, 3114, 3115, 3116, 3118, 3119, 3121, 3123, 3124, 3128, 3131, 3135, 3137, 3138, 3139, 3141, 3142, 3143, 3146, 3151, 3152, 3153, 3154, 3156, 3157, 3160, 3161, 3165, 3172, 3173, 3174, 3178, 3179, 3181, 3190, 3206, 3207, 3209, 3222, 3302, 3430, 3504, 3508, 3512, 3742, 3748, 3814, 4004, 4005, 4011, 4401, 4628, 4629, 4633, 4637, 4645, 4646, 6333, 6609, 6610, 6616, 6617, 6620, 6621, 6631, 6653, 6655, 6657, 6662, 6664, 6665, 6672, 6673, 6675, 6676, 6692, 6693, 6694, 6695, 6696, 6697, 6698, 6699, 6701, 8001, 8010, 8020])
ANTIHEAL = {3033, 3075, 3076, 3123, 3165, 3916, 6609}
AUGMENT_LEVELS = (1, 7, 11, 15)
STATS = ("abilityHaste", "abilityPower", "attackDamage", "attackSpeed", "armor", "magicResist", "healthMax",
         "movementSpeed", "omnivamp", "lifesteal")
WINDOW_MS = 120_000
FORWARD = 1500  # map units ahead of the team's average position
MIN_N = 20


def norm(item):
    item = int(item or 0)
    return item % 10000 if item >= 100000 else item


def cache_dir():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, "Mayhem Stats", "timelines")


def load_cached(game_id):
    try:
        with gzip.open(os.path.join(cache_dir(), f"{game_id}.json.gz"), "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def fetch_all(games):
    import mayhem_import as mi
    todo = [g for g in games if load_cached(g["gameId"]) is None]
    if not todo:
        return
    lcu = mi.find_client()
    if not lcu:
        sys.exit("League isn't open; run with --no-fetch to use the cache only.")
    puuid = lcu.get("/lol-summoner/v1/current-summoner")["puuid"]
    token = mi.sgp_token(lcu)
    host = mi.find_sgp_host(lcu, puuid, token)
    os.makedirs(cache_dir(), exist_ok=True)

    def one(g):
        try:
            tl = mi.sgp_timeline(host, token, f"{g.get('platformId') or 'NA1'}_{g['gameId']}")
        except Exception:  # noqa: BLE001 - skipped, a later run retries
            return False
        if not tl:
            return False
        for f in tl.get("frames") or []:  # wards are never used
            f["events"] = [e for e in f.get("events") or [] if not str(e.get("type", "")).startswith("WARD")]
        with gzip.open(os.path.join(cache_dir(), f"{g['gameId']}.json.gz"), "wt", encoding="utf-8") as f:
            json.dump(tl, f, separators=(",", ":"))
        return True

    with ThreadPoolExecutor(mi.SGP_WORKERS) as pool:
        got = sum(pool.map(one, todo))
    print(f"downloaded {got} of {len(todo)} new timelines", file=sys.stderr)


def rate(rows, key="win"):
    return {"n": len(rows), "win_rate": round(sum(r[key] for r in rows) / len(rows), 3)} if rows else {"n": 0}


def binned(v, bins):
    for lo, hi, label in bins:
        if lo <= v < hi:
            return label
    return bins[-1][2]


class Game:
    def __init__(self, g, tl):
        self.g, self.tl = g, tl
        self.frames = tl.get("frames") or []
        self.events = [e for f in self.frames for e in f.get("events") or []]
        self.parts = {p["participantId"]: p for p in g.get("participants") or []}
        self.team = {pid: p["teamId"] for pid, p in self.parts.items()}
        self.win = {pid: bool(p["stats"].get("win")) for pid, p in self.parts.items()}
        self.champ = {pid: p.get("championId") for pid, p in self.parts.items()}

    def pf(self, minute, pid):
        if not self.frames:
            return {}
        minute = max(0, min(len(self.frames) - 1, minute))
        return (self.frames[minute].get("participantFrames") or {}).get(str(pid)) or {}

    def enemies(self, pid):
        return [q for q in self.parts if self.team[q] != self.team[pid]]


def analyse(games):
    out = {}
    # Historical damage mix per champion (all games): physical / magic / true share of damage to champions.
    mix = defaultdict(lambda: [0.0, 0.0, 0.0])
    for G in games:
        last = len(G.frames) - 1
        for pid in G.parts:
            ds = G.pf(last, pid).get("damageStats") or {}
            m = mix[G.champ[pid]]
            m[0] += ds.get("physicalDamageDoneToChampions", 0)
            m[1] += ds.get("magicDamageDoneToChampions", 0)
            m[2] += ds.get("trueDamageDoneToChampions", 0)
    share = {c: [x / max(1, sum(m)) for x in m] for c, m in mix.items()}

    # 1-4 and 11: deaths
    death_rows, type_err, type_naive, resist = [], [], [], []
    phys_all = []
    per_player = defaultdict(lambda: {"deaths": 0, "caught": 0, "burst": 0, "forward": 0, "dmg_by": Counter(),
                                      "phys": 0.0, "mag": 0.0, "tru": 0.0})
    for G in games:
        kills = [e for e in G.events if e.get("type") == "CHAMPION_KILL"]
        flags = deaths_in(G.tl)
        for k, (v, traded, burst) in zip(kills, flags):
            if v not in G.parts:
                continue
            p = per_player[(id(G), v)]
            p["deaths"] += 1
            p["caught"] += not traded
            p["burst"] += burst
            for e in k.get("victimDamageReceived") or []:
                p["phys"] += e.get("physicalDamage") or 0
                p["mag"] += e.get("magicDamage") or 0
                p["tru"] += e.get("trueDamage") or 0
                if 1 <= (e.get("participantId") or 0) <= 10:
                    p["dmg_by"][e["participantId"]] += dmg([e])
            # 11: ahead of the team when dying
            minute = int(round((k.get("timestamp") or 0) / 60000))
            def progress(pos, team):
                d = ((pos.get("x") or 0) + (pos.get("y") or 0)) / 2
                return d if team == 100 else 13000 - d
            mates = [progress(G.pf(minute, q).get("position") or {}, G.team[v]) for q in G.parts
                     if G.team[q] == G.team[v] and q != v and G.pf(minute, q).get("position")]
            if mates and k.get("position"):
                if progress(k["position"], G.team[v]) - st.mean(mates) > FORWARD:
                    p["forward"] += 1
        for pid in G.parts:
            p = per_player.get((id(G), pid))
            if not p or not p["deaths"]:
                continue
            total = p["phys"] + p["mag"] + p["tru"]
            if total <= 0:
                continue
            actual = p["phys"] / total
            pred = st.mean(share[G.champ[q]][0] for q in G.enemies(pid))
            phys_all.append(actual)
            type_err.append(abs(actual - pred))
            top = max(p["dmg_by"].values()) / max(1, sum(p["dmg_by"].values())) if p["dmg_by"] else 0
            death_rows.append({"win": G.win[pid], "caught": p["caught"] / p["deaths"], "burst": p["burst"] / p["deaths"],
                               "focus": top, "forward": p["forward"] / p["deaths"], "phys": actual,
                               "champ": G.champ[pid], "game": G, "pid": pid})
    mean_phys = st.mean(phys_all) if phys_all else 0.5
    type_naive = [abs(r["phys"] - mean_phys) for r in death_rows]
    # resist match: armor share of (armor + MR) at the end vs the champion's usual, against physical share taken
    arm = defaultdict(list)
    for r in death_rows:
        cs = r["game"].pf(len(r["game"].frames) - 1, r["pid"]).get("championStats") or {}
        a, m = cs.get("armor", 0), cs.get("magicResist", 0)
        r["armor_share"] = a / (a + m) if a + m else 0.5
        arm[r["champ"]].append(r["armor_share"])
    arm_mean = {c: st.mean(v) for c, v in arm.items()}
    matched, mismatched = [], []
    for r in death_rows:
        built = r["armor_share"] - arm_mean[r["champ"]]
        threat = r["phys"] - mean_phys
        if abs(built) > 0.03 and abs(threat) > 0.1:
            (matched if (built > 0) == (threat > 0) else mismatched).append(r)
    out["1_damage_type"] = {
        "physical_share_of_death_damage": round(mean_phys, 3),
        "prediction_error_from_enemy_champions": round(st.mean(type_err), 3) if type_err else None,
        "prediction_error_naive_average": round(st.mean(type_naive), 3) if type_naive else None,
        "resists_built_toward_threat": rate(matched), "resists_built_away_from_threat": rate(mismatched)}
    thirds = [(0, 0.34, "low"), (0.34, 0.67, "mid"), (0.67, 1.01, "high")]
    for key, name in (("burst", "2_burst_share"), ("focus", "3_one_enemy_share"), ("caught", "4_caught_share"),
                      ("forward", "11_ahead_of_team_share")):
        groups = defaultdict(list)
        for r in death_rows:
            groups[binned(r[key], thirds)].append(r)
        out[name] = {"average": round(st.mean(r[key] for r in death_rows), 3) if death_rows else None,
                     **{b: rate(groups[b]) for _, _, b in thirds}}

    # 5 power spikes: fight score (kills + assists - deaths) in the 2 minutes after a legendary vs before
    spikes, by_slot = defaultdict(list), defaultdict(list)
    for G in games:
        kills = [e for e in G.events if e.get("type") == "CHAMPION_KILL"]
        seen = defaultdict(set)
        for e in G.events:
            if e.get("type") != "ITEM_PURCHASED" or norm(e.get("itemId")) not in LEGENDARY:
                continue
            pid, item, t = e.get("participantId"), norm(e.get("itemId")), e.get("timestamp") or 0
            if item in seen[pid] or pid not in G.parts:
                continue
            seen[pid].add(item)

            def score(lo, hi):
                s = 0
                for k in kills:
                    if lo <= (k.get("timestamp") or 0) < hi:
                        s += (k.get("killerId") == pid) + (pid in (k.get("assistingParticipantIds") or [])) - (k.get("victimId") == pid)
                return s
            d = score(t, t + WINDOW_MS) - score(t - WINDOW_MS, t)
            spikes[item].append(d)
            by_slot[len(seen[pid])].append(d)
    slot_avg = {s: round(st.mean(v), 3) for s, v in sorted(by_slot.items()) if len(v) >= MIN_N}
    ranked = sorted(((round(st.mean(v), 3), i, len(v)) for i, v in spikes.items() if len(v) >= 40), reverse=True)
    out["5_power_spikes"] = {"avg_change_by_legendary_number": slot_avg,
                             "best": [{"item": i, "change": c, "n": n} for c, i, n in ranked[:10]],
                             "worst": [{"item": i, "change": c, "n": n} for c, i, n in ranked[-10:]]}

    # 6 gold behind or ahead
    gold = {}
    behind = []
    for minute in (5, 10, 15):
        groups = defaultdict(list)
        for G in games:
            if len(G.frames) <= minute:
                continue
            tot = defaultdict(int)
            for pid in G.parts:
                tot[G.team[pid]] += G.pf(minute, pid).get("totalGold") or 0
            if len(tot) != 2:
                continue
            diff = tot[100] - tot[200]
            win100 = any(G.win[p] for p in G.parts if G.team[p] == 100)
            groups[binned(diff, [(-1e9, -2000, "behind 2000+"), (-2000, -500, "behind 500-2000"), (-500, 500, "even"),
                                  (500, 2000, "ahead 500-2000"), (2000, 1e9, "ahead 2000+")])].append({"win": win100})
            groups[binned(-diff, [(-1e9, -2000, "behind 2000+"), (-2000, -500, "behind 500-2000"), (-500, 500, "even"),
                                   (500, 2000, "ahead 500-2000"), (2000, 1e9, "ahead 2000+")])].append({"win": not win100})
            if minute == 10 and len(G.frames) > 14:
                for pid in G.parts:
                    sign = 1 if G.team[pid] == 100 else -1
                    if sign * diff < -1000:
                        a = G.pf(10, pid).get("championStats") or {}
                        b = G.pf(14, pid).get("championStats") or {}
                        gain = (b.get("armor", 0) + b.get("magicResist", 0)) - (a.get("armor", 0) + a.get("magicResist", 0))
                        behind.append({"win": G.win[pid], "gain": gain})
        gold[f"minute_{minute}"] = {k: rate(v) for k, v in sorted(groups.items())}
    if behind:
        med = st.median(r["gain"] for r in behind)
        gold["behind_1000_at_10_resists_gained_by_14"] = {
            "median_gain": med, "above_median": rate([r for r in behind if r["gain"] > med]),
            "at_or_below": rate([r for r in behind if r["gain"] <= med])}
    out["6_gold"] = gold

    # 7 enemy sustain vs anti-heal by minute 12 (team level)
    sus = []
    for G in games:
        if len(G.frames) <= 10:
            continue
        for team in (100, 200):
            foes = [p for p in G.parts if G.team[p] != team]
            if not foes:
                continue
            top = max(sum((G.pf(10, p).get("championStats") or {}).get(s, 0) for s in
                          ("lifesteal", "omnivamp", "physicalVamp", "spellVamp")) for p in foes)
            has = any(e.get("type") == "ITEM_PURCHASED" and norm(e.get("itemId")) in ANTIHEAL and
                      (e.get("timestamp") or 0) <= 12 * 60000 and G.team.get(e.get("participantId")) == team
                      for e in G.events)
            mates = [p for p in G.parts if G.team[p] == team]
            sus.append({"sustain": top, "antiheal": has, "win": G.win[mates[0]] if mates else False})
    if sus:
        cut = sorted(r["sustain"] for r in sus)[int(len(sus) * 0.75)]
        hi = [r for r in sus if r["sustain"] >= cut and r["sustain"] > 0]
        lo = [r for r in sus if r["sustain"] < cut]
        out["7_antiheal"] = {"high_sustain_cutoff": cut,
                             "vs_high_sustain": {"with": rate([r for r in hi if r["antiheal"]]),
                                                 "without": rate([r for r in hi if not r["antiheal"]])},
                             "vs_low_sustain": {"with": rate([r for r in lo if r["antiheal"]]),
                                                "without": rate([r for r in lo if not r["antiheal"]])}}

    # 8 late sells (after 15 minutes, not consumables)
    sells = defaultdict(list)
    sold_items = {True: Counter(), False: Counter()}
    for G in games:
        n = Counter()
        for e in G.events:
            if e.get("type") == "ITEM_SOLD" and (e.get("timestamp") or 0) > 15 * 60000 and norm(e.get("itemId")) >= 2100:
                n[e.get("participantId")] += 1
                if e.get("participantId") in G.win:
                    sold_items[G.win[e["participantId"]]][norm(e["itemId"])] += 1
        for pid in G.parts:
            sells[G.win[pid]].append(n[pid])
    out["8_late_sells"] = {"per_player_winners": round(st.mean(sells[True]), 3) if sells[True] else None,
                           "per_player_losers": round(st.mean(sells[False]), 3) if sells[False] else None,
                           "top_sold_by_winners": sold_items[True].most_common(8),
                           "top_sold_by_losers": sold_items[False].most_common(8)}

    # 9 stat jumps over the minute of each augment pick, vs everyone's jump at that pick
    obs, base = [], defaultdict(lambda: defaultdict(list))
    for G in games:
        lvl_t = defaultdict(dict)
        for e in G.events:
            if e.get("type") == "LEVEL_UP":
                lvl_t[e.get("participantId")].setdefault(e.get("level"), e.get("timestamp") or 0)
        for pid, p in G.parts.items():
            augs = [a for a in (p["stats"].get(f"playerAugment{i}") for i in range(1, 7)) if a]
            for n, a in enumerate(augs[:len(AUGMENT_LEVELS)]):
                lv = AUGMENT_LEVELS[n]
                t = 0 if lv == 1 else lvl_t[pid].get(lv)
                m = None if t is None else int(t // 60000)
                if m is None or m + 1 >= len(G.frames):
                    continue
                a0 = G.pf(m, pid).get("championStats") or {}
                a1 = G.pf(m + 1, pid).get("championStats") or {}
                d = {s_: a1.get(s_, 0) - a0.get(s_, 0) for s_ in STATS}
                obs.append((a, n, d))
                for s_, v in d.items():
                    base[n][s_].append(v)
    base_med = {n: {s_: st.median(v) for s_, v in d.items()} for n, d in base.items()}
    extra = defaultdict(lambda: defaultdict(list))  # augment -> stat -> jump minus the usual jump at that pick
    for a, n, d in obs:
        for s_, v in d.items():
            extra[a][s_].append(v - base_med[n][s_])
    aug_out = []
    for a, d in extra.items():
        n = len(d[STATS[0]])
        if n < 8:
            continue
        top = sorted(((s_, round(st.median(v), 1)) for s_, v in d.items()), key=lambda kv: -abs(kv[1]))[:2]
        aug_out.append({"augment": a, "n": n, "biggest_extra_jumps": top})
    out["9_augment_stat_jumps"] = sorted(aug_out, key=lambda r: -r["n"])

    # 10 skill max order: first two abilities to reach rank 5
    orders = defaultdict(lambda: defaultdict(list))
    names = {1: "Q", 2: "W", 3: "E"}
    for G in games:
        ranks, maxed = defaultdict(Counter), defaultdict(list)
        for e in G.events:
            if e.get("type") == "SKILL_LEVEL_UP" and e.get("skillSlot") in names:
                pid, s = e.get("participantId"), e["skillSlot"]
                ranks[pid][s] += 1
                if ranks[pid][s] == 5:
                    maxed[pid].append(names[s])
        for pid in G.parts:
            if len(maxed[pid]) >= 2:
                orders[G.champ[pid]][">".join(maxed[pid][:2])].append({"win": G.win[pid]})
    skill = []
    for c, d in orders.items():
        big = {o: rate(v) for o, v in d.items() if len(v) >= 15}
        if len(big) >= 2:
            wr = sorted(big.items(), key=lambda kv: -kv[1]["win_rate"])
            if wr[0][1]["win_rate"] - wr[-1][1]["win_rate"] >= 0.08:
                skill.append({"champion": c, "orders": dict(wr)})
    out["10_skill_order"] = skill[:25]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("--json")
    ap.add_argument("--no-fetch", action="store_true")
    args = ap.parse_args()
    with open(args.archive, encoding="utf-8") as f:
        data = json.load(f)
    games = data.get("games", data) if isinstance(data, dict) else data
    games = [g for g in games if g.get("gameId")]
    if not args.no_fetch:
        fetch_all(games)
    loaded = []
    for g in games:
        dur = g.get("gameDuration") or 0
        dur = dur / 1000 if dur > 10_000 else dur
        tl = load_cached(g["gameId"])
        if tl and dur >= REMAKE_SECONDS:
            loaded.append(Game(g, tl))
    out = {"games": len(games), "analysed": len(loaded), **analyse(loaded)}
    text = json.dumps(out, indent=1, default=str)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    main()
