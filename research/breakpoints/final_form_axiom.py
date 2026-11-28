"""Does Final Form raise Axiom Arc's value? (Nico 2026-11-28: "Should final form boost axiom prio?")
Final Form: casting R gives a 50% max-health shield, 20% omnivamp, 30% move speed for 10 s (20 s cooldown).
Axiom Arc (Flux, 26.9): a takedown refunds 10% + 0.25% per Lethality of R's total cooldown (simulator: kills only).
For champions with Final Form in their Mayhem pool whose players build Axiom (10,000+ games), at buys 2..4
(archive levels), compare Axiom vs the planned item in damage per fight (default fights: enemies fight back and
die), with and without Final Form, and with the refund off (old simulator binary) to see what the refund adds.
    python3 research/breakpoints/final_form_axiom.py <old_sim_binary>
"""
import json, subprocess, sys, os, glob
from multiprocessing import Pool
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NEW = os.path.join(ROOT, "simulator", "mayhem_sim"); OLD = sys.argv[1] if len(sys.argv) > 1 else None
LVL = {2: 6, 3: 10, 4: 13}
lst = json.loads(subprocess.run([NEW, "--list", "--json"], capture_output=True, text=True, cwd=os.path.dirname(NEW)).stdout)
KEY = {i["id"]: i["key"] for i in lst["items"] if i.get("modeled")}
ROLE = {i["id"]: set(i.get("roles") or [i.get("role")]) for i in lst["items"]}
POOL = json.load(open(os.path.join(ROOT, "simulator/data/augment_pools.json")))["pools"]
DD = sorted(glob.glob(os.path.join(ROOT, "web/public/assets/dd/*/data/en_US/champion.json")), key=lambda p: [int(x) for x in p.split("/dd/")[1].split("/")[0].split(".")])[-1]
names = {int(v["key"]): k for k, v in json.load(open(DD))["data"].items()}
AX = 6696
N = lambda i: i - 120000 if i > 120000 else i  # Mayhem copies of items (126697 = Hubris)

def dpf(sim, champ, items, lvl, ff):
    cmd = [sim, "--champ", champ, "--items", ",".join(KEY[i] for i in items), "--trials", "400", "--seed", "7", "--json",
           "--set", f"level={lvl},enemy_level={lvl}"] + (["--augs", "final_form"] if ff else [])
    out = subprocess.run(cmd, capture_output=True, text=True, cwd=os.path.dirname(NEW))
    try: return json.loads(out.stdout)["builds"][0]["summary"]["damage_per_fight"]
    except Exception: return None

def rel(sim, champ, base, y, lvl, ff):
    a, p = dpf(sim, champ, base + [y], lvl, ff), dpf(sim, champ, base + [AX], lvl, ff)
    return round(100 * (p / a - 1), 1) if a and p else None

def job(cid):
    b = json.load(open(os.path.join(ROOT, f"data/cn/builds/{cid}.json"))); it = b.get("items") or {}
    core = [N(i) for i in ((it.get("core") or [{}])[0].get("items") or [])[:4] if N(i) != AX]
    boots = [N(r["items"][0]) for r in (it.get("boots") or [])[:1]]
    champ = names.get(int(cid))
    core, boots = [i for i in core if i in KEY], [i for i in boots if i in KEY]  # unmodelled items (e.g. Hubris) left out
    AD = {"ad", "crit", "lethality", "ability_ad", "onhit", "bruiser"}
    for r in sorted(it.get("other") or [], key=lambda r: -r.get("games", 0)):
        x = N(r["items"][0])
        if len(core) >= 4: break
        if x != AX and x in KEY and x not in core and x not in boots and ROLE.get(x, set()) & AD: core.append(x)
    if not champ or not core: return []
    rows = []
    for s, lvl in LVL.items():
        if s - 1 >= len(core): break
        y, base = core[s - 1], boots + core[: s - 1]
        r = {"champ": champ, "slot": s, "vs": y}
        for tag, sim in (("new", NEW), ("old", OLD)):
            if not sim: continue
            r[tag] = {"no_ff": rel(sim, champ, base, y, lvl, False), "ff": rel(sim, champ, base, y, lvl, True)}
        rows.append(r)
    return rows

if __name__ == "__main__":
    cids = []
    for c, v in POOL.items():
        f = os.path.join(ROOT, f"data/cn/builds/{c}.json")
        if "final_form" not in v or not os.path.exists(f): continue
        it = json.load(open(f)).get("items") or {}
        core = (it.get("core") or [{}])[0].get("items") or []
        g = {r["items"][0]: r.get("games", 0) for r in it.get("other") or []}
        if AX in core or g.get(AX, 0) >= 10000: cids.append(c)
    with Pool(4) as pool: res = [r for rows in pool.map(job, cids) for r in rows]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "final_form_axiom.json")
    json.dump(res, open(out, "w"), indent=0)
    ok = [r for r in res if r.get("new", {}).get("ff") is not None and r["new"]["no_ff"] is not None]
    lift = [r["new"]["ff"] - r["new"]["no_ff"] for r in ok]
    refund = [r["new"]["no_ff"] - r["old"]["no_ff"] for r in ok if r.get("old") and r["old"]["no_ff"] is not None]
    flips = [r for r in ok if r["new"]["no_ff"] < 0 <= r["new"]["ff"]]
    print(f"{len(ok)} champion-slots; Final Form changes Axiom's edge by mean {sum(lift)/len(lift):+.1f} pts "
          f"(>+2: {sum(l > 2 for l in lift)}, <-2: {sum(l < -2 for l in lift)}); refund alone adds {sum(refund)/max(1,len(refund)):+.1f} pts; "
          f"flips to Axiom with Final Form: {len(flips)}")
    for r in sorted(ok, key=lambda r: -(r["new"]["ff"] - r["new"]["no_ff"])):
        print(r["champ"], r["slot"], r["vs"], r)
