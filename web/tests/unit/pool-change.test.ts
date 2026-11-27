import { describe, expect, it } from "vitest";
import { mayhemChanged, poolChanged } from "@/lib/pool-change";
import { champStats, plusRows, PRIOR_GAMES, type PatchRow } from "@/lib/tiers";

// "{live}+" keeps current-patch power (Nico 2026-11-27, Yunara after Critical Missile left on 16.21).
describe("champion pooling and pool changes", () => {
  it("flags Yunara when Critical Missile left the pool (16.20 -> 16.21)", () => {
    expect(poolChanged("16.20", "16.21")).toContain("Yunara");
  });

  it("flags champions the live patch's Mayhem notes changed (16.23: Ziggs, Yasuo), not SR-only changes (Annie)", () => {
    expect(mayhemChanged("16.23")).toEqual(expect.arrayContaining(["Ziggs", "Yasuo", "Zaahen"]));
    expect(poolChanged("16.22", "16.23")).toContain("Ziggs");
    expect(poolChanged("16.22", "16.23")).not.toContain("Annie");
  });

  const row = (patch: string, name: string, win_rate: number, pick_rate = 0.05): PatchRow =>
    ({ patch, days: 7, name, win_rate, pick_rate, damage: null, tank: null, kp: null, dead: null, augs: "" });
  const rows = [row("a", "X", 0.53), row("b", "X", 0.5), row("a", "Y", 0.5), row("b", "Y", 0.5)];
  const matches = { a: 10_000_000, b: 40_000 }; // 500k earlier games vs 2,000 live ones

  it("a pool change keeps the live patch alone", () => {
    expect(plusRows(rows, "b", "a", matches, ["X"]).filter((r) => r.name === "X").map((r) => r.patch)).toEqual(["b"]);
  });

  it("the earlier patch counts as at most PRIOR_GAMES games", () => {
    const x = (cap?: number) => champStats(plusRows(rows, "b", "a", matches), new Set(["a", "b"]), matches, true, cap).find((c) => c.name === "X")!;
    // Capped, 500k earlier games count as PRIOR_GAMES next to the 2,000 live ones.
    expect(x(PRIOR_GAMES).win_rate).toBeCloseTo((0.5 * 2000 + 0.53 * PRIOR_GAMES) / (2000 + PRIOR_GAMES), 3);
  });
});
