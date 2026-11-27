# Public app highlights vs the strongest card (2026-11-27)

`sim.py` checks the Riot-friendly augment offer (Popular = most-taken card on offer, Kit = hand-checked kit
interaction above a pick-rate floor) against the card with the best DeepScore, on every 3-card offer from each
champion's pool per rarity (7.58 million offers, augment-picks.json for 16.23, first offer so no Combo).

| Rule | Misses the best-DeepScore card | Gap when it misses (DeepScore) |
| --- | --- | --- |
| Popular + Kit, floor 0.25 or 0.5 | 45.6% | 13.3 mean, 11.0 median |
| Popular alone | 45.7% | 13.3 mean, 11.0 median |

Kit adds almost nothing on a first offer (86 interactions over 66 champions). Within a champion and rarity, pick
rate and DeepScore agree only moderately (Spearman 0.48 median over 519 champion-rarity pools with 8+ augments).
Uniform offers are an assumption: real offers may weigh some augments more.
