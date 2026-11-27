import { describe, expect, it } from "vitest";
import { publicPair } from "@/lib/synergy-picks";
import { ownerPairs } from "@/lib/owner-view";
import { publicSynergies, type SynTab } from "@/lib/synergies";

// The public site shows no augment win-rate points (Riot's developer policy, Nico 2026-11-27); the owner gets them back.
describe("owner view", () => {
  it("public synergy pairs keep only their direction, and the owner's points come back", () => {
    const pairs = [
      { a: 1, b: 2, points: 2.4, rule: true, why: "x" },
      { a: 3, b: 4, points: -1.2, order: [-1.2, 0.5] as [number, number], rule: true },
    ];
    const pub = pairs.map(publicPair);
    expect(pub.map((p) => p.points)).toEqual([1, -1]);
    expect(pub[1].order).toEqual([-1, 1]);
    expect(JSON.stringify(pub)).not.toMatch(/2\.4|1\.2|0\.5/);
    expect(ownerPairs(pub, [[1, 2, 2.4], [3, 4, -1.2, -1.2, 0.5]])).toEqual(pairs);
  });

  it("public synergies drop augment win-rate scores and list by pick rate", () => {
    const tab: SynTab = {
      id: "champions",
      label: "Champions",
      what: "Champion",
      note: "with pts",
      publicNote: "without",
      augmentPoints: true,
      rows: [
        { names: [{ kind: "champions", id: "A", name: "A" }], score: 0.05, pick: 0.1 },
        { names: [{ kind: "champions", id: "B", name: "B" }], score: 0.01, pick: 0.3 },
      ],
    };
    const items: SynTab = { id: "items", label: "Items", what: "Item", note: "", rows: [{ names: [], score: 0.02, pick: 0.5 }] };
    const [champs, kept] = publicSynergies([tab, items]);
    expect(champs.rows.map((r) => r.names[0].id)).toEqual(["B", "A"]);
    expect(champs.rows.some((r) => "score" in r)).toBe(false);
    expect(champs.note).toBe("without");
    expect(champs.ownerNote).toBe("with pts");
    expect(kept.rows[0].score).toBe(0.02);
  });
});
