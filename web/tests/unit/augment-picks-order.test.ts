import { describe, expect, it } from "vitest";
import { augmentPicks } from "@/lib/augment-picks";
import { rankedAugments } from "@/lib/champion-augments";

// The desktop apps' augment panel (/data/augment-picks.json) ranks a champion's augments in the champion page's order
// when real games back them (AramHex), so the app's "best first" and the site's agree.
describe("augment picks follow the champion page", () => {
  const d = augmentPicks();
  it("puts the page's best augment of each rarity first", () => {
    let lists = 0, same = 0;
    for (const [alias, rows] of Object.entries(d.champions)) {
      const page = rankedAugments(alias);
      for (const rar of ["prismatic", "gold", "silver"]) {
        const app = rows.filter(([id]) => d.augments[id]?.[1] === rar);
        const site = page.filter((a) => a.rarity === rar);
        if (!app.length || !site.length) continue;
        lists++;
        // The page rounds DeepScore and breaks ties by pick rate; the app keeps the exact lead, so a tie counts.
        if (app[0][0] === site[0].id || app[0][2] === site[0].deepScore) same++;
      }
    }
    expect(lists).toBeGreaterThan(300);
    expect(same / lists).toBeGreaterThan(0.99);
  });
  it("shows DeepScore, not a win-rate boost, where real games back the ranking", () => {
    const rows = Object.values(d.champions).flat();
    const real = rows.filter((r) => r[3] === 0 && r[2] >= 0);
    expect(real.length / rows.length).toBeGreaterThan(0.9);
  });
});
