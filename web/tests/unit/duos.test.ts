import { describe, expect, it } from "vitest";
import { duoRows } from "@/lib/duos";

// The Duos tab's pairs (lib/duos.ts), built from each champion's listed teammates.
describe("duo pairs", () => {
  const rows = duoRows();

  it("lists each pair once, far more than the old 2,000", () => {
    expect(rows.length).toBeGreaterThan(2000);
    const keys = rows.map((r) => [r.a, r.b].sort().join("+"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every pair a synergy, pick rate and win rate in range", () => {
    for (const r of rows) {
      expect(Math.abs(r.delta)).toBeLessThan(0.2);
      expect(r.pick_rate).toBeGreaterThan(0);
      expect(r.pick_rate).toBeLessThan(1);
      expect(r.win_rate).toBeGreaterThan(0.3);
      expect(r.win_rate).toBeLessThan(0.8);
    }
  });

  it("finds pairs that beat what their own win rates predict, and pairs that fall short", () => {
    expect(rows.some((r) => r.delta > 0.02)).toBe(true);
    expect(rows.some((r) => r.delta < -0.02)).toBe(true);
  });
});
