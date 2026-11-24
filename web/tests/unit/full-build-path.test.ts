import { describe, expect, it } from "vitest";
import { championPage } from "@/lib/champion-page";
import { buildOrder, type ItemRow } from "@/lib/card-score";
import ids from "@/data/champion-ids.json";

// The card's full build path (core, then the best pick for each later slot) never lists an item twice (Nico 2026-11-24),
// counting an item's Mayhem and regular versions (same last four digits) as one.
describe("full build path", () => {
  it("has no item twice, for every champion and build", () => {
    let paths = 0;
    for (const alias of Object.keys(ids)) {
      const p = championPage(alias);
      if (!p) continue;
      const cores: ItemRow[] = [p.core[0], ...p.builds.map((b) => b.core), ...p.buildStyles.map((s) => s.core)].filter(Boolean) as ItemRow[];
      for (const core of cores) {
        const path = [...buildOrder(core), ...(core.full ?? []).map((r) => r.items[0])].map((x) => x % 10000);
        paths++;
        expect(new Set(path).size, `${alias}: ${path.join(",")}`).toBe(path.length);
      }
    }
    expect(paths).toBeGreaterThan(150);
  }, 300000);
});
