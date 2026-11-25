// The game's "own only one of these" groups (Nico 2026-11-23): no build the site or the apps show may hold two items
// of one group (Lord Dominik's with Mortal Reminder), and a situational item that clashes with the build names the item
// it replaces.
import { describe, expect, it } from "vitest";
import { GET } from "@/app/data/overlay.json/route";
import limits from "@/data/item-limits.json";
import { clashes, clashWith, withoutClashes } from "@/lib/item-limits";

type Named = { name: string; icon: string | null };
type Card = { items: Named[]; rest: Named[]; full?: Named[]; later: Named[]; laterSlots: { slot: number; items: Named[] }[]; situational: (Named & { when: string; replaces?: Named })[] };
const id = (n: Named) => Number(/(\d+)\.png$/.exec(n.icon ?? "")?.[1] ?? NaN);

describe("item limits", () => {
  it("has the groups players run into", () => {
    const names = limits.map((g) => g.group);
    for (const g of ["LastWhisper", "LifelineItems", "VoidPen", "CleaveItems", "ImmolateItems", "Quicksilver"]) expect(names).toContain(g);
  });

  it("knows Lord Dominik's, Mortal Reminder and Terminus can't be owned together, Mayhem copies included", () => {
    expect(clashes(3036, 3033)).toBe(true);
    expect(clashes(223036, 3302)).toBe(true);
    expect(clashes(3135, 3302)).toBe(true); // Void Staff and Terminus share Void pen
    expect(clashes(3036, 3031)).toBe(false); // Infinity Edge is free
    expect(clashes(3036, 223036)).toBe(false); // the same item
    expect(clashWith(3033, [3031, 3036])).toBe(3036);
    expect(withoutClashes([3033, 3031, 3036, 6694], [3087])).toEqual([3033, 3031]);
  });

  it("keeps every build card free of clashes, and names what a clashing situational item replaces", async () => {
    const body = (await GET().json()) as { champions: (Card & { id: string; builds: (Card & { style: string })[] })[] };
    const bad: string[] = [];
    for (const c of body.champions)
      for (const card of [c, ...(c.builds ?? [])]) {
        const core = card.items.map(id);
        const check = (what: string, ids: number[]) => {
          ids.forEach((a, i) => ids.slice(i + 1).forEach((b) => clashes(a, b) && bad.push(`${c.id} ${what}: ${a} + ${b}`)));
        };
        check("core + rest", [...core, ...card.rest.map(id)]);
        check("full path", [...core, ...(card.full ?? []).map(id)]);
        for (const l of card.later) check("core + later", [...core, id(l)]);
        for (const s of card.laterSlots ?? []) for (const l of s.items) check(`core + slot ${s.slot}`, [...core, id(l)]);
        for (const s of card.situational) {
          const hit = clashWith(id(s), [...core, ...card.rest.map(id)]);
          if (hit !== undefined && !s.replaces) bad.push(`${c.id} situational ${s.name} clashes without replaces`);
        }
      }
    expect(bad).toEqual([]);
  }, 30_000); // walks every champion's build cards: ~2.5 s locally, over 5 s on a busy CI runner
});
