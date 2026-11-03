// Fair augment win rates (lib/augment-winrate.ts): Tencent's per-game pick and win rates are turned into
// team win rates by a closed form (analysis/augment-uplift/README.md), the feed then averages 50%, win
// ranks follow the fair rates, and the ranking matches the notebook's headline.
import { describe, expect, it } from "vitest";
import { augmentRows, augmentUplift, correctPerGameWinRate, fairAugments, perTeamPickRate, type RawAugment } from "@/lib/augment-winrate";
import { readRepoJson } from "@/lib/repo-data";
import augmentNames from "@/data/augment-names.json";

const names = augmentNames as Record<string, string>;
const byName = (rows: RawAugment[], name: string) => rows.find((r) => names[r.augment_id] === name)!;
const rawRows = () => readRepoJson<{ augments: RawAugment[] }>("data/cn/augments.json")!.augments;
const weighted = (rows: RawAugment[]) => rows.reduce((s, r) => s + r.win_rate * r.pick_rate, 0) / rows.reduce((s, r) => s + r.pick_rate, 0);

describe("per-game to per-team correction", () => {
  it("leaves an augment nobody takes alone and takes nothing off a win rate of 0", () => {
    expect(perTeamPickRate(0)).toBe(0);
    expect(correctPerGameWinRate(0, 0.57)).toBe(0.57);
    expect(correctPerGameWinRate(0.6, 0)).toBe(0);
  });

  it("inverts the two-team pick rate", () => {
    for (const q of [0.01, 0.1, 0.3, 0.5, 0.9]) expect(perTeamPickRate(1 - (1 - q) ** 2)).toBeCloseTo(q, 12);
    expect(perTeamPickRate(1)).toBe(1);
    expect(perTeamPickRate(-0.1)).toBe(0);
    expect(perTeamPickRate(1.1)).toBe(1);
  });

  it("takes more off the more popular the augment, and never adds", () => {
    let last = 0.6;
    for (let p = 0; p <= 1; p += 0.05) {
      const w = correctPerGameWinRate(p, 0.6);
      expect(w).toBeLessThanOrEqual(last);
      expect(w).toBeLessThanOrEqual(0.6);
      last = w;
    }
    // An augment on both sides of every game (q = 1) is a "win" in every game; half of those are real.
    expect(correctPerGameWinRate(1, 1)).toBeCloseTo(0.5, 12);
    // Monotone in the win rate too.
    expect(correctPerGameWinRate(0.4, 0.55)).toBeGreaterThan(correctPerGameWinRate(0.4, 0.5));
  });

  it("recovers the team win rate a per-game feed would publish", () => {
    // Two independent teams each hold the augment with chance q and win with it at rate w. The feed
    // divides the holders that won (2qw per game) by the games with a holder (2q - q^2).
    for (const [q, w] of [
      [0.05, 0.5],
      [0.3, 0.55],
      [0.5, 0.48],
    ]) {
      const games = 2 * q - q * q;
      const wins = 2 * q * w;
      expect(correctPerGameWinRate(games, wins / games)).toBeCloseTo(w, 12);
    }
  });
});

describe("fair augment win rates", () => {
  it("keeps the row shape, re-ranks on the fair rate and drops the raw rank change", () => {
    const rows = [
      { augment_id: 1, tier: "Gold", pick_rate: 0.7, win_rate: 0.7, win_rank: 1, win_rank_change: 3, extra: "kept" },
      { augment_id: 2, tier: "Gold", pick_rate: 0.05, win_rate: 0.6, win_rank: 2, win_rank_change: -1, extra: "kept" },
    ];
    const fair = fairAugments(rows);
    expect(fair.map((r) => r.augment_id)).toEqual([1, 2]);
    expect(fair[0].win_rate).toBeCloseTo(correctPerGameWinRate(0.7, 0.7), 4);
    expect(fair[0].win_rank).toBe(2);
    expect(fair[1].win_rank).toBe(1);
    expect(fair.every((r) => r.extra === "kept")).toBe(true);
    expect(fair.every((r) => !("win_rank_change" in r))).toBe(true);
  });

  it("averages 50% over the real feed once corrected, where the raw feed runs high", () => {
    const raw = rawRows();
    expect(raw.length).toBeGreaterThan(100);
    expect(weighted(raw)).toBeGreaterThan(0.52);
    const fair = augmentRows();
    expect(fair.length).toBe(raw.length);
    expect(weighted(fair)).toBeGreaterThan(0.49);
    expect(weighted(fair)).toBeLessThan(0.51);
    for (const tier of ["Silver", "Gold", "Prismatic"]) {
      const g = fair.filter((r) => r.tier === tier);
      expect(g.length).toBeGreaterThan(10);
      expect(weighted(g), tier).toBeGreaterThan(0.49);
      expect(weighted(g), tier).toBeLessThan(0.515);
    }
    const byRank = [...fair].sort((a, b) => a.win_rank! - b.win_rank!);
    for (let i = 1; i < byRank.length; i++) expect(byRank[i - 1].win_rate).toBeGreaterThanOrEqual(byRank[i].win_rate);
    expect(fair.every((r) => !("win_rank_change" in r))).toBe(true);
  });

  it("ranks the real feed as the notebook does", () => {
    const raw = rawRows();
    const fair = augmentRows();
    const n = fair.length;
    // Raw: BEES!!!, taken in most games, tops the feed. Corrected: it is good, not broken.
    expect(byName(raw, "BEES!!!").win_rank).toBe(1);
    expect(byName(fair, "BEES!!!").win_rank).toBeGreaterThan(3);
    expect(byName(fair, "BEES!!!").win_rank).toBeLessThanOrEqual(15);
    for (const name of ["Draw Your Sword", "Windspeaker's Blessing"]) expect(byName(fair, name).win_rank, name).toBeLessThanOrEqual(5);
    expect(byName(fair, "King Me").win_rank).toBe(n);
  });
});

describe("augment uplift", () => {
  it("is the corrected win rate against the rarity's pick-weighted mean", () => {
    const rows = [
      { augment_id: 1, tier: "Gold", pick_rate: 0.5, win_rate: 0.6 },
      { augment_id: 2, tier: "Gold", pick_rate: 0.1, win_rate: 0.5 },
      { augment_id: 3, tier: "Silver", pick_rate: 0.2, win_rate: 0.52 },
    ];
    const up = augmentUplift(rows);
    const c = rows.map((r) => correctPerGameWinRate(r.pick_rate, r.win_rate));
    const goldMean = (c[0] * 0.5 + c[1] * 0.1) / 0.6;
    expect(up.get(1)).toBeCloseTo(c[0] - goldMean, 12);
    expect(up.get(2)).toBeCloseTo(c[1] - goldMean, 12);
    // Alone in its rarity, an augment is its own baseline.
    expect(up.get(3)).toBeCloseTo(0, 12);
    // A rarity's uplifts average zero when weighted by picks.
    expect(up.get(1)! * 0.5 + up.get(2)! * 0.1).toBeCloseTo(0, 12);
  });

  it("puts the notebook's names at the top and bottom of the real feed", () => {
    const raw = rawRows();
    const up = augmentUplift(raw);
    const order = [...raw].sort((a, b) => up.get(b.augment_id)! - up.get(a.augment_id)!).map((r) => names[r.augment_id]);
    expect(order.slice(0, 5)).toContain("Draw Your Sword");
    expect(order.slice(0, 5)).toContain("Windspeaker's Blessing");
    expect(order.at(-1)).toBe("King Me");
    expect(order[0]).not.toBe("BEES!!!");
    expect(up.get(byName(raw, "King Me").augment_id)!).toBeLessThan(-0.1);
    expect(up.get(byName(raw, "Draw Your Sword").augment_id)!).toBeGreaterThan(0.05);
  });
});
