"""Build data.js for the Cook Builds page (tools/fun/cook-builds/, part of The Lab) from builds.json.

Adds, for every build:
- each augment's live English name, rarity, tooltip and icon (CommunityDragon, Mayhem = KIWI)
- Mayhem win and pick rates for the champion and each augment (data/cn/, see data/cn/README.md)
- whether the champion is on the best-champion list for that augment
- optional simulator numbers: the build against the simulator's best build for that champion
  (items only, with the best build's augments, unless all of the build's augments are in the simulator)

Usage:
  python3 -m pip install xxhash
  python3 data/cook-builds/build_data.py [--cn data/cn] [--sim simulator/mayhem_sim]

--cn needs augments.json and champions.json from data/cn/fetch_cn.py.
--sim is the all-champion simulator (simulator/, `make mayhem_sim`); leave it out to skip simulator numbers.
"""
import argparse, csv, glob, json, os, re, subprocess, time, urllib.request
import xxhash

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, "..", "..")
# The page lives in The Lab (tools/fun/cook-builds/); this folder keeps the hand-written builds.
PAGE = os.path.join(HERE, "..", "..", "tools", "fun", "cook-builds")
CD = "https://raw.communitydragon.org/latest"
GD = CD + "/plugins/rcp-be-lol-game-data/global/default/v1"
RARITY = {0: "Silver", 1: "Gold", 2: "Prismatic"}


def fetch(url, tries=4):
    # CommunityDragon refuses Python's default User-Agent.
    req = urllib.request.Request(url, headers={"User-Agent": "aram-mayhem-cook-builds"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except OSError:
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)


def strings():
    entries = json.loads(fetch(CD + "/game/en_us/data/menu/en_us/lol.stringtable.json"))["entries"]

    def get(key):
        if not key:
            return ""
        k = key.lower()
        return entries.get(k) or entries.get("{%010x}" % (xxhash.xxh3_64_intdigest(k.encode()) & ((1 << 38) - 1))) or ""
    return get


def augment_text(text, data_values, s):
    """Fill in @Value@ / @Value*100@ placeholders, drop the live counters and markup."""
    text = re.sub(r"\{\{\s*(Kiwi_[A-Za-z0-9_]+)\s*\}\}", lambda m: s(m.group(1)) or "", text)  # nested string keys
    def rep(m):
        v = data_values.get(m.group(1))
        return m.group(0) if v is None else "%g" % round(v * float(m.group(2) or 1), 2)
    text = re.sub(r"@([A-Za-z0-9_]+)(?:\*([0-9.]+))?@", rep, text)
    text = text.split("---")[0]
    text = re.sub(r"(Damage Dealt|Bonus Damage|Gold Generated|Total Healing Done|Total Health Gained|Terrain Damage|Encouragements Received|Number of Bounces|Units knocked back|Spirit Bombs Tossed|Bonus Healing|Times Triggered|Damage Reduced|Out of)\b.*$", "", text)
    text = re.sub(r"<[^>]+>|%i:[A-Za-z]+%", "", text)
    text = re.sub(r"\{\{\s*Item_Keyword_OnHit\s*\}\}", "On-Hit", text)
    # Ability-specific augments are rolled for one of the champion's abilities.
    text = re.sub(r"\b[Yy]our \{\{\s*[Ss]pell[Nn]ame\s*\}\}", "Your chosen ability", text)
    text = re.sub(r"\{\{\s*[Ss]pell[Nn]ame\s*\}\}", "the chosen ability", text)
    text = re.sub(r"@[^@]*@\s*", "", text)  # values the data doesn't fill in
    text = re.sub(r"([.!)])([A-Z])", r"\1 \2", text)  # line breaks lost with the markup
    text = text.replace("an extra damage", "extra damage").replace("()", "")
    text = re.sub(r"\b1 plus (?=[a-z])", "", text)
    text = re.sub(r"\b(\w+) \1\b", r"\1", text)  # "damage damage" from joined strings
    text = re.sub(r"\s+", " ", text).replace(" ,", ",").replace(" .", ".").strip()
    return re.sub(r"(?<=[.!)])\s+[^.!:]{1,40}:$", "", text)  # a stat counter's label left at the end


def best_text(candidates, dv, s):
    """The tooltip, unless it has 2+ numbers the data can't fill in and the shorter summary has fewer."""
    def gaps(t):
        return len(re.findall(r"@[^@]*@", re.sub(r"@([A-Za-z0-9_]+)(?:\*[0-9.]+)?@", lambda m: "" if m.group(1) in dv else m.group(0), t)))
    texts = [t for t in candidates if t]
    if not texts:
        return ""
    pick = texts[0] if gaps(texts[0]) <= 1 else min(texts, key=gaps)
    return augment_text(pick, dv, s)


def mayhem_augments():
    kiwi = json.loads(fetch(CD + "/game/maps/modespecificdata/kiwi.bin.json"))
    pool = {x["modeName"]: x["augmentList"] for x in json.loads(fetch(GD + "/augment-lists.json"))}["KIWI"]
    s = strings()
    out = {}
    for path in pool:
        e = kiwi.get(path)
        if not e:
            continue
        dv = {}
        for sp in [e.get("RootSpell")] + (e.get("AdditionalSpells") or []):
            for d in ((kiwi.get(sp) or {}).get("mSpell") or {}).get("DataValues") or []:
                v = d.get("values") or []
                if v and d.get("name") not in dv:
                    dv[d["name"]] = v[1] if len(v) > 1 else v[0]
        name = s(e.get("NameTra"))
        out[name] = {
            "id": e.get("AugmentPlatformId"),
            "name": name,
            "rarity": RARITY.get(e.get("rarity", 0), "Silver"),
            "text": best_text([s(e.get("AugmentTooltipTra")), s(e.get("DescriptionTra"))], dv, s),
            "icon_url": CD + "/game/" + re.sub(r"\.(tex|dds)$", ".png", e["AugmentSmallIconPath"].lower()),
        }
    return out


def save_icon(url, name):
    path = os.path.join(PAGE, "icons", name)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(fetch(url))
    return "icons/" + name


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def run_sim(sim, args):
    # The simulator reads data/ relative to its own folder.
    out = subprocess.run([sim] + args + ["--json"], capture_output=True, text=True, check=True, cwd=os.path.dirname(sim))
    return json.loads(out.stdout)


def simulate(sim, sim_list, build, items, augs):
    """Score the build against the simulator's best build for this champion. When every augment is in the
    simulator the whole build is run; otherwise its items run with the best build's augments, so the
    comparison is items against items."""
    champ = next((c for c in sim_list["champions"] if c["id"] == build["champion"]), None)
    if not champ:
        return None
    item_keys = {i["name"].lower(): i["key"] for i in sim_list["items"]}
    aug_keys = {a["name"].lower(): a["key"] for a in sim_list["augments"]}
    it = [item_keys[n.lower()] for n in items if n.lower() in item_keys]
    best_run = run_sim(sim, ["--champ", champ["id"]])["builds"][0]
    best = best_run["summary"]
    whole = all(n.lower() in aug_keys for n in augs)
    ag = [aug_keys[n.lower()] for n in augs] if whole else best_run["build"]["augments"]
    cook = run_sim(sim, ["--champ", champ["id"], "--items", ",".join(it), "--augs", ",".join(ag)])["builds"][0]["summary"]
    names = {i["key"]: i["name"] for i in sim_list["items"]} | {a["key"]: a["name"] for a in sim_list["augments"]}
    return {
        "dps": round(cook["mean_dps"]),
        "survival": round(cook["survival_rate"], 3),
        "best_dps": round(best["mean_dps"]),
        "best_survival": round(best["survival_rate"], 3),
        "pct_of_best": round(cook["mean_dps"] / best["mean_dps"], 3),
        "best_items": [names.get(k, k) for k in best_run["build"]["items"]],
        "best_augments": [names.get(k, k) for k in best_run["build"]["augments"]],
        "items_not_modeled": [n for n in items if n.lower() not in item_keys],
        "whole_build": whole,
    }


def tier(core_wr):
    if core_wr is None:
        return "Untested"
    if core_wr >= 0.555:
        return "Secretly strong"
    if core_wr >= 0.515:
        return "Holds up"
    return "Pure troll"


def chef_i18n(chef):
    """The Chef Special's text in each of the site's languages (The Lab's translations, tools/fun/i18n/<code>.json).
    Names are left out: the site's own name files translate champions, items and augments by id."""
    out = {}
    for path in sorted(glob.glob(os.path.join(REPO, "tools", "fun", "i18n", "*.json"))):
        code = os.path.basename(path)[:-5]
        if code == "en":
            continue
        d = json.load(open(path, encoding="utf-8"))
        out[code] = {
            "title": d.get(chef["title"], chef["title"]),
            "why": d.get(chef["why"], chef["why"]),
            "play": d.get(chef["play"], chef["play"]),
            "augments": [d.get(a["text"], a["text"]) for a in chef["augments"]],
        }
    return out


def item_id_map():
    """English item name -> an item id the site's name files translate (the lowest id sold in ARAM)."""
    dd = sorted(glob.glob(os.path.join(REPO, "web", "public", "assets", "dd", "*", "data", "en_US", "item.json")),
                key=lambda p: [int(x) for x in re.findall(r"\d+", p.split(os.sep + "dd" + os.sep)[1].split(os.sep)[0])])
    if not dd:
        return {}
    out = {}
    for k, v in sorted(json.load(open(dd[-1], encoding="utf-8"))["data"].items(), key=lambda kv: int(kv[0])):
        if v.get("maps", {}).get("12"):
            out.setdefault(v["name"], int(k))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cn", default=os.path.join(HERE, "..", "cn"))
    ap.add_argument("--sim")
    a = ap.parse_args()

    src = json.load(open(os.path.join(HERE, "builds.json"), encoding="utf-8"))
    builds, text_overrides = src["builds"], src.get("augment_text", {})
    cn_aug = json.load(open(os.path.join(a.cn, "augments.json")))
    cn_champ = json.load(open(os.path.join(a.cn, "champions.json")))
    aug_stats = {x["augment_id"]: x for x in cn_aug["augments"]}
    champs = {c["champion_id"]: c for c in cn_champ["champions"]}
    # CN champion names: champions.csv has the English key; champions.json carries only ids, so read the csv.
    champ_ids = {r["name"]: int(r["champion_id"]) for r in csv.DictReader(open(os.path.join(a.cn, "champions.csv"), encoding="utf-8"))}
    names_by_id = {v: k for k, v in champ_ids.items()}
    n_champs = len(champs)
    augs = mayhem_augments()
    # An augment that has since left the live pool keeps the text and icon its archived build was published with.
    prev = {}
    try:
        with open(os.path.join(PAGE, "data.js"), encoding="utf-8") as f:
            old = json.loads(f.read().split("=", 1)[1].strip().rstrip(";"))
        prev = {r["name"]: r for b in old["builds"] for r in b["augments"]}
    except (OSError, ValueError, KeyError, IndexError):
        pass
    sim_list = json.loads(subprocess.run([a.sim, "--list", "--json"], capture_output=True, text=True, check=True, cwd=os.path.dirname(a.sim)).stdout) if a.sim else None
    sim_names = {c["id"]: c["name"] for c in sim_list["champions"]} if sim_list else {}

    item_ids = item_id_map()
    out = []
    for b in builds:
        cid = champ_ids[b["champion"]]
        c = champs.get(cid, {})
        rows = []
        for i, name in enumerate(b["augments"]):
            g = augs.get(name) or prev[name]
            st = aug_stats.get(g["id"], {})
            rows.append({
                "name": name, "id": g["id"], "rarity": g["rarity"], "text": text_overrides.get(name, g["text"]), "core": i < b["core"],
                "icon": save_icon(g["icon_url"], "augments/" + slug(name) + ".png") if name in augs else g["icon"],
                "win_rate": st.get("win_rate"), "pick_rate": st.get("pick_rate"), "win_rank": st.get("win_rank"),
                "best_champions": [names_by_id.get(x, str(x)) for x in st.get("best_champions", [])],
                "champion_is_best": cid in st.get("best_champions", []),
            })
        rated = [r["win_rate"] for r in rows if r["core"] and r["win_rate"] is not None]
        core_wr = round(sum(rated) / len(rated), 4) if rated else None
        entry = dict(b)
        entry.update({
            "champion_name": sim_names.get(b["champion"], b["champion"]),
            "item_ids": [item_ids.get(n) for n in b["items"]],
            "champion_icon": save_icon(f"{GD}/champion-icons/{cid}.png", f"champions/{cid}.png"),
            "champion_win_rate": c.get("win_rate"), "champion_pick_rate": c.get("pick_rate"),
            "champion_win_rank": 1 + sum(1 for x in champs.values() if x["win_rate"] > c.get("win_rate", 0)),
            "augments": rows, "core_win_rate": core_wr, "tier": tier(core_wr),
            # How unconventional: how many core augments players already use on this champion, and how often they're picked.
            "core_usual": sum(1 for r in rows if r["core"] and r["champion_is_best"]),
            "core_pick_rate": round(sum(picks) / len(picks), 4) if (picks := [r["pick_rate"] for r in rows if r["core"] and r["pick_rate"] is not None]) else None,
        })
        if a.sim:
            entry["sim"] = simulate(a.sim, sim_list, b, b["items"], b["augments"])
        out.append(entry)

    meta = {
        "cn_augment_date": cn_aug["meta"].get("augment_stat_date"),
        "cn_champion_date": cn_aug["meta"].get("champion_stat_date"),
        "champion_count": n_champs, "augment_count": len(aug_stats),
        "generated": time.strftime("%Y-%m-%d"),
    }
    with open(os.path.join(PAGE, "data.js"), "w", encoding="utf-8") as f:
        f.write("window.COOK_DATA = " + json.dumps({"meta": meta, "builds": out}, indent=1, ensure_ascii=False) + ";\n")
    # The Lab's front page names today's Chef Special (the build with the newest `chef` date) and counts the
    # archive (every build with a `chef` date) without loading all of data.js.
    specials = [b for b in out if b.get("chef")]
    chef = max(specials, key=lambda b: b["chef"], default=None)
    pick = dict({k: chef[k] for k in ("id", "title", "champion", "champion_name", "chef")}, count=len(specials)) if chef else None
    with open(os.path.join(PAGE, "chef.js"), "w", encoding="utf-8") as f:
        f.write("window.COOK_CHEF = " + json.dumps(pick, ensure_ascii=False) + ";\n")
    # Home shows today's Chef Special too; this file has everything its card needs, with icon paths as the
    # site serves them (The Lab is published at /embed/fun/) and the link to the full build.
    site = "/embed/fun/cook-builds/"
    special = None
    if chef:
        # No stats: a Chef Special is picked for the idea, not its win rate.
        special = {k: chef[k] for k in ("id", "title", "champion", "champion_name", "chef", "why", "play", "items", "core")}
        special.update({
            "champion_icon": site + chef["champion_icon"],
            "augments": [{"name": r["name"], "rarity": r["rarity"], "core": r["core"], "text": r["text"],
                          "icon": site + r["icon"]} for r in chef["augments"]],
            "href": "/kitchen#chefs-special",
            "archive_href": "/kitchen#chef-archive",
            # Sharing: the dated link keeps opening this special after it is replaced; the image is its link preview.
            "share_href": "/kitchen/" + chef["chef"],  # its link preview shows the share image
            "share_image": site + "share/" + chef["id"] + ".png",
            "item_ids": chef["item_ids"],
            "i18n": chef_i18n(chef),
        })
        for a, r in zip(special["augments"], chef["augments"]):
            a["id"] = r["id"]
    with open(os.path.join(HERE, "chefs-special.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(special, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(out)} builds" + (f"; Today's Chef Special {chef['chef']}: {chef['title']}" if chef else ""))


if __name__ == "__main__":
    main()
