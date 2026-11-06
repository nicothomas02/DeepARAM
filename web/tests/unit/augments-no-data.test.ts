// Live augments without stats yet (data/cn/augments.json no_data) are listed on the Tier List, so every augment in
// the pool shows up there (Nico 2026-11-06: Tickle Monster and others were missing).
import { describe, expect, it } from "vitest";
import augmentNames from "@/data/augment-names.json";
import { augmentRows, augmentsWithoutData } from "@/lib/augment-winrate";

describe("augments with no stats yet", () => {
  it("are live augments with a name and rarity, and never also in the stats", () => {
    const withStats = new Set(augmentRows().map((a) => a.augment_id));
    for (const a of augmentsWithoutData()) {
      expect(withStats.has(a.augment_id), a.name).toBe(false);
      expect((augmentNames as Record<string, string>)[String(a.augment_id)] ?? a.name, String(a.augment_id)).toBeTruthy();
      expect(["Silver", "Gold", "Prismatic"]).toContain(a.tier);
    }
  });
});
