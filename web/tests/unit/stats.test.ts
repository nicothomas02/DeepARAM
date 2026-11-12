import { describe, expect, it } from "vitest";
import { diffInterval, gamesNeeded, halfWidth, MIN_GAMES, sampleLevel, wilson } from "@/lib/stats";
import { champStats, type PatchRow } from "@/lib/tiers";
import { gamesFor, matchesByPatch, patchMatches } from "@/lib/sample";
import { duoRows } from "@/lib/duos";
import { championPage } from "@/lib/champion-page";
import { liveWithChange } from "@/lib/champions";

// Confidence intervals (lib/stats.ts mirrors data/stats/intervals.py; tests/data/test_data_stats.py checks the same values).
describe("Wilson interval", () => {
  const r4 = ([lo, hi]: [number, number]) => [Math.round(lo * 1e4) / 1e4, Math.round(hi * 1e4) / 1e4];

  it("matches Newcombe (1998) table I", () => {
    expect(r4(wilson(81 / 263, 263))).toEqual([0.2553, 0.3662]);
    expect(r4(wilson(15 / 148, 148))).toEqual([0.0624, 0.1605]);
  });

  it("stays inside 0 to 1 and covers everything with no games", () => {
    expect(wilson(1, 5)[1]).toBe(1);
    expect(wilson(0, 5)[0]).toBe(0);
    expect(wilson(0.5, 0)).toEqual([0, 1]);
  });

  it("narrows as games grow", () => {
    const w = [10, 100, 1000, 1e5].map((n) => halfWidth(0.52, n));
    expect([...w].sort((a, b) => b - a)).toEqual(w);
    expect(halfWidth(0.5, 1e5)).toBeLessThan(0.004);
  });
});

describe("difference of two rates", () => {
  it("matches Newcombe (1998) table II", () => {
    const [lo, hi] = diffInterval(56 / 70, 70, 48 / 80, 80);
    expect(lo).toBeCloseTo(0.0524, 4);
    expect(hi).toBeCloseTo(0.3339, 4);
  });

  it("is the shifted Wilson interval against a fixed baseline", () => {
    const [lo, hi] = diffInterval(0.56, 1000, 0.5, Infinity);
    const [wl, wh] = wilson(0.56, 1000);
    expect(lo).toBeCloseTo(wl - 0.5, 10);
    expect(hi).toBeCloseTo(wh - 0.5, 10);
  });
});

describe("sample levels", () => {
  it("flags too few, few and enough games", () => {
    expect(sampleLevel(undefined)).toBe("none");
    expect(sampleLevel(MIN_GAMES - 1)).toBe("none");
    expect(sampleLevel(100)).toBe("low");
    expect(sampleLevel(gamesNeeded() + 10)).toBe("ok");
    expect(gamesNeeded()).toBeGreaterThan(350);
    expect(gamesNeeded()).toBeLessThan(420);
  });
});

describe("estimated games behind the stats", () => {
  const row = (name: string, win_rate: number, pick_rate: number, patch: string): PatchRow => ({
    patch, days: 14, name, win_rate, pick_rate, damage: null, tank: null, kp: null, dead: null, augs: "",
  });

  it("knows every patch's matches", () => {
    const m = matchesByPatch()!;
    expect(Object.keys(m).length).toBeGreaterThan(10);
    for (const v of Object.values(m)) expect(v).toBeGreaterThan(1e5);
    expect(patchMatches("not-a-patch")).toBeGreaterThan(1e6); // falls back to a typical two weeks
    expect(gamesFor([{ patch: "16.21", pick_rate: 0.1 }])).toBeCloseTo(0.1 * m["16.21"], 0);
  });

  it("gives champStats an effective sample, below the raw total when older patches count for less", () => {
    const matches = { a: 1e6, b: 1e6 };
    const one = champStats([row("Ahri", 0.5, 0.1, "b")], new Set(["b"]), matches)[0];
    expect(one.sample).toBeCloseTo(1e5, 0);
    const two = champStats([row("Ahri", 0.5, 0.1, "a"), row("Ahri", 0.5, 0.1, "b")], new Set(["a", "b"]), matches)[0];
    expect(two.sample!).toBeGreaterThan(1e5);
    expect(two.sample!).toBeLessThan(2e5);
    expect(champStats([row("Ahri", 0.5, 0.1, "b")], new Set(["b"]))[0].sample).toBeUndefined();
  });

  it("puts games on live champions, their builds and duo pairs", () => {
    const live = liveWithChange().live;
    expect(live.every((c) => (c.sample ?? 0) > 1000)).toBe(true);
    const p = championPage(live[0].name)!;
    const rows = [...p.core, ...p.items];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.games).toBeCloseTo(live[0].sample! * r.pickRate, 3);
    const pairs = duoRows();
    expect(pairs.every((d) => typeof d.games === "number" && d.games > 0)).toBe(true);
  });
});
