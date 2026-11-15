""""Did we call it?": how the pre-patch forecast did once each patch went live.

Two steps, both run daily by build.py after patch_forecast.py:
- snapshot(): while a patch is still on the test server, freeze the forecast for it in
  data/analysis/forecast_snapshots/<patch>.json. The file is rewritten while the PBE changes move, and never
  again once the patch is live (live in the PBE tracker, or in the stats), so the score is against what was
  said before anyone played it.
- build(): for every snapshot whose patch has at least MIN_DAYS of stats, measure each forecast champion the
  same way patch_impact.py does (its win-rate change minus the mean change of the champions nobody touched)
  and compare. Reported per patch and pooled over all patches: the typical miss (mean absolute error) against
  the "no change" guess, how often the direction was right, and calibration (how often the real shift landed
  inside the 50% and 95% ranges, against 50% and 95%). Output: data/analysis/forecast_scorecard.json.
"""
from __future__ import annotations

import json
import re

import common as c

SNAPSHOTS = None  # data/analysis/forecast_snapshots; tests point it elsewhere
MIN_DAYS = 7
Z50, Z95 = 0.674, 1.96


def patch_of(build: str | None) -> str | None:
    """"16.23.8384656" -> "16.23"."""
    m = re.match(r"^(\d+)\.(\d+)", build or "")
    return f"{m.group(1)}.{m.group(2)}" if m else None


def snapshot_dir():
    return SNAPSHOTS or c.OUT / "forecast_snapshots"


def _key(patch: str) -> tuple[int, int]:
    a, b = patch.split(".")
    return int(a), int(b)


def snapshot() -> str | None:
    """Freeze the current PBE forecast under its patch; returns the patch written, or None."""
    try:
        with open(c.OUT / "patch_forecast.json", encoding="utf-8") as f:
            fc = json.load(f)
    except OSError:
        return None
    pbe, model = fc.get("pbe"), fc.get("model") or {}
    target = patch_of(pbe and pbe.get("build"))
    live = patch_of(pbe and pbe.get("live"))
    if not pbe or not pbe.get("entries") or not target or not model.get("cv_rmse_pts"):
        return None
    if live and _key(live) >= _key(target):
        return None  # the patch is already live: its forecast stays frozen
    if target in {p["patch"] for p in c.patches()}:
        return None
    path = snapshot_dir() / f"{target}.json"
    body = {
        "patch": target,
        "build": pbe.get("build"),
        "pbeDataAsOf": pbe.get("dataAsOf"),
        "model": {k: model.get(k) for k in ("n", "patches", "cv_mae_pts", "cv_rmse_pts", "baseline_no_change_mae_pts")},
        "entries": [{k: e[k] for k in ("name", "alias", "display", "tag", "predicted_pts", "range_pts")} for e in pbe["entries"] if e.get("alias")],
    }
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
        if {k: v for k, v in old.items() if k != "taken"} == body:
            return None
    except (OSError, ValueError):
        pass
    c.write_json(path, {"taken": c.now_iso(), **body})
    return target


def snapshots() -> list[dict]:
    out = []
    for path in sorted(snapshot_dir().glob("*.json")):
        with open(path, encoding="utf-8") as f:
            out.append(json.load(f))
    return sorted(out, key=lambda s: _key(s["patch"]))


def score(snap: dict, now: dict, before: dict, shipped: dict[str, list[str]]) -> dict | None:
    forecast = {e["alias"]: e for e in snap["entries"]}
    deltas = {a: now[a]["win_rate"] - before[a]["win_rate"] for a in now if a in before}
    control = [d for a, d in deltas.items() if a not in forecast and a not in shipped]
    if len(control) < 20:
        return None
    ctrl_mean, ctrl_sd = c.mean(control), c.sd(control)
    rmse = snap["model"]["cv_rmse_pts"]
    rows = []
    for alias, e in forecast.items():
        if alias not in deltas:
            continue
        measured = 100 * (deltas[alias] - ctrl_mean)
        pred = e["predicted_pts"]
        rows.append(
            {
                "alias": alias,
                "name": e["display"],
                "tag": e["tag"],
                "predicted_pts": pred,
                "measured_pts": round(measured, 2),
                "miss_pts": round(abs(measured - pred), 2),
                "in50": abs(measured - pred) <= Z50 * rmse,
                "in95": abs(measured - pred) <= Z95 * rmse,
                "direction": None if pred == 0 or measured == 0 else (pred > 0) == (measured > 0),
                "shipped": alias in shipped if shipped else None,
            }
        )
    if not rows:
        return None
    rows.sort(key=lambda r: -abs(r["measured_pts"]))
    return {"control": {"n": len(control), "sd_pts": round(100 * ctrl_sd, 2)}, "rmse_pts": rmse, "champions": rows}


def summary(rows: list[dict]) -> dict:
    mae = c.mean(r["miss_pts"] for r in rows)
    base = c.mean(abs(r["measured_pts"]) for r in rows)
    called = [r["direction"] for r in rows if r["direction"] is not None]
    return {
        "n": len(rows),
        "mae_pts": round(mae, 2),
        "no_change_mae_pts": round(base, 2),
        "skill": round(1 - mae / base, 3) if base else None,  # share of the no-change miss the forecast removed
        "beat_no_change": mae < base,
        "direction": {"right": sum(called), "of": len(called)},
        "in50": round(c.mean(1.0 if r["in50"] else 0.0 for r in rows), 3),
        "in95": round(c.mean(1.0 if r["in95"] else 0.0 for r in rows), 3),
    }


def build() -> dict:
    order = [p["patch"] for p in c.patches()]
    days = {p["patch"]: p["days"] for p in c.patches()}
    by_patch = c.by_patch()
    notes = c.patch_notes()
    scored, waiting = [], []
    for snap in snapshots():
        patch = snap["patch"]
        if patch not in order or order.index(patch) == 0:
            waiting.append({"patch": patch, "day": 0, "of": MIN_DAYS, "champions": len(snap["entries"])})
            continue
        if days.get(patch, 0) < MIN_DAYS:
            waiting.append({"patch": patch, "day": days.get(patch, 0), "of": MIN_DAYS, "champions": len(snap["entries"])})
            continue
        i = order.index(patch)
        s = score(snap, by_patch.get(patch, {}), by_patch.get(order[i - 1], {}), notes.get(patch, {}))
        if not s:
            continue
        scored.append({"patch": patch, "prev": order[i - 1], "days": days[patch], "final": i < len(order) - 1, "taken": snap["taken"], **s, "summary": summary(s["champions"])})
    scored.reverse()  # newest first
    pooled = summary([r for p in scored for r in p["champions"]]) if scored else None
    return {"built": c.now_iso(), "min_days": MIN_DAYS, "patches": scored, "pooled": pooled, "waiting": waiting}


if __name__ == "__main__":
    wrote = snapshot()
    data = build()
    c.write_json(c.OUT / "forecast_scorecard.json", data)
    print(f"snapshot: {wrote or 'unchanged'}; scored {len(data['patches'])}, waiting {[w['patch'] for w in data['waiting']]}")
    for p in data["patches"]:
        print(p["patch"], p["summary"])
