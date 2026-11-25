import { describe, expect, test } from "vitest";
import { bestPairs } from "@/lib/duo-pick";
import { duoRows } from "@/lib/duos";

describe("bestPairs", () => {
  test("keeps the best pair whose champions are both still free", () => {
    const rows = [
      { a: "A", b: "B", delta: 0.03 },
      { a: "A", b: "C", delta: 0.02 },
      { a: "C", b: "D", delta: 0.01 },
      { a: "E", b: "B", delta: 0.005 },
    ];
    expect(bestPairs(rows).map((r) => r.a + r.b)).toEqual(["AB", "CD"]);
    expect(bestPairs(rows, 1)).toHaveLength(1);
  });

  test("each champion shows up once on the live Duos list", () => {
    const best = bestPairs(duoRows());
    const seen = best.flatMap((r) => [r.a, r.b]);
    expect(new Set(seen).size).toBe(seen.length);
    for (let i = 1; i < best.length; i++) expect(best[i].delta).toBeLessThanOrEqual(best[i - 1].delta);
    console.log(best.slice(0, 5).map((r) => `${r.a}+${r.b} ${(r.delta * 100).toFixed(1)}`).join(", "), best.length);
  });
});
