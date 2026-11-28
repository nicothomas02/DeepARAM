# Full build path: method benchmark (2026-11-28)

Nico asked whether the full six-item path can be extrapolated slot by slot the way lolalytics does, and whether
other methods might work better. `benchmark.py` tests 8 methods on public inputs: AramHex 16.23 singles and
ordered cores, plus 101's top-10 six-item builds. The held-out data is the owner archive (1,257 games, all ten
players, 8,000+ player rows with 4+ legendaries). Every method gets the same core and differs only in how it fills
the later slots.

| Method | Reconstructs a hidden top real build (Jaccard, 61 champions) | Followers' win rate vs current, pp (champion bootstrap) | Path is a real build |
|---|---|---|---|
| real_full (today) | 0.48 | 0 | 84% |
| shrunk (real builds shrunk toward their items) | 0.48 | +0.2 ± 0.4 | 84% |
| chain (item N given 1..N-1, lolalytics-style) | **0.65** | -2.5 ± 1.5 | 81% |
| chain_wr (chain, best win rate among likely next items) | 0.42 | -0.7 ± 1.6 | 59% |
| popular (most-held singles) | 0.67 | -2.2 ± 1.5 | 55% |
| best_wr (per-slot best win rate) | 0.05 | +2.7 ± 4.0 | 2% |
| cooc (single score + co-occurrence PMI) | 0.05 | +0.1 ± 3.5 | 3% |
| beam (beam search over cooc) | 0.06 | 0.0 ± 3.5 | 6% |

Reading (correlational; the archive is small):
- Chaining predicts what players actually finish with best (0.65 against 0.48), but players who follow its path don't
  win more. If anything they win slightly less (-2.5 ± 1.5 pp), since chaining follows popularity.
- No method beats today's real-build path on outcomes beyond noise. Co-occurrence and beam search pick rare
  high-win-rate items, which few players follow, so their outcome estimates are very wide.
- Champions with no real build holding the core (28) or a top real build under 1% of games (14) have too few archive
  players to separate methods (under 60 followers each).
- Verdict: the path method is unchanged. Retest at about 3x the archive.

`../type-switch/style_cutoff.py`: no data-picked cutoff for the build switch. Below a 12% style share, continuing
and reverting win within noise in every bucket (n 18 to 158 per arm).
