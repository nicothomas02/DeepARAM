"""Features, models and evaluation for the ARAM Mayhem win-prediction notebook.

The question: once both teams are locked in, how well does the 5v5 champion draft predict who wins?
Everything is written blue-minus-red, so a positive number always favours blue and the model's intercept is the
side advantage.

Needs numpy, pandas and scikit-learn (see requirements.txt). games.py builds the input table.
"""
import csv
import json
import math
import os
import re
from collections import defaultdict

import numpy as np
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import GridSearchCV, RepeatedStratifiedKFold, StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BY_PATCH = os.path.join(ROOT, "data", "cn", "history", "by_patch.csv")
AUGMENTS = os.path.join(ROOT, "data", "cn", "augments.json")
DD_DIR = os.path.join(ROOT, "web", "public", "assets", "dd")
CLASSES = ("Tank", "Fighter", "Assassin", "Mage", "Marksman", "Support")
TIERS = ("Silver", "Gold", "Prismatic")


def official_patch(patch):
    """Client version 16.21 is the patch Riot calls 26.21."""
    major, minor = patch.split(".")[:2]
    return f"{int(major) + 10}.{minor}"


def _patch_key(p):
    a, b = p.split(".")[:2]
    return int(a), int(b)


def logit(p):
    p = min(max(p, 1e-3), 1 - 1e-3)
    return math.log(p / (1 - p))


class Traits:
    """What the model may know about a champion before the game: its server-wide win rate, damage and tank share
    on that patch (large aggregate sample, none of these games in it), and its fixed kit traits."""

    def __init__(self):
        self.by_patch = defaultdict(dict)  # patch -> champ -> row
        with open(BY_PATCH, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                self.by_patch[r["patch"]][int(r["champion_id"])] = {
                    "wr": float(r["win_rate"]), "dmg": float(r["avg_damage_ratio"]), "tank": float(r["avg_tank_ratio"])}
        self.patches = sorted(self.by_patch, key=_patch_key)
        version = max((v for v in os.listdir(DD_DIR) if re.fullmatch(r"\d+\.\d+\.\d+", v)),
                      key=lambda v: tuple(map(int, v.split("."))))
        with open(os.path.join(DD_DIR, version, "data", "en_US", "champion.json"), encoding="utf-8") as f:
            dd = json.load(f)["data"]
        self.kit = {}
        self.names = {}
        for c in dd.values():
            cid = int(c["key"])
            self.names[cid] = c["name"]
            self.kit[cid] = {
                "ranged": c["stats"]["attackrange"] >= 300,
                "magic": c["info"]["magic"] > c["info"]["attack"],
                "class": c["tags"][0] if c["tags"] else "",
                "tags": set(c["tags"]),
            }
        with open(AUGMENTS, encoding="utf-8") as f:
            self.aug_tier = {a["augment_id"]: a.get("tier") for a in json.load(f)["augments"]}

    def stat(self, champ, patch):
        """The champion's patch stats, or the nearest earlier patch that has it (later if none)."""
        if champ in self.by_patch.get(patch, {}):
            return self.by_patch[patch][champ]
        key = _patch_key(patch)
        earlier = [p for p in self.patches if _patch_key(p) <= key and champ in self.by_patch[p]]
        later = [p for p in self.patches if _patch_key(p) > key and champ in self.by_patch[p]]
        if earlier:
            return self.by_patch[earlier[-1]][champ]
        if later:
            return self.by_patch[later[0]][champ]
        return {"wr": 0.5, "dmg": 0.2, "tank": 0.2}


def team_summary(champs, augs, patch, traits):
    """One team's draft as numbers."""
    s = {"prior": 0.0, "dmg": 0.0, "tank": 0.0, "ranged": 0, "magic": 0, **{c: 0 for c in CLASSES}}
    for c in champs:
        st = traits.stat(c, patch)
        kit = traits.kit.get(c, {"ranged": False, "magic": False, "class": "", "tags": set()})
        s["prior"] += logit(st["wr"])
        s["dmg"] += st["dmg"]
        s["tank"] += st["tank"]
        s["ranged"] += kit["ranged"]
        s["magic"] += kit["magic"]
        if kit["class"] in CLASSES:
            s[kit["class"]] += 1
    s["has_frontline"] = int(s["Tank"] + s["Fighter"] > 0)
    s["damage_mix"] = min(s["magic"], 5 - s["magic"])  # 0 = all one damage type, 2 = mixed
    for t in TIERS:
        s[f"aug_{t}"] = sum(traits.aug_tier.get(a) == t for p in augs for a in p)
    s["augs"] = sum(len(p) for p in augs)
    return s


DRAFT_FEATURES = ["prior"]
COMP_FEATURES = ["prior", "dmg", "tank", "ranged", "magic", "damage_mix", "has_frontline", *CLASSES]
AUGMENT_FEATURES = [f"aug_{t}" for t in TIERS]


def design(games, traits):
    """Blue-minus-red team features, champion indicators (+1 blue, -1 red) and labels."""
    rows = []
    for g in games:
        b = team_summary(g["blue"], g["blue_augs"], g["patch"], traits)
        r = team_summary(g["red"], g["red_augs"], g["patch"], traits)
        rows.append({k: b[k] - r[k] for k in b})
    feats = {k: np.array([row[k] for row in rows], dtype=float) for k in rows[0]}
    champs = sorted({c for g in games for c in g["blue"] + g["red"]})
    col = {c: i for i, c in enumerate(champs)}
    onehot = np.zeros((len(games), len(champs)))
    for i, g in enumerate(games):
        for c in g["blue"]:
            onehot[i, col[c]] += 1
        for c in g["red"]:
            onehot[i, col[c]] -= 1
    y = np.array([g["blue_win"] for g in games], dtype=int)
    return feats, onehot, champs, y


def matrix(feats, names):
    return np.column_stack([feats[n] for n in names])


# ---------- models ----------

C_GRID = np.logspace(-3, 1, 9)  # inverse L2 strength; small C = strong shrinkage toward "no effect"

class SideRate:
    """Baseline: every game gets the training blue-side win rate."""

    def fit(self, X, y):
        self.p = (y.sum() + 1) / (len(y) + 2)
        return self

    def predict_proba(self, X):
        return np.column_stack([np.full(len(X), 1 - self.p), np.full(len(X), self.p)])

    def get_params(self, deep=False):
        return {}

    def set_params(self, **_):
        return self


def logistic(cv_c=True):
    """L2 logistic regression; the penalty is picked by an inner 5-fold CV on log loss."""
    pipe = make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=5000))
    if not cv_c:
        return pipe
    return GridSearchCV(pipe, {"logisticregression__C": C_GRID}, cv=5, scoring="neg_log_loss")


def boosting(seed=0):
    """Small, heavily regularised gradient boosting: few shallow trees, so 800 games don't get memorised."""
    return HistGradientBoostingClassifier(max_depth=2, learning_rate=0.05, max_iter=150, min_samples_leaf=40,
                                          l2_regularization=1.0, random_state=seed)


# ---------- evaluation ----------

def scores(y, p):
    return {"auc": roc_auc_score(y, p), "accuracy": accuracy_score(y, p > 0.5),
            "log_loss": log_loss(y, p, labels=[0, 1]), "brier": brier_score_loss(y, p)}


def out_of_fold(model, X, y, splits=5, repeats=10, seed=0):
    """Out-of-fold probabilities for each repeat of k-fold CV (repeats x games)."""
    rskf = RepeatedStratifiedKFold(n_splits=splits, n_repeats=repeats, random_state=seed)
    probs = np.zeros((repeats, len(y)))
    for i, (tr, te) in enumerate(rskf.split(X, y)):
        m = clone(model) if not isinstance(model, SideRate) else SideRate()
        m.fit(X[tr], y[tr])
        probs[i // splits, te] = m.predict_proba(X[te])[:, 1]
    return probs


def summarise(y, probs, boot=1000, seed=0):
    """Mean score over CV repeats, plus a bootstrap 95% interval over games for the repeat-averaged predictions."""
    per_repeat = [scores(y, p) for p in probs]
    mean = {k: float(np.mean([s[k] for s in per_repeat])) for k in per_repeat[0]}
    p = probs.mean(axis=0)
    rng = np.random.default_rng(seed)
    draws = defaultdict(list)
    for _ in range(boot):
        idx = rng.integers(0, len(y), len(y))
        if y[idx].min() == y[idx].max():
            continue
        for k, v in scores(y[idx], p[idx]).items():
            draws[k].append(v)
    ci = {k: (float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))) for k, v in draws.items()}
    return mean, ci


def permutation_auc(model, X, y, n=200, seed=0):
    """How often a model trained on shuffled results scores at least as well (one 5-fold pass each)."""
    rng = np.random.default_rng(seed)
    real = roc_auc_score(y, out_of_fold(model, X, y, repeats=1, seed=seed)[0])
    null = []
    for i in range(n):
        ys = rng.permutation(y)
        null.append(roc_auc_score(ys, out_of_fold(model, X, ys, repeats=1, seed=seed + i + 1)[0]))
    null = np.array(null)
    return real, null, float((1 + (null >= real).sum()) / (1 + n))


def reliability(y, p, bins=8):
    """Calibration table on equal-count bins: mean prediction vs observed blue win rate (with Wilson 95%)."""
    order = np.argsort(p)
    out = []
    for chunk in np.array_split(order, bins):
        n, k = len(chunk), int(y[chunk].sum())
        lo, hi = wilson(k, n)
        out.append({"n": n, "predicted": float(p[chunk].mean()), "observed": k / n, "lo": lo, "hi": hi})
    return out


def wilson(k, n, z=1.96):
    if n == 0:
        return 0.0, 1.0
    ph = k / n
    d = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / d
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


def learning_curve(model, X, y, sizes, repeats=20, seed=0):
    """AUC on held-out games when training on n games, for each n in sizes (mean and 10th-90th percentile)."""
    rng = np.random.default_rng(seed)
    out = []
    for n in sizes:
        aucs = []
        for r in range(repeats):
            skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=int(rng.integers(1e9)))
            tr, te = next(iter(skf.split(X, y)))
            tr = rng.choice(tr, size=min(n, len(tr)), replace=False)
            m = clone(model) if not isinstance(model, SideRate) else SideRate()
            m.fit(X[tr], y[tr])
            aucs.append(roc_auc_score(y[te], m.predict_proba(X[te])[:, 1]))
        out.append({"n": n, "auc": float(np.mean(aucs)), "p10": float(np.percentile(aucs, 10)),
                    "p90": float(np.percentile(aucs, 90))})
    return out


def bootstrap_coefs(X, y, names, boot=500, C=None, seed=0):
    """Standardised logistic coefficients with bootstrap 95% intervals."""
    scaler = StandardScaler().fit(X)
    Xs = scaler.transform(X)
    if C is None:
        C = logistic().fit(X, y).best_params_["logisticregression__C"]
    base = LogisticRegression(C=C, max_iter=5000).fit(Xs, y)
    rng = np.random.default_rng(seed)
    draws = []
    for _ in range(boot):
        idx = rng.integers(0, len(y), len(y))
        draws.append(LogisticRegression(C=C, max_iter=5000).fit(Xs[idx], y[idx]).coef_[0])
    draws = np.array(draws)
    return [{"feature": n, "coef": float(base.coef_[0][i]), "lo": float(np.percentile(draws[:, i], 2.5)),
             "hi": float(np.percentile(draws[:, i], 97.5))} for i, n in enumerate(names)], C


def prior_slope(prior, y, boot=1000, seed=0):
    """Unpenalised logistic fit of the result on the summed draft prior: slope 1 = the patch-wide win rates carry
    over one-to-one. Also the side advantage at an even draft, with bootstrap 95% intervals."""
    X = np.asarray(prior, dtype=float).reshape(-1, 1)

    def fit(idx):
        m = LogisticRegression(C=1e6, max_iter=5000).fit(X[idx], y[idx])
        return m.coef_[0][0], m.intercept_[0]

    def pp(b0):
        return 100 * (1 / (1 + math.exp(-b0)) - 0.5)

    b1, b0 = fit(np.arange(len(y)))
    rng = np.random.default_rng(seed)
    draws = np.array([fit(rng.integers(0, len(y), len(y))) for _ in range(boot)])
    lo, hi = np.percentile(draws, [2.5, 97.5], axis=0)
    sd = float(X.std())
    return {"slope": float(b1), "slope_ci": (float(lo[0]), float(hi[0])), "intercept": float(b0),
            "side_pp": pp(b0), "side_pp_ci": (pp(lo[1]), pp(hi[1])), "sd": sd,
            "one_sd_pp": 100 * (1 / (1 + math.exp(-(b0 + b1 * sd))) - 1 / (1 + math.exp(-b0)))}
