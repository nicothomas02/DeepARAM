// Bracket augment scores: half bracket, half all players, each scored within its own list; no bracket data on the
// live patch means no bracket view.
import { afterEach, describe, expect, it, vi } from "vitest";
import championIds from "@/data/champion-ids.json";
import { blendScores, boundScores, bracketAugmentScores } from "@/lib/bracket-augments";
import { FIT } from "@/lib/deepscore";

// Lets a test put a fixed file in place of one of the repo's data files; every other path reads the real file.
const fixed = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/repo-data", async (original) => {
  const real = await original<typeof import("@/lib/repo-data")>();
  return { ...real, readRepoJson: (rel: string) => (fixed.has(rel) ? fixed.get(rel) : real.readRepoJson(rel)) };
});
afterEach(() => fixed.clear());

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

  // A made-up live patch holding Yasuo's all-player table and the given bracket tables. The real live patch gets its
  // bracket tables a while into a patch (16.23 had none on 2026-11-24), so neither case can be left to what it has
  // published today.
  const yasuo = championIds.Yasuo;
  const allPlayers = { 1: [20000, 11000], 2: [20000, 10000], 3: [20000, 9000] } as Record<string, [number, number]>;
  const topPlayers = { 1: [1000, 480], 2: [1000, 560], 3: [1000, 450] } as Record<string, [number, number]>;
  const livePatch = (bands: Record<string, Record<string, [number, number]>>) => {
    fixed.set("data/aramhex/patches/index.json", { latest: "0.1" });
    fixed.set("data/aramhex/patches/0.1/augments.json", { [yasuo]: allPlayers });
    for (const [b, rows] of Object.entries(bands)) fixed.set(`data/aramhex/patches/0.1/bands/${b}/augments.json`, { [yasuo]: rows });
  };

  it("shows nothing when the live patch has no bracket tables", () => {
    livePatch({});
    expect(bracketAugmentScores("Yasuo")).toBeNull();
  });

  it("scores each bracket the live patch has a table for, by augment id", () => {
    livePatch({ high: topPlayers });
    const r = bracketAugmentScores("Yasuo")!;
    expect(Object.keys(r)).toEqual(["high"]);
    for (const m of Object.values(r)) expect(m.size).toBeGreaterThan(0);
    const mixed = blendScores(boundScores(allPlayers, FIT.augments), boundScores(topPlayers, FIT.augments));
    expect([...r.high!]).toEqual([...mixed].map(([id, score]) => [Number(id), score]));
  });
});
