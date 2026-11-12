import { describe, expect, it } from "vitest";
import { damageDealtWorth, gameLength, itemLift, itemLiftSummary, patchImpact, pbeForecast, playstyleClusters, playstyleOf, settlingOf, shiftsOf, typicalSettling } from "@/lib/analysis";
import { readRepoJson } from "@/lib/repo-data";

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
    const t = typicalSettling()!;
    const patch = t.live?.patch;
    if (!patch) return;
    const s = settlingOf(patch);
    if (s) expect(s.spearman.length).toBe(s.days);
    for (const sh of shiftsOf(patch)) expect(sh.patch).toBe(patch);
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
    const g = gameLength();
    if (!g) return;
    const s = g.curves.all.survival;
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThanOrEqual(s[i - 1]);
    expect(g.curves.all.median).toBeGreaterThan(10);
  });
});
