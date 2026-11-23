import { describe, expect, it } from "vitest";
import { buildWhy } from "@/lib/why-best";
import { AUGMENT_ITEMS, MIN_HOLDERS } from "@/lib/engine/build-engine";
import augmentItems from "@/data/augment-items.json";

describe("buildWhy (champion card's Why these items)", () => {
  it("gives reasons only for items in the build, and only gains as 'what it does'", () => {
    // Ornn's usual items: Heartsteel and Warmog's are built by most Ornn players; Unending Despair has a mechanism.
    const ids = [3084, 3083, 2502, 6665];
    const w = buildWhy("Ornn", ids);
    for (const id of [...w.follow, ...w.lines.map((l) => l.id)]) expect(ids).toContain(id);
    for (const l of w.lines)
      for (const e of l.effects ?? []) expect(e.n.startsWith(e.metric === "deaths" ? "-" : "+")).toBe(true);
  });
});

describe("augment -> item tips", () => {
  it("drop pairs with too few holders for a with-vs-without comparison", () => {
    expect(AUGMENT_ITEMS.every((p) => p.holders >= MIN_HOLDERS)).toBe(true);
    expect(AUGMENT_ITEMS.length).toBe(augmentItems.pairs.filter((p) => p.holders >= MIN_HOLDERS).length);
  });
});
