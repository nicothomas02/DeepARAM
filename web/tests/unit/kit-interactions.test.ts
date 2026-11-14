import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import augmentNames from "@/data/augment-names.json";
import { championAliases } from "@/lib/champions";
import { championPage } from "@/lib/champion-page";
import { allKitInteractions, kitInteractions, MIN_INTERACTION_PICK } from "@/lib/kit-interactions";

// The champion page's "Kit interactions" panel (data/kit-interactions.json).
describe("kit interactions", () => {
  const all = allKitInteractions();
  const aliases = new Set(championAliases());
  const en = JSON.parse(readFileSync(join(process.cwd(), "public", "i18n", "kit-interactions", "en.json"), "utf8"));

  it("names real champions, augments and ability keys, and every text is in the dictionary", () => {
    expect(all.length).toBeGreaterThan(50);
    for (const x of all) {
      expect(aliases.has(x.champion), x.champion).toBe(true);
      expect((augmentNames as Record<string, string>)[x.augment], `${x.champion} ${x.augment}`).toBeTruthy();
      for (const k of x.keys) expect(["P", "Q", "W", "E", "R"]).toContain(k);
      expect(en[x.text], x.text).toBe(x.text);
    }
  });

  it("lists each champion and augment pair once", () => {
    const pairs = all.map((x) => `${x.champion}/${x.augment}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("shows only augments the champion's players take, most taken first", () => {
    const taken = [
      { id: 2087, pickRate: 0.08 },
      { id: 1077, pickRate: 0.01 },
    ];
    const rows = kitInteractions("ashe", taken);
    expect(rows.map((r) => r.augment)).toEqual([2087]);
    expect(rows[0].pickRate).toBeGreaterThanOrEqual(MIN_INTERACTION_PICK);
    expect(kitInteractions("Ashe", [])).toEqual([]);
  });

  it("puts Archmage on Ashe's live page", () => {
    const p = championPage("Ashe")!;
    expect(kitInteractions("Ashe", p.augments).some((r) => r.augment === 2087)).toBe(true);
  });
});
