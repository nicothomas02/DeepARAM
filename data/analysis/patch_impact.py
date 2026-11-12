"""Patch-change impact: did each champion change in the Mayhem patch notes move that champion's win rate?

Method (difference in differences). For a patch P with notes, a changed champion's win rate change is its final
win rate on P minus its final win rate on the patch before, and the same change for every champion the notes
did not touch is the control. The effect is the champion's change minus the control group's mean change, so
meta-wide drift (new augments, item changes) is removed. Two kinds of uncertainty are reported:
- se: binomial noise from the two patches' estimated sample sizes (pick rate x estimated games).
- z: the effect against the spread of the control champions' changes (a placebo test): an unchanged champion
  typically moves by that much from one patch to the next for no reason, so only effects outside that spread
  count as "worked".

Dose-response: an ordinary least squares fit of the effect on the parsed change sizes (log-ratio of each Mayhem
modifier, summed ability changes), with bootstrap intervals, so the site can say what a 5% damage modifier is
worth in win-rate points. Output: data/analysis/patch_impact.json.
"""
from __future__ import annotations

import math
import random

import common as c


Z95 = 1.96
NOISE_Z = 1.96  # a placebo z beyond this counts as a real move


def build() -> dict:
    patches = c.patches()
    by_patch = c.by_patch()
    notes = c.patch_notes()
    names = c.champion_names()
    per_day = c.games_per_day()
    order = [p["patch"] for p in patches]
    days = {p["patch"]: p["days"] for p in patches}
    out_patches = []
    rows = []  # for the dose-response fit
    control_sds = []
    for i, patch in enumerate(order):
        if i == 0 or patch not in notes or not notes[patch]:
            continue
        prev = order[i - 1]
        now, before = by_patch.get(patch, {}), by_patch.get(prev, {})
        changed = notes[patch]
        deltas = {a: now[a]["win_rate"] - before[a]["win_rate"] for a in now if a in before}
        control = [d for a, d in deltas.items() if a not in changed]
        if len(control) < 20:
            continue
        ctrl_mean, ctrl_sd = c.mean(control), c.sd(control)
        control_sds.append(ctrl_sd)
        champs = []
        for alias, lines in sorted(changed.items()):
            if alias not in deltas:
                continue
            d = c.dose(lines)
            n_now = now[alias]["pick_rate"] * per_day * max(days.get(patch, 1), 1)
            n_before = before[alias]["pick_rate"] * per_day * max(days.get(prev, 1), 1)
            effect = deltas[alias] - ctrl_mean
            se = math.sqrt(
                c.binomial_se(now[alias]["win_rate"], n_now) ** 2
                + c.binomial_se(before[alias]["win_rate"], n_before) ** 2
                + (ctrl_sd ** 2) / len(control)
            )
            z = effect / ctrl_sd if ctrl_sd > 0 else 0.0
            if abs(z) < NOISE_Z:
                verdict = "noise"
            elif d["intent"] == "unclear":
                verdict = "moved"
            elif (effect > 0) == (d["intent"] == "buff"):
                verdict = "worked"
            else:
                verdict = "opposite"
            row = {
                "alias": alias,
                "name": names.get(alias, alias),
                "before": round(before[alias]["win_rate"], 4),
                "after": round(now[alias]["win_rate"], 4),
                "delta": round(deltas[alias], 4),
                "effect": round(effect, 4),
                "se": round(se, 4),
                "ci": [round(effect - Z95 * se, 4), round(effect + Z95 * se, 4)],
                "z": round(z, 2),
                "verdict": verdict,
                "dose": d,
                "lines": lines,
            }
            champs.append(row)
            if d["parsed"]:
                rows.append((patch, alias, [d[k] for k in c.DOSE_KEYS], effect))
        out_patches.append(
            {
                "patch": patch,
                "prev": prev,
                "control": {"n": len(control), "mean": round(ctrl_mean, 4), "sd": round(ctrl_sd, 4)},
                "champions": sorted(champs, key=lambda r: -abs(r["z"])),
            }
        )
    out_patches.reverse()  # newest first
    return {
        "built": c.now_iso(),
        "method": "difference in differences against the champions the notes did not touch; z is the effect over the control spread",
        "patches": out_patches,
        "placebo_sd": round(c.mean(control_sds), 4) if control_sds else None,
        "dose_response": dose_response(rows),
    }


def dose_response(rows: list[tuple]) -> dict:
    """Effect ~ intercept + modifier log-ratios + ability changes, OLS with 1,000 bootstrap resamples."""
    if len(rows) < 10:
        return {"n": len(rows)}
    X = [r[2] for r in rows]
    y = [r[3] for r in rows]
    coef = c.ridge(X, y, 0.0)
    pred = [c.predict(coef, x) for x in X]
    ss_res = sum((a - b) ** 2 for a, b in zip(y, pred))
    ss_tot = sum((a - c.mean(y)) ** 2 for a in y) or 1.0
    rng = random.Random(7)
    boots = []
    for _ in range(1000):
        idx = [rng.randrange(len(rows)) for _ in rows]
        boots.append(c.ridge([X[i] for i in idx], [y[i] for i in idx], 0.0))
    keys = ["intercept"] + list(c.DOSE_KEYS)
    out = {}
    for j, key in enumerate(keys):
        vals = sorted(b[j] for b in boots)
        lo, hi = vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]
        scale = 1.0 if key == "intercept" else math.log(1.05)  # per +5% modifier (or 5% ability change)
        out[key] = {
            "pts_per_5pct": round(100 * coef[j] * scale, 2),
            "ci": [round(100 * lo * scale, 2), round(100 * hi * scale, 2)],
        }
    buffs = [r[3] for r in rows if sum(r[2]) > 0]
    nerfs = [r[3] for r in rows if sum(r[2]) < 0]
    return {
        "n": len(rows),
        "r2": round(1 - ss_res / ss_tot, 3),
        "coefficients": out,
        "buffs": {"n": len(buffs), "mean_effect": round(100 * c.mean(buffs), 2), "share_positive": round(c.mean(1.0 if b > 0 else 0.0 for b in buffs), 2) if buffs else None},
        "nerfs": {"n": len(nerfs), "mean_effect": round(100 * c.mean(nerfs), 2), "share_negative": round(c.mean(1.0 if b < 0 else 0.0 for b in nerfs), 2) if nerfs else None},
    }


if __name__ == "__main__":
    data = build()
    c.write_json(c.OUT / "patch_impact.json", data)
    print(f"patch_impact.json: {sum(len(p['champions']) for p in data['patches'])} champion changes over {len(data['patches'])} patches")
    for p in data["patches"]:
        for r in p["champions"][:3]:
            print(f"  {p['patch']} {r['name']:12} {r['before']:.3f}->{r['after']:.3f} effect {100*r['effect']:+.1f} pts z {r['z']:+.1f} {r['verdict']} ({r['dose']['intent']})")
    print("dose-response:", data["dose_response"])
