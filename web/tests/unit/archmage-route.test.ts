import { describe, expect, it } from "vitest";
import { archmageRoutes } from "@/lib/archmage-route";

// AP Ashe's build (data/estimates/build_archetypes.json): Malignance, Imperial Mandate, Horizon Focus, then
// Cryptbloom, Rabadon's, Shadowflame, Blackfire Torch, Nashor's Tooth; Ionian Boots. The targets come from
// data/estimates/ashe_archmage.json (data/estimates/ashe_archmage.js, AramHex's rule).
const POOL = [3118, 4005, 4628, 3137, 3089, 4645, 2503, 3115];
const IONIAN = 3158;

describe("AP Ashe's Archmage route", () => {
  const routes = archmageRoutes(POOL, IONIAN, () => 50);
  const by = (ids: number[]) => routes.find((r) => r.with.join("+") === ids.join("+"))!;

  it("has a route for Archmage alone and each loop augment set on the card", () => {
    expect(routes.map((r) => r.with)).toEqual([[], [1349], [3055], [2018], [1349, 3055]]);
    for (const r of routes) {
      expect(r.items[0]).toBe(IONIAN);
      expect(r.items.length).toBeLessThanOrEqual(6);
      expect(new Set(r.items).size).toBe(r.items.length);
    }
  });

  // Targets from the calculator checked against AramHex's Ashe page (2026-11-24): haste shortens Hawkshot's 5 s
  // gap, so a full loop is much faster and needs more haste than the old 12-per-minute reading.
  it("says when items alone can't reach Archmage alone's target", () => {
    const r = by([]);
    expect(r.reach).toBe(false);
    expect(r.need).toBe(200);
    expect(r.eRank).toBe(4);
    expect(r.haste).toBeLessThan(200);
  });

  it("says when items alone can't reach Ultimate Awakening's target", () => {
    const r = by([1349]);
    expect(r.reach).toBe(false);
    expect(r.need).toBe(125);
    expect(r.eRank).toBe(2);
    expect(r.haste).toBeLessThan(125);
  });

  it("reaches Ultimate Awakening and Recursion's target with the fewest items, most haste first", () => {
    const r = by([1349, 3055]);
    expect(r.reach).toBe(true);
    expect(r.need).toBe(70);
    expect(r.eRank).toBe(3);
    expect(r.routeLen).toBe(3);
    expect(r.items[0]).toBe(IONIAN);
    expect(r.haste).toBeGreaterThanOrEqual(70);
  });

  it("returns nothing without the targets file", () => {
    expect(archmageRoutes(POOL, IONIAN, () => 50, null as never)).toEqual([]);
  });
});
