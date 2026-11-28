import { describe, expect, it } from "vitest";
import { GET } from "@/app/data/damage-types.json/route";
import type { Kinds } from "@/lib/engine/build-engine";

// 2026-11-28 replay of every archived game through the engine (web/tests/unit/engine-sanity.test.ts): items took the
// stats of an Arena item sharing their last four digits, and champions their Data Dragon rating over measured damage.
describe("damage types feed", () => {
  const feed = async () => (await GET().json()) as Kinds;

  it("gives each item its own stats, not those of another item with the same last four digits", async () => {
    const k = await feed();
    expect(k.items["3084"] ?? []).not.toContain("ad"); // Heartsteel (773084 is Innervating Locket)
    expect(k.items["3109"] ?? []).not.toContain("ad"); // Knight's Vow (773109 is Madred's Bloodrazor)
    expect(k.items["3050"] ?? []).not.toContain("ad"); // Zeke's Convergence (773050 is Stark's Fervor)
    expect(k.items["3161"]).toContain("ad"); // Spear of Shojin (773161 is Moonflair Spellblade)
    expect(k.items["3161"]).not.toContain("ap");
    expect(k.items["3073"]).toContain("ult"); // Experimental Hexplate works through the ultimate
  });

  it("reads each champion's damage type from measured games where there are enough", async () => {
    const k = await feed();
    expect(k.champions.Qiyana).toBeLessThan(0.5); // Data Dragon rates her all magic
    for (const c of ["Seraphine", "Vex", "TwistedFate", "Gwen"]) expect(k.champions[c], c).toBeGreaterThan(0.5);
    expect(k.champions.Lux).toBeGreaterThan(0.8);
    expect(k.champions.Jinx).toBeLessThan(0.2);
  });
});
