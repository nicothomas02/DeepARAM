"""How demanding each champion's core is (Nico 2026-11-25: "Irelia only wants BotRK, Aphelios has a more demanding
core"). An item is a must-have when most of the champion's players (50%+, the same bar as the approved "built by most
players" reason) still hold it at game end, on AramHex's 16.22 + 16.23 games (millions per champion). The rest of the
core is flexible: augments and buys may move or replace it.

Writes web/src/data/core-strictness.json: champion alias -> {must: [item ids, most held first], hold: {item: share}}.
Hold rates are behavior, not proof of value; the with/without win gap is printed for reference only (correlated:
held at game end, so short stomps and long games mix in).
Run: python3 data/estimates/core_strictness.py
"""
import collections, glob, json, os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
PATCHES = ("16.22", "16.23")
MUST = 0.5


def main():
    dd = json.load(open(sorted(glob.glob(os.path.join(ROOT, "web/public/assets/dd/*/data/en_US/item.json")))[-1]))["data"]
    fin = {int(i) % 10000 for i, it in dd.items() if it["gold"]["total"] >= 2000 and not it.get("into") and "Boots" not in it.get("tags", [])}
    champs = {int(v["key"]): v["id"] for v in json.load(open(sorted(glob.glob(os.path.join(ROOT, "web/public/assets/dd/*/data/en_US/champion.json")))[-1]))["data"].values()}
    tot = collections.defaultdict(lambda: [0, 0])
    held = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    for p in PATCHES:
        for c, v in json.load(open(os.path.join(ROOT, f"data/aramhex/patches/{p}/items.json"))).items():
            tot[int(c)][0] += v["all"][0]; tot[int(c)][1] += v["all"][1]
            for i, (g, w) in v["items"].items():
                if int(i) % 10000 in fin:
                    held[int(c)][int(i) % 10000][0] += g; held[int(c)][int(i) % 10000][1] += w
    out, sizes = {}, collections.Counter()
    for c, (G, W) in sorted(tot.items()):
        if c not in champs or G < 1000:
            continue
        rows = sorted(((g / G, i, w / g - (W - w) / (G - g) if G > g else 0) for i, (g, w) in held[c].items() if g >= 200), reverse=True)
        must = [i for s, i, _ in rows if s >= MUST]
        sizes[len(must)] += 1
        out[champs[c]] = {"must": must, "hold": {str(i): round(s, 2) for s, i, _ in rows if s >= 0.05}}
    json.dump({"about": __doc__.split("\n\n")[0], "patches": PATCHES, "champions": out}, open(os.path.join(ROOT, "web/src/data/core-strictness.json"), "w"), separators=(",", ":"))
    print("must-have items per champion:", sorted(sizes.items()))


if __name__ == "__main__":
    main()
