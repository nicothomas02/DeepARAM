import { describe, expect, it } from "vitest";
import ids from "@/data/champion-ids.json";
import { championPage, STARTING_GOLD } from "@/lib/champion-page";
import { itemRecipe } from "@/lib/items";

// Nico 2026-11-24: the default start mustn't come from an augment rush, and no card or build style is left without
// a start (data/estimates/first_item_starts.py fills the ones the feeds don't cover, marked estimated).
describe("starting items on the cards", () => {
  const pages = Object.keys(ids)
    .filter((a) => !a.startsWith("Jade_"))
    .flatMap((a) => {
      const p = championPage(a);
      return p ? [[a, p] as const] : [];
    });

  it("give every card and every build style a start", () => {
    const missing = pages.flatMap(([a, p]) => [
      ...(p.core.length && !p.cardStart ? [`${a} card`] : []),
      ...p.builds.filter((b) => !b.start).map((b) => `${a} ${b.style}`),
    ]);
    expect(missing).toEqual([]);
  }, 600000);

  it("never default to a start an augment drives", () => {
    const driven = pages.flatMap(([a, p]) => (p.cardStart?.augment ? [a] : []));
    expect(driven).toEqual([]);
  }, 600000);

  // Nico 2026-11-24: a start above the starting gold needs extra gold (the Debonair headliner, Upgrade augments).
  it("never default to a start above the starting gold", () => {
    const cost = (items: number[]) => items.reduce((s, i) => s + (itemRecipe(i)?.price ?? 0), 0);
    const over = pages.flatMap(([a, p]) => [p.cardStart, ...p.builds.map((b) => b.start)].flatMap((r) => (r && cost(r.items) > STARTING_GOLD ? [`${a}: ${r.items.join("+")}`] : [])));
    expect(over).toEqual([]);
  }, 600000);
});
