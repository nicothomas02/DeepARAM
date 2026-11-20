// Weapon of Destiny and Pentakill tabs (Nico 2026-11-20): predicted from real picks, never the Simulator, and they
// must make sense in game: the items players really make their Weapon lead, Infinity Edge's lone crit damage
// doesn't top the list, and every champion's likely Weapon is an item it builds.
import { describe, expect, it } from "vitest";
import championIds from "@/data/champion-ids.json";
import { predictedDestiny, predictedDestinyByChampion, predictedPentakill } from "@/lib/predicted-tabs";

describe("predicted Weapon of Destiny", () => {
  const d = predictedDestiny()!;

  it("ranks the Weapons players really pick first, with shares that add up", () => {
    expect(d.gold).toBe(200);
    const top = [...d.rows].sort((a, b) => b.share - a.share);
    const top5 = top.slice(0, 5).map((r) => r.name);
    for (const name of ["Shadowflame", "Endless Hunger", "Heartsteel"]) expect(top5).toContain(name);
    expect(top[0].name).not.toBe("Infinity Edge");
    const total = d.rows.reduce((s, r) => s + r.share, 0);
    expect(total).toBeGreaterThan(0.95);
    expect(total).toBeLessThan(1.01);
    for (let k = 1; k < top.length; k++) expect(top[k].score).toBeLessThanOrEqual(top[k - 1].score);
  });

  it("gives champions up to three different likely Weapons", () => {
    const rows = predictedDestinyByChampion();
    expect(rows.length).toBeGreaterThan(150);
    for (const r of rows) {
      expect(championIds, r.champion).toHaveProperty(r.champion);
      expect(r.items.length, r.champion).toBeLessThanOrEqual(3);
      expect(new Set(r.items.map((i) => i.id)).size, r.champion).toBe(r.items.length);
    }
    // Mages lean on Shadowflame, marksmen on crit items.
    const by = new Map(rows.map((r) => [r.champion, r.items.map((i) => i.name)]));
    expect(by.get("Ahri")).toContain("Shadowflame");
    expect(by.get("Draven")!.some((n) => ["Infinity Edge", "Lord Dominik's Regards", "The Collector", "Yun Tal Wildarrows"].includes(n))).toBe(true);
  });
});

describe("predicted Pentakill", () => {
  const rows = predictedPentakill();

  it("predicts a basic ability with its name and icon, only where picks back it", () => {
    expect(rows.length).toBeGreaterThan(40);
    for (const r of rows) {
      expect(championIds, r.champion).toHaveProperty(r.champion);
      expect(["Q", "W", "E"], r.champion).toContain(r.start);
      expect(r.name, r.champion).toBeTruthy();
      expect(r.icon, r.champion).toMatch(/^\/assets\//);
      expect(["high", "medium", "low"]).toContain(r.confidence);
    }
  });

  it("matches kits players know", () => {
    const by = new Map(rows.map((r) => [r.champion, r.start]));
    // Ezreal's Q and Sett's W carry their kits.
    expect(by.get("Ezreal")).toBe("Q");
    expect(by.get("Sett")).toBe("W");
  });
});
