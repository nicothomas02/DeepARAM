"""How fast a patch's rankings settle, and mid-patch shifts in one champion's win rate.

The daily feed is cumulative within a patch window, so day N already averages days 1..N. Settling is measured as
the Spearman correlation between the day-N champion ranking (by cumulative win rate) and the patch's final
ranking, plus the mean absolute gap in win-rate points; the typical curve is the median over finished patches,
which gives the live patch an expected "how final is this list" figure for its current day.

Mid-patch shifts: for each champion and each split day t, the implied win rate of days t..T is recovered from
the cumulative series under a uniform daily-volume assumption, win(t..T) = (T * C_T - (t-1) * C_(t-1)) / (T-t+1),
and compared with the cumulative rate before t. A split with a shift of 1.5 points or more and |z| >= 4 (binomial,
against the estimated games on each side; 4 keeps false alarms to about one across all champion-days) is flagged
as a candidate mid-patch change (a hotfix, or a new interaction players found). Output: data/analysis/meta_settling.json.
"""
from __future__ import annotations

import common as c

MIN_DAYS = 5
SETTLED_AT = 0.95
SHIFT_PTS = 0.015
SHIFT_Z = 4.0
CURVE_DAYS = 14


def patch_shifts(patch: str, full: dict, aliases: list[str], dates: list[str], names: dict) -> list[dict]:
    """Candidate mid-patch changes in one patch. The implied shift of every champion at every split day is compared
    with all champions' shifts at that same split (median and a robust spread), so a day with uneven game volume,
    which moves every champion's implied rate a little, does not raise alarms; only a champion that moves far more
    than the rest of the list on the same day is flagged."""
    T = len(dates)
    per_split: dict[int, dict[str, tuple]] = {}
    for t in range(3, T - 1):  # 1-based split day t: before = days 1..t-1, after = days t..T
        per_split[t] = {}
        for a in aliases:
            rows = full[a]
            c_before = rows[t - 2]["win_rate"]
            after = (T * rows[-1]["win_rate"] - (t - 1) * c_before) / (T - t + 1)
            per_split[t][a] = (c_before, after, after - c_before)
    best: dict[str, dict] = {}
    for t, by_champ in per_split.items():
        vals = sorted(v[2] for v in by_champ.values())
        med = vals[len(vals) // 2]
        mad = sorted(abs(v - med) for v in vals)[len(vals) // 2]
        spread = max(1.4826 * mad, 0.002)
        for a, (c_before, after, shift) in by_champ.items():
            z = (shift - med) / spread
            if a not in best or abs(z) > abs(best[a]["z"]):
                best[a] = {"day": t, "date": dates[t - 1], "before": round(c_before, 4), "after": round(after, 4), "shift": round(shift, 4), "z": round(z, 1)}
    return [
        {"patch": patch, "alias": a, "name": names.get(a, a), **b}
        for a, b in best.items()
        if abs(b["shift"]) >= SHIFT_PTS and abs(b["z"]) >= SHIFT_Z
    ]


def build() -> dict:
    patches = c.patches()
    daily = c.daily()
    names = c.champion_names()
    live = patches[-1]["patch"] if patches else None
    out = []
    curves = []
    shifts = []
    for p in patches:
        patch = p["patch"]
        champs = daily.get(patch, {})
        if not champs:
            continue
        dates = sorted({r["date"] for rows in champs.values() for r in rows})
        T = len(dates)
        full = {a: rows for a, rows in champs.items() if len(rows) == T}
        if T < 1 or len(full) < 50:
            continue
        aliases = sorted(full)
        final = [full[a][-1]["win_rate"] for a in aliases]
        spear, mad = [], []
        for d in range(T):
            day = [full[a][d]["win_rate"] for a in aliases]
            spear.append(round(c.spearman(day, final), 3))
            mad.append(round(100 * c.mean(abs(x - y) for x, y in zip(day, final)), 2))
        settled = next((i + 1 for i, s in enumerate(spear) if s >= SETTLED_AT), None)
        entry = {"patch": patch, "days": T, "champions": len(full), "spearman": spear, "mad_pts": mad, "settled_day": settled}
        out.append(entry)
        if patch != live and T >= MIN_DAYS:
            curves.append(entry)
        # Mid-patch shifts need enough days on both sides of the split.
        if T >= 6:
            shifts.extend(patch_shifts(patch, full, aliases, dates, names))
    typical = {"spearman": [], "mad_pts": []}
    for d in range(CURVE_DAYS):
        vals = sorted(e["spearman"][d] for e in curves if len(e["spearman"]) > d)
        mads = sorted(e["mad_pts"][d] for e in curves if len(e["mad_pts"]) > d)
        if len(vals) >= 3:
            typical["spearman"].append(round(vals[len(vals) // 2], 3))
            typical["mad_pts"].append(round(mads[len(mads) // 2], 2))
    settled_days = [e["settled_day"] for e in curves if e["settled_day"]]
    live_entry = next((e for e in out if e["patch"] == live), None)
    live_info = None
    if live_entry:
        d = min(live_entry["days"], len(typical["spearman"])) - 1
        live_info = {
            "patch": live,
            "day": live_entry["days"],
            "typical_spearman": typical["spearman"][d] if d >= 0 else None,
            "typical_mad_pts": typical["mad_pts"][d] if d >= 0 else None,
        }
    shifts.sort(key=lambda s: -abs(s["z"]))
    # Days when several champions shifted at once read as one event (a mid-patch update or a new set interaction).
    by_day: dict[tuple, list] = {}
    for s in shifts:
        by_day.setdefault((s["patch"], s["date"]), []).append(s["name"])
    events = sorted(({"patch": k[0], "date": k[1], "champions": v} for k, v in by_day.items() if len(v) >= 3), key=lambda e: e["date"], reverse=True)
    return {
        "events": events,
        "built": c.now_iso(),
        "settled_at": SETTLED_AT,
        "patches": list(reversed(out)),
        "typical": typical,
        "typical_settled_day": sorted(settled_days)[len(settled_days) // 2] if settled_days else None,
        "live": live_info,
        "shifts": shifts,
        "shift_rule": {"min_pts": SHIFT_PTS, "min_z": SHIFT_Z, "assumption": "uniform daily game volume within a patch; z is against all champions' shifts on the same day"},
    }


if __name__ == "__main__":
    data = build()
    c.write_json(c.OUT / "meta_settling.json", data)
    print("typical curve:", data["typical"]["spearman"], "settled day", data["typical_settled_day"])
    print("live:", data["live"])
    for e in data["patches"][:6]:
        print(" ", e["patch"], e["days"], e["settled_day"], e["spearman"][:5])
    print(len(data["shifts"]), "shifts")
    for s in data["shifts"][:15]:
        print(f"  {s['patch']} {s['name']:12} day {s['day']} {s['date']} {s['before']:.3f}->{s['after']:.3f} z {s['z']}")
