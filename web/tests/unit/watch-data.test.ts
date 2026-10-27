// /data/watch.json feeds the Apple Watch app (apps/watchos). These checks keep its shape in step with
// WatchData.swift and its picks in step with the champion page's quick build.
import { describe, expect, it } from "vitest";
import { GET } from "@/app/data/watch.json/route";

type Champ = {
  id: string;
  name: string;
  tier: string | null;
  winRate: number | null;
  skills: string[];
  spells: string[];
  items: string[];
  augments: Record<"prismatic" | "gold" | "silver", string[]>;
};

describe("watch.json", async () => {
  const body = (await GET().json()) as { patch: string | null; champions: Champ[] };

  it("names the patch the way players do", () => {
    expect(body.patch).toMatch(/^2\d\.\d{1,2}$/);
  });

  it("has a quick build for every champion", () => {
    expect(body.champions.length).toBeGreaterThan(150);
    const withBuild = body.champions.filter((c) => c.items.length >= 3 && c.skills.length === 3);
    expect(withBuild.length / body.champions.length).toBeGreaterThan(0.9);
    for (const c of body.champions) {
      expect(c.items.length).toBeLessThanOrEqual(7);
      expect(new Set(c.items).size).toBe(c.items.length);
      for (const r of ["prismatic", "gold", "silver"] as const) expect(c.augments[r].length).toBeLessThanOrEqual(3);
    }
  });

  it("lists boots once", () => {
    const boots = /Boots|Greaves|Treads|Shoes|Steelcaps|Swiftmarch|Crushers|Advance|Spellslinger|Gunmetal|Chainlaced|Armored/;
    for (const c of body.champions) expect(c.items.filter((i) => boots.test(i)).length).toBeLessThanOrEqual(1);
  });
});
