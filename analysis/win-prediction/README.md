# Win prediction from the draft

**Question:** once both ARAM Mayhem teams are locked in, how well does the 5v5 champion draft predict the winner?

**Answer so far (1,081 games, patches 26.1 to 26.22):** a little, and reliably. The best model, a logistic
regression on one feature (the sum of each champion's patch-wide win rate, as log-odds, blue minus red), reaches an
out-of-fold **AUC of 0.61** (95% CI 0.58 to 0.65) and **60% accuracy** against a 54% always-blue baseline, with a
permutation-test p of about 0.003. The patch-wide rates, measured on a far larger player base in another region,
carry over to these games with a slope of 0.95 (CI 0.67 to 1.25, so one-to-one). Richer composition features come
close but don't beat it, and per-champion ratings trail: at ~60 appearances per champion, extra parameters add
about as much variance as signal. Full write-up, plots and limits: [`win_prediction.ipynb`](win_prediction.ipynb).

| Model (5-fold CV x 10) | AUC | Accuracy | Log loss | Brier |
|---|---|---|---|---|
| Side only (baseline) | 0.499 | 0.537 | 0.690 | 0.249 |
| **Draft prior, logistic** | **0.614** | **0.603** | **0.671** | **0.239** |
| Team composition, logistic | 0.605 | 0.599 | 0.675 | 0.241 |
| Team composition, gradient boosting | 0.599 | 0.585 | 0.679 | 0.242 |
| Champion identity, logistic | 0.551 | 0.548 | 0.686 | 0.246 |
| Champion identity + draft prior | 0.579 | 0.561 | 0.682 | 0.244 |

## Files

| File | What it does |
|---|---|
| `games.py` | Turns a Mayhem Stats helper archive and/or a shared-games pool export into an anonymous draft table: patch, date, length, five champions a side, augments, result. No ids, names or per-player stats. Standard library only. |
| `winmodel.py` | Features (all blue minus red), models (side-rate baseline, L2 logistic with nested CV for the penalty, small gradient boosting) and evaluation (repeated CV, bootstrap CIs, permutation test, calibration, learning curves, coefficient bootstrap, prior-transfer slope). |
| `win_prediction.ipynb` | The analysis, executed, with aggregate results only. |
| `requirements.txt` | Python packages the notebook needs. |

Inputs from the repo: `data/cn/history/by_patch.csv` (per-patch champion win rate, damage share and tank share
from Tencent's official ARAM Mayhem stats), `data/cn/augments.json` (augment tiers) and the Data Dragon
`champion.json` under `web/public/assets/dd/` (class tags, attack range, damage type).

## Privacy

The game table is personal match history even without names, so it never goes in git. `games.py` writes it to
`~/.cache/deeparam-winmodel/games.json` by default, and `tests/data/test_win_prediction.py` checks that the
draft rows carry no identifiers, that no game table sits in this folder, and that the committed notebook holds
no per-game rows.

## Rerun

```sh
pip install -r analysis/win-prediction/requirements.txt

# Any mix of helper archives and pool exports; the same game from two sources counts once.
npx wrangler d1 execute deeparam-games --remote --json \
  --command "SELECT data FROM games WHERE queue = 2400" > /tmp/pool.json
python3 analysis/win-prediction/games.py ~/Downloads/mayhem-backup.json /tmp/pool.json

cd analysis/win-prediction
jupyter nbconvert --to notebook --execute --inplace win_prediction.ipynb
```

`WINMODEL_GAMES=/path/to/games.json` points the notebook at another table. A full run takes about three minutes.
