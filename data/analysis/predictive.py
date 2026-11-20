"""Fitted DeepScore settings and next-patch ranges: how much to trust a win rate, judged by what happens next.

DeepScore (web/src/lib/deepscore.ts) used hand-set settings: a win rate was pulled toward the list's average by a
prior worth a quarter of a median pick's games, older patches counted half as much as the next newer one, and the
"±" range on a win rate was its sampling range alone. This analysis replaces the guesses with values fitted to the
question the site actually answers for a player: what will this pick win next?

Model (one per list: champions, augments within a rarity, a champion's starting items or boots):
    x    the win rate (champions: over every patch so far, each older patch's games weighted by r per patch back)
    m    the list's average win rate (each entry counts once)
    n    the entry's pick rate over the list's median pick rate
    est  = m + b * n / (n + k) * (x - m)        expected win rate next patch
    sd   = sqrt(s0^2 + s1^2 / n)                 typical miss of est, from past misses (drift plus sampling)
    q50, q80, q95                                multiples of sd that held 50/80/95% of past misses
b is how much of a lead carries over to the next patch, k how much less a rarely picked entry's lead carries
over, r how fast older patches fade. They are fitted by grid search on past patch-to-patch transitions.

Backtest (champions; 24 transitions since 15.21). Rolling origin: for each test transition, the settings are
fitted only on the transitions before it, then scored on the next patch's final win rates. Compared against
  current    the old hand-set DeepScore estimate (k = 0.25, this patch only)
  no_change  this patch's win rate as is
Scores: RMSE / MAE in win-rate points, Spearman rank correlation with next patch, share of champions whose
predicted tier matches next patch's tier (same z-score cuts as the site), and how often the next patch's win
rate landed inside the 50/80/95% ranges. The old sampling-only 95% range (Wilson, from estimated games) is
scored the same way, which is why the site switches to the calibrated range.

Augments and items only have per-patch history since 16.20, so their settings are fitted on both available
transitions and scored leave-one-transition-out. Augment win rates stay off the site (Riot policy); only the
settings and their backtest errors are published.

Outputs:
  data/analysis/predictive.json     settings, backtests and the live patch's champion projections
  web/src/data/deepscore-fit.json   the settings alone, imported by lib/deepscore.ts (client and server)
Standard library only.
"""
from __future__ import annotations

import csv
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c  # noqa: E402

FIT_OUT = c.ROOT / "web" / "src" / "data" / "deepscore-fit.json"

# Site defaults before this analysis (kept for the "current" baseline).
OLD_K = 0.25
OLD_R = 0.5

# Same tier cuts as web/src/lib/deepscore.ts (TIER_Z).
TIER_Z = [("S", 1.35), ("A", 0.6), ("B", -0.4), ("C", -1.2), ("D", -math.inf)]
QUANTS = (0.5, 0.8, 0.95)
MIN_TRAIN = 6  # transitions needed before a champion test transition is scored
MIN_DAYS = 7  # a patch needs this many days of stats to count as complete

GRID_B = [round(0.5 + 0.05 * i, 2) for i in range(13)]  # 0.5 .. 1.1
GRID_K = [0.0, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0]
GRID_R = [0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75]


# ---------- shared maths ----------

def median(xs: list[float]) -> float:
    s = sorted(xs)
    return s[len(s) // 2] if s else 1.0


def spearman(a: list[float], b: list[float]) -> float:
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for t in range(i, j + 1):
                r[order[t]] = (i + j) / 2
            i = j + 1
        return r
    ra, rb = ranks(a), ranks(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return num / den if den else 0.0


def tiers(values: list[float]) -> list[str]:
    m = sum(values) / len(values)
    sd = math.sqrt(sum((v - m) ** 2 for v in values) / len(values)) or 1.0
    return [next(t for t, z in TIER_Z if (v - m) / sd >= z) for v in values]


def wilson_half(p: float, n: float, z: float = 1.96) -> float:
    if n <= 0:
        return 0.5
    d = 1 + z * z / n
    return z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d


def quantile(xs: list[float], q: float) -> float:
    s = sorted(xs)
    if not s:
        return 0.0
    pos = q * (len(s) - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


# A "case" is one list at one time: entries with their current value x, relative pick n, and next-patch outcome y.
# cases: list of lists of dicts {x, n, y?, key}

def predict(case: list[dict], b: float, k: float) -> list[float]:
    m = sum(e["x"] for e in case) / len(case)
    return [m + b * (e["n"] / (e["n"] + k) if k else 1.0) * (e["x"] - m) for e in case]


def sse(cases: list[list[dict]], b: float, k: float) -> float:
    tot = 0.0
    for case in cases:
        for e, p in zip(case, predict(case, b, k)):
            tot += (e["y"] - p) ** 2
    return tot


def fit_bk(cases: list[list[dict]]) -> tuple[float, float]:
    best = min(((sse(cases, b, k), b, k) for b in GRID_B for k in GRID_K))
    return best[1], best[2]


def fit_spread(cases: list[list[dict]], b: float, k: float) -> dict:
    """sd^2 = s0^2 + s1^2 / n by least squares on squared misses, then the |miss|/sd quantiles."""
    xs, ys = [], []
    for case in cases:
        for e, p in zip(case, predict(case, b, k)):
            xs.append(1 / max(e["n"], 1e-3))
            ys.append((e["y"] - p) ** 2)
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    vx = sum((x - mx) ** 2 for x in xs)
    slope = max(0.0, sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / vx) if vx else 0.0
    icpt = my - slope * mx
    if icpt <= 0:  # keep a floor: refit as a pure constant spread
        slope, icpt = 0.0, my
    s0, s1 = math.sqrt(icpt), math.sqrt(slope)
    zs = []
    for case in cases:
        for e, p in zip(case, predict(case, b, k)):
            zs.append(abs(e["y"] - p) / max(math.sqrt(s0 * s0 + s1 * s1 / max(e["n"], 1e-3)), 1e-9))
    return {"s0": s0, "s1": s1, **{f"q{int(q * 100)}": quantile(zs, q) for q in QUANTS}}


def sd_of(spread: dict, n: float) -> float:
    return math.sqrt(spread["s0"] ** 2 + spread["s1"] ** 2 / max(n, 1e-3))


def score_cases(cases: list[list[dict]], preds: list[list[float]], spreads: list[dict] | None = None) -> dict:
    errs, rhos, agree, total = [], [], 0, 0
    inside = {q: 0 for q in QUANTS}
    for i, (case, pred) in enumerate(zip(cases, preds)):
        ys = [e["y"] for e in case]
        errs += [y - p for y, p in zip(ys, pred)]
        rhos.append(spearman(pred, ys))
        agree += sum(a == b for a, b in zip(tiers(pred), tiers(ys)))
        total += len(case)
        if spreads:
            for e, p in zip(case, pred):
                sd = sd_of(spreads[i], e["n"])
                for q in QUANTS:
                    inside[q] += abs(e["y"] - p) <= spreads[i][f"q{int(q * 100)}"] * sd
    out = {
        "rmse_pts": round(100 * math.sqrt(sum(e * e for e in errs) / len(errs)), 3),
        "mae_pts": round(100 * sum(abs(e) for e in errs) / len(errs), 3),
        "spearman": round(sum(rhos) / len(rhos), 3),
        "tier_match": round(agree / total, 3),
        "n": total,
    }
    if spreads:
        out["coverage"] = {str(int(q * 100)): round(inside[q] / total, 3) for q in QUANTS}
    return out


# ---------- champions ----------

def complete_patches() -> list[dict]:
    return [p for p in c.patches() if p["days"] >= MIN_DAYS]


def champion_case(bp: dict, order: list[str], days: dict[str, int], t: int, r: float, nxt: str | None) -> list[dict]:
    """Champions of patch order[t] with x weighted over order[..t] (r per patch back); y from patch nxt."""
    cur = bp[order[t]]
    case = []
    picks = [row["pick_rate"] for row in cur.values()]
    med = median(picks)
    for name, row in cur.items():
        num = den = 0.0
        for back in range(t + 1):
            past = bp[order[t - back]].get(name)
            if not past:
                continue
            w = past["pick_rate"] * days[order[t - back]] * (r ** back if back else 1.0)
            num += w * past["win_rate"]
            den += w
        e = {"key": name, "x": num / den, "n": row["pick_rate"] / med, "pick": row["pick_rate"],
             "now": row["win_rate"]}
        if nxt is not None:
            y = bp[nxt].get(name)
            if not y:
                continue
            e["y"] = y["win_rate"]
        case.append(e)
    return case


def old_estimate(case: list[dict]) -> list[float]:
    """The old DeepScore estimate: this patch only, pulled toward the games-weighted mean by OLD_K median picks."""
    tot = sum(e["pick"] for e in case)
    m = sum(e["now"] * e["pick"] for e in case) / tot
    return [(e["now"] * e["n"] + m * OLD_K) / (e["n"] + OLD_K) for e in case]


def matches_by_patch() -> dict[str, float]:
    try:
        import json
        with open(c.ROOT / "data" / "stats" / "games.json", encoding="utf-8") as f:
            return {p: v["matches"] for p, v in json.load(f)["patches"].items()}
    except (OSError, KeyError, ValueError):
        return {}


def champions() -> dict:
    bp = c.by_patch()
    pats = [p for p in complete_patches() if p["patch"] in bp]
    order = [p["patch"] for p in pats]
    days = {p["patch"]: p["days"] for p in pats}
    matches = matches_by_patch()

    def cases_for(r: float, ts: range) -> list[list[dict]]:
        return [champion_case(bp, order, days, t, r, order[t + 1]) for t in ts]

    # Rolling origin.
    cache: dict[float, list[list[dict]]] = {r: cases_for(r, range(len(order) - 1)) for r in GRID_R}
    test_fit, test_old, test_naive, test_cases, spreads, wilson_in, wilson_n = [], [], [], [], [], 0, 0
    lb_rho = []
    for t in range(MIN_TRAIN, len(order) - 1):
        best = None
        for r in GRID_R:
            train = cache[r][:t]
            b, k = fit_bk(train)
            err = sse(train, b, k)
            if best is None or err < best[0]:
                best = (err, r, b, k)
        _, r, b, k = best
        spread = fit_spread(cache[r][:t], b, k)
        case = cache[r][t]
        pred = predict(case, b, k)
        test_cases.append(case)
        test_fit.append(pred)
        spreads.append(spread)
        test_old.append(old_estimate(case))
        test_naive.append([e["now"] for e in case])
        lb_rho.append(spearman([p - sd_of(spread, e["n"]) for p, e in zip(pred, case)], [e["y"] for e in case]))
        n_matches = matches.get(order[t], 0)
        for e in case:
            half = wilson_half(e["now"], e["pick"] * n_matches)
            wilson_in += abs(e["y"] - e["now"]) <= half
            wilson_n += 1

    # Final fit on every transition.
    best = None
    for r in GRID_R:
        b, k = fit_bk(cache[r])
        err = sse(cache[r], b, k)
        if best is None or err < best[0]:
            best = (err, r, b, k)
    _, r, b, k = best
    spread = fit_spread(cache[r], b, k)

    fitted = score_cases(test_cases, test_fit, spreads)
    fitted["spearman_low_end"] = round(sum(lb_rho) / len(lb_rho), 3)
    backtest = {
        "transitions": len(test_cases),
        "first_test": order[MIN_TRAIN],
        "last_test": order[-1],
        "models": {
            "current": score_cases(test_cases, test_old),
            "no_change": score_cases(test_cases, test_naive),
            "fitted": fitted,
        },
        "sampling_only_95_coverage": round(wilson_in / wilson_n, 3) if wilson_n else None,
    }
    return {
        "fit": {"b": b, "k": k, "r": r, **{key: round(v, 5) for key, v in spread.items()}},
        "backtest": backtest,
        "projection": projection(bp, b, k, r, spread),
    }


def projection(bp: dict, b: float, k: float, r: float, spread: dict) -> dict:
    """Expected next-patch win rate and 80/95% ranges for every champion, from all patches up to the live one."""
    allp = [p for p in c.patches() if p["patch"] in bp and p["days"] > 0]
    order = [p["patch"] for p in allp]
    days = {p["patch"]: p["days"] for p in allp}
    case = champion_case(bp, order, days, len(order) - 1, r, None)
    pred = predict(case, b, k)
    out = {}
    for e, p in zip(case, pred):
        sd = sd_of(spread, e["n"])
        out[e["key"]] = {
            "wr": round(p, 4),
            "lo80": round(p - spread["q80"] * sd, 4), "hi80": round(p + spread["q80"] * sd, 4),
            "lo95": round(p - spread["q95"] * sd, 4), "hi95": round(p + spread["q95"] * sd, 4),
        }
    tier_of = dict(zip([e["key"] for e in case], tiers(pred)))
    for key in out:
        out[key]["tier"] = tier_of[key]
    return {"patch": order[-1], "days": days[order[-1]], "champions": out}


# ---------- augments ----------

def last_daily_per_patch(folder: Path) -> dict[str, Path]:
    """The last daily file inside each complete patch window."""
    files = sorted(folder.glob("*.csv"))
    out = {}
    for p in complete_patches():
        inside = [f for f in files if p["first_day_in_data"] <= f.stem <= p["last_day"]]
        if inside:
            out[p["patch"]] = inside[-1]
    return out


def augment_lists() -> list[dict[str, dict[str, dict]]]:
    """Per complete patch (oldest first): rarity -> augment id -> {win_rate, pick_rate}."""
    out = []
    for _, path in sorted(last_daily_per_patch(c.ROOT / "data" / "cn" / "history" / "augments").items(),
                          key=lambda kv: [int(x) for x in kv[0].split(".")]):
        groups: dict[str, dict[str, dict]] = {}
        with open(path, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                try:
                    wr, pr = float(row["win_rate"]), float(row["pick_rate"])
                except (KeyError, ValueError):
                    continue
                if pr <= 0:
                    continue
                groups.setdefault(row.get("tier") or "?", {})[row["augment_id"]] = {"win_rate": wr, "pick_rate": pr}
        out.append(groups)
    return out


def list_cases(now: dict[str, dict], nxt: dict[str, dict], min_size: int = 3) -> list[dict]:
    keys = [key for key in now if key in nxt]
    if len(keys) < min_size:
        return []
    med = median([now[key]["pick_rate"] for key in keys])
    return [{"key": key, "x": now[key]["win_rate"], "n": now[key]["pick_rate"] / med, "y": nxt[key]["win_rate"],
             "now": now[key]["win_rate"], "pick": now[key]["pick_rate"]} for key in keys]


def small_family(transitions: list[list[list[dict]]]) -> dict | None:
    """Fit (b, k) on all transitions; score each transition with settings fitted on the others."""
    transitions = [t for t in transitions if t]
    if len(transitions) < 2:
        return None
    every = [case for t in transitions for case in t]
    b, k = fit_bk(every)
    spread = fit_spread(every, b, k)
    test, fit_pred, old_pred, naive, spreads = [], [], [], [], []
    for i, t in enumerate(transitions):
        rest = [case for j, o in enumerate(transitions) if j != i for case in o]
        bi, ki = fit_bk(rest)
        si = fit_spread(rest, bi, ki)
        for case in t:
            test.append(case)
            fit_pred.append(predict(case, bi, ki))
            old_pred.append(old_estimate(case))
            naive.append([e["now"] for e in case])
            spreads.append(si)
    return {
        "fit": {"b": b, "k": k, **{key: round(v, 5) for key, v in spread.items()}},
        "backtest": {
            "transitions": len(transitions),
            "lists": len(test),
            "models": {
                "current": score_cases(test, old_pred),
                "no_change": score_cases(test, naive),
                "fitted": score_cases(test, fit_pred, spreads),
            },
        },
    }


def augments() -> dict | None:
    lists = augment_lists()
    transitions = []
    for now, nxt in zip(lists, lists[1:]):
        transitions.append([case for rarity in now if rarity in nxt
                            for case in [list_cases(now[rarity], nxt[rarity])] if case])
    return small_family(transitions)


# ---------- items (a champion's starting items and boots) ----------

def item_lists() -> list[dict]:
    import json
    folder = c.ROOT / "data" / "cn" / "history" / "items"
    done = {p["patch"] for p in complete_patches()}
    out = []
    for path in sorted(folder.glob("*.json"), key=lambda p: [int(x) for x in p.stem.split(".")]):
        if path.stem not in done:
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        lists = {}
        for champ, slots in data.get("champions", {}).items():
            for slot in ("starting", "boots"):  # "other" is frozen upstream, so it can't be backtested
                rows = {}
                for items, pick, wr in slots.get(slot, []):
                    rows[",".join(map(str, items))] = {"pick_rate": pick, "win_rate": wr}
                lists[f"{champ}:{slot}"] = rows
        out.append(lists)
    return out


def items() -> dict | None:
    lists = item_lists()
    transitions = []
    for now, nxt in zip(lists, lists[1:]):
        transitions.append([case for key in now if key in nxt for case in [list_cases(now[key], nxt[key])] if case])
    return small_family(transitions)


def build() -> dict:
    champs = champions()
    aug = augments()
    itm = items()
    return {"built": c.now_iso(), "champions": champs, "augments": aug, "items": itm}


def site_fit(result: dict) -> dict:
    """The settings lib/deepscore.ts reads; a family without enough history keeps the old settings."""
    def pick(fam, with_r=False):
        if not fam:
            return None
        f = fam["fit"]
        out = {key: f[key] for key in ("b", "k", "s0", "s1", "q50", "q80", "q95")}
        if with_r:
            out["r"] = f["r"]
        return out
    return {
        "about": "Fitted DeepScore settings (data/analysis/predictive.py). est = m + b*n/(n+k)*(x-m); sd = sqrt(s0^2+s1^2/n).",
        "built": result["built"],
        "champions": pick(result["champions"], True),
        "augments": pick(result["augments"]),
        "items": pick(result["items"]),
    }


if __name__ == "__main__":
    res = build()
    c.write_json(c.OUT / "predictive.json", res)
    c.write_json(FIT_OUT, site_fit(res))
    import json
    print(json.dumps({k: (v["fit"], v["backtest"]) if isinstance(v, dict) and "fit" in v else v
                      for k, v in res.items() if k != "built"}, indent=1)[:6000])
