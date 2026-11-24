import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { synergyWhyTemplate } from "@/lib/synergy-picks";
import names from "@/data/augment-names.json";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("augment synergy reasons", () => {
  it("translate as templates with the augment names filled in", () => {
    expect(synergyWhyTemplate("Overflow's higher mana costs feed Blue Barrier.", [["Blue Barrier", 1], ["Overflow", 2]])).toEqual({ key: "{1}'s higher mana costs feed {2}.", ids: [2, 1] });
  });

  it("have a translation for every reason in the data, in every language", () => {
    const syn = read("../data/estimates/augment_synergy.json") as { champions: Record<string, { a: number; b: number; why?: string }[]> };
    const n = names as Record<string, string>;
    const keys = new Set(
      Object.values(syn.champions).flatMap((pairs) =>
        pairs.filter((p) => p.why).map((p) => synergyWhyTemplate(p.why!, [[n[p.a] ?? "", p.a], [n[p.b] ?? "", p.b]]).key),
      ),
    );
    for (const lang of ["fr", "de", "ja", "zh-CN"]) {
      const d = read(`public/i18n/champions/${lang}.json`);
      for (const k of keys) expect(d[k], `${lang}: ${k}`).toBeTruthy();
    }
  });
});
