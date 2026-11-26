import { afterEach, describe, expect, it, vi } from "vitest";
import { damageDealtWorth, forecastScorecard, gameLength, itemLift, itemLiftSummary, patchImpact, pbeForecast, playstyleClusters, playstyleOf, settlingOf, shiftsOf, typicalSettling, type GameLength, type LengthCurve } from "@/lib/analysis";
import { readRepoJson } from "@/lib/repo-data";

// Lets a test put a fixed file in place of one of the repo's data files; every other path reads the real file. Each
// read gets its own copy, as a file read does.
const fixed = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/repo-data", async (original) => {
  const real = await original<typeof import("@/lib/repo-data")>();
  return { ...real, readRepoJson: (rel: string) => (fixed.has(rel) ? structuredClone(fixed.get(rel)) : real.readRepoJson(rel)) };
});
afterEach(() => fixed.clear());

// Readers for data/analysis (lib/analysis.ts): every page that uses them must get consistent, in-range values.
describe("patch-change impact", () => {
  const impact = readRepoJson<{ patches: { patch: string }[] }>("data/analysis/patch_impact.json");

  it("finds the measured changes for a patch with notes, biggest move first", () => {
    const patch = impact?.patches[0]?.patch;
    expect(patch).toBeTruthy();
    const p = patchImpact(patch!)!;
    expect(p.champions.length).toBeGreaterThan(0);
    for (let i = 1; i < p.champions.length; i++) expect(Math.abs(p.champions[i - 1].z)).toBeGreaterThanOrEqual(Math.abs(p.champions[i].z));
    for (const c of p.champions) {
      expect(c.ci[0]).toBeLessThanOrEqual(c.effect);
      expect(c.ci[1]).toBeGreaterThanOrEqual(c.effect);
      expect(["worked", "opposite", "noise", "moved"]).toContain(c.verdict);
    }
  });

  it("returns null for a patch without notes", () => expect(patchImpact("0.0")).toBeNull());

  it("prices a damage-dealt modifier with an interval", () => {
    const w = damageDealtWorth()!;
    expect(w.ci[0]).toBeLessThanOrEqual(w.pts);
    expect(w.ci[1]).toBeGreaterThanOrEqual(w.pts);
    expect(w.n).toBeGreaterThan(10);
  });
});

describe("meta settling and shifts", () => {
  it("gives a typical day-one closeness between 0 and 1", () => {
    const t = typicalSettling()!;
    expect(t.spearman[0]).toBeGreaterThan(0);
    expect(t.spearman[0]).toBeLessThanOrEqual(1);
  });

  it("matches a patch's own curve to its days and keeps shifts in that patch", () => {
    const check = (patch: string) => {
      const s = settlingOf(patch);
      if (s) expect(s.spearman.length).toBe(s.days);
      for (const sh of shiftsOf(patch)) expect(sh.patch).toBe(patch);
    };
    // The real file names no live patch until the newest one has a settling entry, and a live patch may have no
    // shifts yet, so it is checked as far as it goes; a fixed file with two patches and shifts in both always is.
    const live = typicalSettling()!.live?.patch;
    if (live) check(live);
    const curve = (patch: string, days: number) => ({ patch, days, spearman: Array.from({ length: days }, (_, day) => 0.9 + day / 100) });
    const shifts = ["Ahri", "Yasuo", "Zed", "Lux"].map((alias, i) => ({ patch: i % 2 ? "0.2" : "0.1", alias }));
    fixed.set("data/analysis/meta_settling.json", { typical: { spearman: [0.9], mad_pts: [0.5] }, live: { patch: "0.2" }, patches: [curve("0.1", 3), curve("0.2", 2)], shifts });
    const patch = typicalSettling()!.live!.patch;
    expect(settlingOf(patch)).toEqual(curve("0.2", 2));
    expect(shiftsOf(patch).map((sh) => sh.alias)).toEqual(["Yasuo", "Lux"]);
    check(patch);
  });
});

describe("playstyles", () => {
  it("puts every champion in one named group", () => {
    const c = playstyleClusters()!;
    expect(c.clusters.length).toBe(c.k);
    for (const ch of c.champions) {
      const p = playstyleOf(ch.alias)!;
      expect(p.label).toBe(c.clusters[ch.cluster].label);
      expect(p.unlikeClass).toBe(ch.unlike_class);
    }
    expect(playstyleOf("NotAChampion")).toBeNull();
  });
});

describe("pre-patch forecast", () => {
  it("keeps each prediction inside its range and reports both baselines", () => {
    const f = pbeForecast()!;
    expect(f.model.cv_mae_pts).toBeGreaterThan(0);
    expect(f.model.baseline_no_change_mae_pts).toBeGreaterThan(0);
    for (const e of f.pbe?.entries ?? []) {
      expect(e.range_pts[0]).toBeLessThanOrEqual(e.predicted_pts);
      expect(e.range_pts[1]).toBeGreaterThanOrEqual(e.predicted_pts);
    }
  });
});

describe("item lift and game length", () => {
  it("adjusts an item's lift by its champions' finished-build premium", () => {
    const s = itemLiftSummary()!;
    expect(s.ranked).toBeGreaterThan(50);
    const lifts = readRepoJson<{ items: Record<string, { raw: number }> }>("data/analysis/item_lift.json")!;
    const id = Number(Object.keys(lifts.items)[0]);
    const l = itemLift(id)!;
    expect(Math.abs(l.adjusted - (l.raw - l.premium))).toBeLessThan(0.001);
    expect(itemLift(-1)).toBeNull();
  });

  it("reads a survival curve that only ever falls", () => {
    const falls = (g: GameLength) => {
      const s = g.curves.all.survival;
      expect(s.length).toBeGreaterThan(1);
      for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThanOrEqual(s[i - 1]);
      expect(g.curves.all.median).toBeGreaterThan(10);
    };
    // game_length.json is private (git-ignored), so the repo and CI never have it: the owner's own file is checked
    // where there is one, and a fixed file stands in for it everywhere. It holds what game_length.py's curve() writes
    // for four games that ended in minutes 12, 14, 14 and 15.
    const own = gameLength();
    if (own) falls(own);
    const all: LengthCurve = { games: 4, median: 14.5, quartiles: [13, 15], survival: [...Array(13).fill(1), 0.75, 0.75, 0.25], hazard: [...Array(12).fill(0), 0.25, 0, 0.6667, 1] };
    fixed.set("data/analysis/game_length.json", { curves: { all } });
    const g = gameLength();
    expect(g?.curves.all).toEqual(all);
    falls(g!);
  });
});

describe("forecast scorecard", () => {
  it("scores only patches with a week of games and keeps misses consistent", () => {
    const s = forecastScorecard()!;
    expect(s).toBeTruthy();
    expect(s.patches.length + s.waiting.length).toBeGreaterThan(0);
    for (const p of s.patches) {
      expect(p.days).toBeGreaterThanOrEqual(s.min_days);
      expect(p.summary.n).toBe(p.champions.length);
      expect(p.summary.in50).toBeLessThanOrEqual(p.summary.in95);
      for (const r of p.champions) expect(Math.abs(r.miss_pts - Math.abs(r.measured_pts - r.predicted_pts))).toBeLessThan(0.02);
    }
  });
});
