import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { SPELL_KIT } from "@/components/champion/FewPlayers";

// data/estimates/rare_spell_reasons.json: every kit reason has its English template, and only rows whose edge holds
// carry one (mixed and tie rows show a data line only, Nico 2026-11-25).
const rows = JSON.parse(readFileSync("../data/estimates/rare_spell_reasons.json", "utf8")).champions as Record<
  string,
  { verdict: string; template: string | null; key: string; ability: string; spells: number[] }
>;

describe("rare spell reasons", () => {
  test("templates exist and follow the verdict", () => {
    for (const [alias, r] of Object.entries(rows)) {
      if (r.template) {
        expect(r.verdict, alias).toBe("holds");
        expect(SPELL_KIT[r.template], alias).toBeTruthy();
        if (SPELL_KIT[r.template].includes("{key}")) expect(r.key && r.ability, alias).toBeTruthy();
      }
      expect(r.spells.includes(4), alias).toBe(false);
    }
  });
});
