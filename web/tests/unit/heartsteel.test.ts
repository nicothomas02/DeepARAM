import { describe, expect, it } from "vitest";
import { heartsteel } from "@/lib/heartsteel";

// HEARTSTEEL tab (lib/heartsteel.ts): one best sticker per champion from the shared engine's estimate, and all six
// stickers summarised.
describe("heartsteel", () => {
  it("ranks every sticker and gives each champion a best one", () => {
    const { champions, stickers } = heartsteel();
    expect(stickers).toHaveLength(6);
    expect(champions.length).toBeGreaterThan(150);
    for (const c of champions) {
      expect(c.best.why).toMatch(/estimated/);
      if (c.next) expect(c.best.points).toBeGreaterThanOrEqual(c.next.points);
    }
    expect(stickers.reduce((t, s) => t + s.bestFor, 0)).toBe(champions.length);
  }, 120_000);
});
