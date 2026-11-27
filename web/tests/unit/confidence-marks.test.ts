import { describe, expect, it } from "vitest";
import { closeCall } from "@/lib/card-score";
import { tierEdges, TIER_EDGE_PTS } from "@/lib/tiers";

// Confidence marks (Nico 2026-11-27: show confidence, not just ranks). Cut-offs from research/confidence.
describe("closeCall", () => {
  it("marks a lead smaller than its sampling noise", () => {
    expect(closeCall([{ winRate: 0.52, games: 2000 }, { winRate: 0.515, games: 2000 }, { winRate: 0.48, games: 5000 }])).toBe(true);
  });
  it("leaves a clear lead alone", () => {
    expect(closeCall([{ winRate: 0.56, games: 50000 }, { winRate: 0.5, games: 50000 }, { winRate: 0.49, games: 50000 }])).toBe(false);
  });
  it("says nothing without real games or when the lead has under 100", () => {
    expect(closeCall([{ winRate: 0.52 }, { winRate: 0.515 }])).toBe(false);
    expect(closeCall([{ winRate: 0.52, games: 50 }, { winRate: 0.515, games: 5000 }])).toBe(false);
  });
  it("scores pooled numbers when a row has them", () => {
    const pooled = { winRate: 0.56, games: 50000, patches: 2 };
    expect(closeCall([{ winRate: 0.52, games: 300, pooled }, { winRate: 0.515, games: 50000 }])).toBe(false);
  });
});

describe("tierEdges", () => {
  it("names the neighbouring tier only within the borderline distance of a line", () => {
    const xs = Array.from({ length: 101 }, (_, i) => 0.42 + i * 0.0016);
    const edges = tierEdges(xs);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    const aLine = mean + (9 / 15) * sd; // A starts at DeepScore 59
    xs.forEach((x, i) => {
      const d = Math.abs(x - aLine) * 100;
      if (d < TIER_EDGE_PTS) expect(edges[i], `${x}`).toBe(x >= aLine ? "B" : "A");
    });
    expect(edges.filter((e) => e === null).length).toBeGreaterThan(xs.length / 3);
  });
});
