// /data/overlay.json feeds the desktop app's in-game overlay (apps/desktop/ui/overlay.html). These checks keep
// it in step with the champion page's quick build (shared with /data/watch.json) and within Riot's overlay
// rules: static picks only, no augment win rates.
import { describe, expect, it } from "vitest";
import { GET } from "@/app/data/overlay.json/route";
import { GET as watch } from "@/app/data/watch.json/route";

type Named = { name: string; icon: string | null };
type Champ = {
  id: string;
  name: string;
  icon: string;
  skills: string[];
  spells: Named[];
  items: Named[];
  augments: Record<"prismatic" | "gold" | "silver", Named[]>;
};

describe("overlay.json", async () => {
  const body = (await GET().json()) as { patch: string | null; champions: Champ[] };
  const watchBody = (await watch().json()) as { champions: { id: string; items: string[]; augments: Record<string, string[]> }[] };

  it("names the patch the way players do", () => {
    expect(body.patch).toMatch(/^2\d\.\d{1,2}$/);
  });

  it("has every champion with icons for the build", () => {
    expect(body.champions.length).toBeGreaterThan(150);
    for (const c of body.champions) {
      expect(c.icon).toBe(`/icons/champions/${c.id}.webp`);
      for (const r of ["prismatic", "gold", "silver"] as const) {
        expect(c.augments[r].length).toBeLessThanOrEqual(3);
        for (const a of c.augments[r]) expect(a.icon).toMatch(/^\/icons\/augments\/\d+\.webp$/);
      }
    }
  });

  it("matches the watch app's quick build", () => {
    const byId = new Map(watchBody.champions.map((c) => [c.id, c]));
    for (const c of body.champions) {
      const w = byId.get(c.id)!;
      expect(c.items.map((i) => i.name)).toEqual(w.items);
      expect(c.augments.gold.map((a) => a.name)).toEqual(w.augments.gold);
    }
  });

  it("carries no win rates, pick rates or tiers", () => {
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/winRate|pickRate|deepScore|"tier"/);
  });
});

describe("overlay augments follow the champion page", () => {
  it("ranks each champion's augments on that champion, not by the overall tier rating", async () => {
    const { quickBuilds } = await import("@/lib/quick-build");
    const { championPage } = await import("@/lib/champion-page");
    const { championAugmentScores } = await import("@/lib/champion-augment-scores");
    const yasuo = quickBuilds().find((c) => c.id === "Yasuo")!;
    const p = championPage("Yasuo")!;
    const scores = championAugmentScores("Yasuo", p.augments);
    const top = [...p.augments]
      .filter((a) => a.rarity === "prismatic")
      .sort((x, y) => (scores.get(y.id) ?? -1) - (scores.get(x.id) ?? -1) || y.pickRate - x.pickRate)[0];
    expect(yasuo.augments.prismatic[0]?.name).toBe(top.name);
  });
});
