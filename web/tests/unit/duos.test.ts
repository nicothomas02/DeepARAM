import { describe, expect, it } from "vitest";
import { duoRows } from "@/lib/duos";
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
