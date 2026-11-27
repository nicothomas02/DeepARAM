#!/usr/bin/env python3
"""How often the public app's Riot-friendly highlights (Popular / Kit, pick-rate floor) miss the card with the best
DeepScore on an offer, and by how much. Internal check only: DeepScore is never shown in the public app.

Offers are simulated: for every champion and rarity, every 3-card combination of that champion's augments of that
rarity (the champion's pool as augment-picks.json lists it). Combo needs taken augments, so first-offer only here.
Run: python3 research/public-app-highlights/sim.py <augment-picks.json> web/src/data/kit-interactions.json [floor] [rare]
"""
import itertools, json, sys, statistics
picks = json.load(open(sys.argv[1])); kit = json.load(open(sys.argv[2]))["interactions"]
FLOOR = float(sys.argv[3]) if len(sys.argv) > 3 else 0.25
kits = {(k["champion"].lower(), k["augment"]) for k in kit}
tot = miss = lit_none = 0; gaps = []; pop_miss = 0; pop_gaps = []; kit_cards = 0
for champ, rows in picks["champions"].items():
    by = {}
    for r in rows:
        if len(r) < 6 or r[2] is None: continue
        rar = picks["augments"].get(str(r[0]), [None, None])[1]
        by.setdefault(rar, []).append(r)
    for rar, rs in by.items():
        for offer in itertools.combinations(rs, 3):
            top = max(r[5] for r in offer)
            if top <= 0: continue
            pop = max(offer, key=lambda r: r[5])
            lit = [r for r in offer if r is pop or ((champ.lower(), r[0]) in kits and r[5] >= FLOOR * top)]
            kit_cards += sum(1 for r in lit if r is not pop)
            best = max(offer, key=lambda r: r[2])
            tot += 1
            if best not in lit:
                miss += 1; gaps.append(best[2] - max(r[2] for r in lit))
            if best is not pop:
                pop_miss += 1; pop_gaps.append(best[2] - pop[2])
print(f"offers {tot:,}  floor {FLOOR}")
print(f"highlights miss the best-DeepScore card: {miss/tot:.1%}; when they miss, best highlighted is {statistics.mean(gaps):.1f} DeepScore lower (median {statistics.median(gaps):.1f})")
print(f"Popular alone misses: {pop_miss/tot:.1%}; gap {statistics.mean(pop_gaps):.1f} (median {statistics.median(pop_gaps):.1f})")
print(f"extra Kit cards highlighted per offer: {kit_cards/tot:.2f}")
