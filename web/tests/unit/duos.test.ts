import { describe, expect, it } from "vitest";
import { archetypeRows, duoRows, duoVersion, matesOf } from "@/lib/duos";
import { readRepoJson } from "@/lib/repo-data";
import { synergy } from "@/lib/synergy";
import championIds from "@/data/champion-ids.json";

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

// The win rate boost, adjusted for how often a pair is played, and the archetype pairs pooled from it.
describe("duo win rate boost and archetypes", () => {
  const rows = duoRows();
  const champs = readRepoJson<{ champions: { champion_id: number; win_rate: number; best_partners?: { champion_id: number; win_rate: number }[] }[] }>(
    "data/cn/champions.json",
  )!.champions;
  const ids = (alias: string) => (championIds as Record<string, number>)[alias];
  const measured = (r: { a: string; b: string }) => {
    const [x, y] = [champs.find((c) => c.champion_id === ids(r.a))!, champs.find((c) => c.champion_id === ids(r.b))!];
    const p = x.best_partners?.find((m) => m.champion_id === y.champion_id) ?? y.best_partners!.find((m) => m.champion_id === x.champion_id)!;
    return synergy(p.win_rate, x.win_rate, y.win_rate);
  };

  it("pulls each pair's measured synergy toward the average, never past it", () => {
    const mean = rows.reduce((a, r) => a + r.delta, 0) / rows.length;
    let shrunk = 0;
    for (const r of rows.slice(0, 500)) {
      const m = measured(r);
      expect(Math.abs(r.delta - mean)).toBeLessThanOrEqual(Math.abs(m - mean) + 0.002);
      if (Math.abs(r.delta) < Math.abs(m) - 0.001) shrunk++;
    }
    expect(shrunk).toBeGreaterThan(50);
  });

  it("keeps big boosts from rarely played pairs off the top", () => {
    const byMeasured = [...rows].sort((a, b) => measured(b) - measured(a));
    const byBoost = [...rows].sort((a, b) => b.delta - a.delta);
    expect(byBoost.slice(0, 10).map((r) => r.pair)).not.toEqual(byMeasured.slice(0, 10).map((r) => r.pair));
    expect(byBoost[0].delta).toBeGreaterThan(0.02);
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

  it("gives champion pages the same Win rate boost as the Duos list, best first", () => {
    const top = duoRows().reduce((a, b) => (b.delta > a.delta ? b : a));
    const mates = matesOf(top.a);
    expect(mates[0]).toMatchObject({ id: top.b, synergy: top.delta });
    expect(mates.map((m) => m.synergy)).toEqual([...mates.map((m) => m.synergy)].sort((x, y) => y - x));
    for (const m of mates) expect(m.pickRate).toBeGreaterThan(0);
  });
});
