// The Apple TV app decodes /data/tv.json (apps/tvos/DeepARAMTVKit/.../TVData.swift); these checks keep the
// fields it needs present and in the shape it expects.
import { describe, expect, it } from "vitest";
import { tvData } from "@/lib/tv";

describe("Apple TV data", () => {
  const d = tvData();

  it("uses the public patch number", () => {
    expect(d.patch).toMatch(/^2\d\.\d{1,2}$/);
  });

  it("has champions with tiers, icons and quick builds", () => {
    expect(d.champions.length).toBeGreaterThan(150);
    expect(d.champions.filter((c) => c.tier).length).toBeGreaterThan(100);
    for (const c of d.champions) {
      expect(c.icon).toBe(`/icons/champions/${c.id}.webp`);
      expect(Object.keys(c.augments).sort()).toEqual(["gold", "prismatic", "silver"]);
      for (const i of c.items) expect(i.name).toBeTruthy();
    }
  });

  it("has an augment tier list for every rarity", () => {
    for (const r of ["prismatic", "gold", "silver"]) expect(d.augments.filter((a) => a.rarity === r).length).toBeGreaterThan(5);
    for (const a of d.augments) expect(a.tier).toBeTruthy();
  });

  it("carries the PBE changes when there are any", () => {
    if (!d.pbe) return;
    expect(d.pbe.label).toBeTruthy();
    expect(Array.isArray(d.pbe.augments.changed)).toBe(true);
    expect(Array.isArray(d.pbe.modeChanges)).toBe(true);
  });
});
