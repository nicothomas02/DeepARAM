// The Kitchen's Traps and Bug finder tabs (lib/checks.ts): every finding has names, icons and the text the card shows.
import { describe, expect, it } from "vitest";
import championIds from "@/data/champion-ids.json";
import { checks } from "@/lib/checks";

describe("Traps and Bug finder", () => {
  const { traps, bugs } = checks();

  it("has Tickle Monster Jhin on the Traps tab", () => {
    expect(traps.map((f) => f.id)).toContain("loop-tickle_monster-Jhin");
  });

  it("names every champion, augment and item it shows", () => {
    for (const f of [...traps, ...bugs]) {
      for (const c of f.champions) {
        expect(championIds, f.id).toHaveProperty(c.id);
        expect(c.href, f.id).toBe(`/champions/${c.id}`);
      }
      for (const a of f.augments) expect(a.name, f.id).not.toMatch(/^\d+$/);
      for (const i of f.items) expect(i.name, f.id).not.toMatch(/^\d+$/);
    }
  });

  it("says what happens in game for a trap and how to test everything else", () => {
    for (const f of traps) expect(f.practice, f.id).toBeTruthy();
    for (const f of bugs) expect(f.test, f.id).toBeTruthy();
  });
});
