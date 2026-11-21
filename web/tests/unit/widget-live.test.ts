import { describe, expect, it } from "vitest";
import { cleanLive } from "@/lib/widget-live";

// The live game the owner's PC app sends for the iPhone (lib/widget-live.ts): only known fields, in range.
const NOW = Date.UTC(2026, 10, 21, 3);

describe("cleanLive", () => {
  it("keeps the fields the phone shows and clamps them", () => {
    const g = cleanLive(
      { champion: "Wukong", championId: "MonkeyKing", startedAt: NOW - 600_000, level: 25, kills: 4, deaths: 2, assists: 9, nextAugment: 11,
        augmentReady: true, nextItems: ["Trinity Force", "Sterak's Gage", "Extra"], winChance: 0.6234, dead: false, puuid: "dropped" },
      NOW,
    )!;
    expect(g).toEqual({ champion: "Wukong", championId: "MonkeyKing", startedAt: NOW - 600_000, level: 18, kills: 4, deaths: 2, assists: 9,
      nextAugment: 11, augmentReady: true, nextItems: ["Trinity Force", "Sterak's Gage"], winChance: 0.62, dead: false });
  });

  it("refuses games without a champion or with an impossible start, and drops unknown augment levels", () => {
    expect(cleanLive({ startedAt: NOW }, NOW)).toBeNull();
    expect(cleanLive({ champion: "Ahri", startedAt: NOW + 3_600_000 }, NOW)).toBeNull();
    expect(cleanLive({ champion: "Ahri", startedAt: NOW - 3 * 3_600_000 }, NOW)).toBeNull();
    const g = cleanLive({ champion: "Ahri", startedAt: NOW, nextAugment: 9, winChance: null }, NOW)!;
    expect(g.nextAugment).toBeNull();
    expect(g.winChance).toBeNull();
    expect(g.championId).toBe("Ahri");
  });
});
