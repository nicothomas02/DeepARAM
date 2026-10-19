import { describe, expect, it } from "vitest";
import { archetypeRows, duoRows, duoVersion } from "@/lib/duos";
import { readRepoJson } from "@/lib/repo-data";

// The Duos tab's pairs (lib/duos.ts), built from each champion's listed teammates.
describe("duo pairs", () => {
  const rows = duoRows();

  it("lists each pair once, far more than the old 2,000", () => {
    expect(rows.length).toBeGreaterThan(2000);
    const keys = rows.map((r) => [r.a, r.b].sort().join("+"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every pair a synergy and pick rate in range, and no raw pair win rate", () => {
    for (const r of rows) {
      expect(Math.abs(r.delta)).toBeLessThan(0.2);
      expect(r.pick_rate).toBeGreaterThan(0);
      expect(r.pick_rate).toBeLessThan(1);
      expect(r).not.toHaveProperty("win_rate");
    }
  });

  it("finds pairs that beat what their own win rates predict, and pairs that fall short", () => {
    expect(rows.some((r) => r.delta > 0.02)).toBe(true);
    expect(rows.some((r) => r.delta < -0.02)).toBe(true);
  });

  it("lists the champion with the bigger damage share first", () => {
    const champs = readRepoJson<{ champions: { name: string; avg_damage_ratio: number }[] }>("data/cn/champions.json")!.champions;
    const damage = new Map(champs.map((c) => [c.name, c.avg_damage_ratio]));
    for (const r of rows) if (damage.has(r.a) && damage.has(r.b)) expect(damage.get(r.a)!).toBeGreaterThanOrEqual(damage.get(r.b)!);
  });
});

// DeepScore for duos and the archetype pairs pooled from them.
describe("duo DeepScore and archetypes", () => {
  const rows = duoRows();

  it("grades every pair from 0 to 100, higher for a bigger synergy", () => {
    for (const r of rows) expect(r.deepScore >= 0 && r.deepScore <= 100).toBe(true);
    const top = [...rows].sort((a, b) => b.deepScore - a.deepScore).slice(0, 50);
    const bottom = [...rows].sort((a, b) => a.deepScore - b.deepScore).slice(0, 50);
    expect(Math.min(...top.map((r) => r.delta))).toBeGreaterThan(0);
    expect(Math.max(...bottom.map((r) => r.delta))).toBeLessThan(0);
  });

  it("trusts a rarely played pair's delta less than a common pair's", () => {
    const byDelta = [...rows].sort((a, b) => b.delta - a.delta);
    const byScore = [...rows].sort((a, b) => b.deepScore - a.deepScore);
    expect(byScore.slice(0, 10).map((r) => r.pair)).not.toEqual(byDelta.slice(0, 10).map((r) => r.pair));
  });

  it("pools pairs by subclass, including double Enchanter", () => {
    const arch = archetypeRows();
    expect(arch.length).toBeGreaterThan(50);
    const keys = arch.map((r) => `${r.a}+${r.b}`);
    expect(new Set(keys).size).toBe(keys.length);
    const enchanters = arch.find((r) => r.a === "Enchanter" && r.b === "Enchanter");
    expect(enchanters?.duos).toBeGreaterThanOrEqual(5);
    for (const r of arch) expect(Math.abs(r.delta)).toBeLessThan(0.1);
  });
});

describe("duo data version", () => {
  it("is a short stable tag for the Duos data URL", () => {
    expect(duoVersion()).toMatch(/^[0-9a-z]{1,7}$/);
    expect(duoVersion()).toBe(duoVersion());
  });
});
