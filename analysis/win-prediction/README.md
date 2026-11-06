# Win prediction from the draft

**Question:** once both ARAM Mayhem teams are locked in, how well does the 5v5 champion draft predict the winner?

**Answer so far (774 games, patches 26.3 to 26.22):** a little, and reliably. The best model, a logistic
regression on one feature (the sum of each champion's patch-wide win rate, as log-odds, blue minus red), reaches an
out-of-fold **AUC of 0.60** (95% CI 0.56 to 0.64) and **58% accuracy** against a 55% always-blue baseline, with a
permutation-test p of about 0.003. The patch-wide rates, measured on a far larger player base in another region,
carry over to these games with a slope of 0.83 (CI 0.52 to 1.17, so consistent with one-to-one). Richer
composition features and per-champion ratings did worse: at ~45 appearances per champion, extra parameters add
more variance than signal. Full write-up, plots and limits: [`win_prediction.ipynb`](win_prediction.ipynb).

| Model (5-fold CV x 10) | AUC | Accuracy | Log loss | Brier |
|---|---|---|---|---|
| Side only (baseline) | 0.497 | 0.550 | 0.688 | 0.247 |
| **Draft prior, logistic** | **0.598** | **0.584** | **0.674** | **0.240** |
| Team composition, logistic | 0.562 | 0.578 | 0.683 | 0.245 |
| Team composition, gradient boosting | 0.565 | 0.562 | 0.694 | 0.249 |
| Champion identity, logistic | 0.521 | 0.548 | 0.688 | 0.247 |
| Champion identity + draft prior | 0.542 | 0.555 | 0.685 | 0.246 |

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
