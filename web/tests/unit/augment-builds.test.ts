// The champion page's "Build for your augments" picker (lib/augment-builds.ts, data/estimates/augment_builds.py):
// every simulated build resolves to real items with icons and to known augments, and "changes your build" only
// marks augments whose build really differs from the no-augment one.
import { describe, expect, it } from "vitest";
import augmentNames from "@/data/augment-names.json";
import { augmentBuilds, buildChangers, CHANGES_BUILD } from "@/lib/augment-builds";
import { champList } from "@/lib/champions";

describe("augment builds", () => {
  const champs = champList().map((c) => c.id);
  const all = champs.flatMap((id) => {
    const b = augmentBuilds(id);
    return b ? [[id, b] as const] : [];
  });

  it("covers most champions", () => {
    expect(all.length).toBeGreaterThan(champs.length * 0.8);
  });

  it("resolves items and augments", () => {
    for (const [id, b] of all) {
      expect(b.base.length, id).toBeGreaterThanOrEqual(5);
      for (const x of b.builds) {
        expect([1, 2], id).toContain(x.augments.length);
        for (const a of x.augments) expect((augmentNames as Record<string, string>)[String(a)], `${id} ${a}`).toBeTruthy();
        expect(x.items.length, `${id} ${x.augments}`).toBeGreaterThanOrEqual(5);
        // Each item's details are sent once per page, in b.items.
        for (const it of x.items) expect(b.items[it]?.icon, `${id} ${it}`).toBeTruthy();
      }
    }
  });

  it("marks only augments that change the build", () => {
    for (const [id, b] of all) {
      const base = new Set(b.base);
      for (const a of buildChangers(id)) {
        const x = b.builds.find((y) => y.augments.length === 1 && y.augments[0] === a)!;
        expect(x.items.filter((i) => !base.has(i)).length, `${id} ${a}`).toBeGreaterThanOrEqual(CHANGES_BUILD);
      }
    }
  });
});
