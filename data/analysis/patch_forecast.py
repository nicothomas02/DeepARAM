"""Pre-patch forecast: what a listed champion change should do to its win rate, before it ships.

Training rows are the champion changes measured by patch_impact.py (effect in win-rate points) with the parsed
change sizes as features (log-ratio per Mayhem modifier, summed ability changes, number of lines). The model is
ridge regression; the penalty is chosen by leave-one-patch-out cross-validation, and the error is reported
against two baselines, "no change" (0) and "the average effect of a buff or a nerf". The prediction interval is
the cross-validated residual spread. The fitted model is then applied to the PBE change tracker's champion
entries, so the PBE tab can show an expected shift with its range. Output: data/analysis/patch_forecast.json.
"""
from __future__ import annotations

import json
import math

import common as c

FEATURES = list(c.DOSE_KEYS) + ["lines"]


def training_rows() -> list[dict]:
    try:
        with open(c.OUT / "patch_impact.json", encoding="utf-8") as f:
            impact = json.load(f)
    except OSError:
        return []
    rows = []
    for p in impact.get("patches", []):
        for ch in p["champions"]:
            d = ch["dose"]
            if not d.get("parsed"):
                continue
            rows.append({"patch": p["patch"], "alias": ch["alias"], "x": [d[k] for k in c.DOSE_KEYS] + [float(d["lines"])], "y": ch["effect"], "intent": d["intent"]})
    return rows


def cross_validate(rows: list[dict], lam: float) -> tuple[float, float, list[float]]:
    """Leave one patch out: MAE, RMSE and the out-of-sample residuals."""
    res = []
    for patch in sorted({r["patch"] for r in rows}):
        train = [r for r in rows if r["patch"] != patch]
        test = [r for r in rows if r["patch"] == patch]
        if len(train) < 8:
            continue
        coef = c.ridge([r["x"] for r in train], [r["y"] for r in train], lam)
        res.extend(r["y"] - c.predict(coef, r["x"]) for r in test)
    mae = c.mean(abs(e) for e in res)
    rmse = math.sqrt(c.mean(e * e for e in res)) if res else 0.0
    return mae, rmse, res


def build() -> dict:
    rows = training_rows()
    if len(rows) < 15:
        return {"built": c.now_iso(), "model": {"n": len(rows)}, "pbe": None}
    best = None
    for lam in (0.0, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0):
        mae, rmse, res = cross_validate(rows, lam)
        if best is None or mae < best[1]:
            best = (lam, mae, rmse)
    lam, mae, rmse = best
    base_zero = c.mean(abs(r["y"]) for r in rows)
    means = {}
    for intent in ("buff", "nerf", "unclear"):
        ys = [r["y"] for r in rows if r["intent"] == intent]
        means[intent] = c.mean(ys) if ys else 0.0
    # Baseline 2: the average effect of a buff or a nerf, also leave-one-patch-out.
    res2 = []
    for patch in sorted({r["patch"] for r in rows}):
        train = [r for r in rows if r["patch"] != patch]
        m = {i: c.mean(r["y"] for r in train if r["intent"] == i) if any(r["intent"] == i for r in train) else 0.0 for i in ("buff", "nerf", "unclear")}
        res2.extend(r["y"] - m[r["intent"]] for r in rows if r["patch"] == patch)
    base_sign = c.mean(abs(e) for e in res2)
    coef = c.ridge([r["x"] for r in rows], [r["y"] for r in rows], lam)
    model = {
        "n": len(rows),
        "patches": len({r["patch"] for r in rows}),
        "lambda": lam,
        "cv_mae_pts": round(100 * mae, 2),
        "cv_rmse_pts": round(100 * rmse, 2),
        "baseline_no_change_mae_pts": round(100 * base_zero, 2),
        "baseline_buff_or_nerf_mae_pts": round(100 * base_sign, 2),
        "coefficients": {k: round(100 * v, 3) for k, v in zip(["intercept"] + FEATURES, coef)},
        "features": FEATURES,
    }
    return {"built": c.now_iso(), "model": model, "pbe": forecast_pbe(coef, rmse)}


def forecast_pbe(coef: list[float], rmse: float) -> dict | None:
    try:
        with open(c.ROOT / "data" / "pbe" / "tracker.json", encoding="utf-8") as f:
            tracker = json.load(f)
    except OSError:
        return None
    lookup = c.alias_lookup()
    names = c.champion_names()
    entries = []
    for e in tracker.get("entries", []):
        if e.get("kind") != "champion":
            continue
        alias = c.to_alias(e.get("name", ""), lookup)
        lines = [l["text"] if isinstance(l, dict) else str(l) for l in e.get("lines", [])]
        d = c.dose(lines)
        if not d["parsed"]:
            continue
        x = [d[k] for k in c.DOSE_KEYS] + [float(d["lines"])]
        pred = c.predict(coef, x)
        entries.append(
            {
                "name": e.get("name"),
                "alias": alias,
                "display": names.get(alias, e.get("name")) if alias else e.get("name"),
                "tag": e.get("tag"),
                "predicted_pts": round(100 * pred, 2),
                "range_pts": [round(100 * (pred - 1.96 * rmse), 2), round(100 * (pred + 1.96 * rmse), 2)],
                "parsed": d["parsed"],
                "lines": d["lines"],
            }
        )
    entries.sort(key=lambda x: -abs(x["predicted_pts"]))
    return {"build": tracker.get("builds", {}).get("pbe"), "live": tracker.get("builds", {}).get("live"), "dataAsOf": tracker.get("dataAsOf"), "entries": entries}


if __name__ == "__main__":
    data = build()
    c.write_json(c.OUT / "patch_forecast.json", data)
    print(json.dumps(data["model"], indent=1))
    if data.get("pbe"):
        for e in data["pbe"]["entries"]:
            print(f"  {e['display']:14} {e['tag']:5} {e['predicted_pts']:+.2f} pts [{e['range_pts'][0]:+.1f}, {e['range_pts'][1]:+.1f}] ({e['parsed']}/{e['lines']} lines)")
