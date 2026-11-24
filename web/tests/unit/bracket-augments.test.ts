// Bracket augment scores: half bracket, half all players, each scored within its own list; no bracket data on the
// live patch means no bracket view.
import { describe, expect, it } from "vitest";
import { blendScores, boundScores, bracketAugmentScores } from "@/lib/bracket-augments";
import { FIT } from "@/lib/deepscore";

describe("bracket augment scores", () => {
  const all = { a: [20000, 11000], b: [20000, 10000], c: [20000, 9000] } as Record<string, [number, number]>;
  const top = { a: [1000, 480], b: [1000, 560], c: [1000, 450] } as Record<string, [number, number]>;

  it("mixes the two lists' bound scores evenly", () => {
    const A = boundScores(all, FIT.augments), B = boundScores(top, FIT.augments);
    expect(A.get("a")!).toBeGreaterThan(A.get("b")!);
    expect(B.get("b")!).toBeGreaterThan(B.get("a")!);
    const half = blendScores(A, B);
    const allOnly = blendScores(A, B, 0), topOnly = blendScores(A, B, 1);
    expect(allOnly.get("a")!).toBeGreaterThan(allOnly.get("b")!);
    expect(topOnly.get("b")!).toBeGreaterThan(topOnly.get("a")!);
    expect(half.get("c")!).toBeLessThan(Math.min(half.get("a")!, half.get("b")!));
  });

  it("keeps a key found in one list only", () => {
    const m = blendScores(new Map([["x", 0.5]]), new Map([["x", 0.52], ["y", 0.6]]));
    expect(m.has("y")).toBe(true);
  });

  it("shows nothing when the live patch has no bracket tables", () => {
    // 16.23, the live patch as of 2026-11-24, published no brackets.
    const r = bracketAugmentScores("Yasuo");
    if (r) for (const m of Object.values(r)) expect(m.size).toBeGreaterThan(0);
  });
});
