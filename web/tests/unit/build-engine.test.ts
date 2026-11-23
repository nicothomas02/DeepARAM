// The one build engine (lib/engine/build-engine.ts) the site and both apps share (Nico 2026-11-23). Small made-up data
// pins each rule; the last tests run the engine over every champion's real data.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET as overlayGET } from "@/app/data/overlay.json/route";
import { GET as kindsGET } from "@/app/data/damage-types.json/route";
import { GET as picksGET } from "@/app/data/augment-picks.json/route";
import {
  itemId,
  itemRules,
  plan,
  rankAugments,
  rerollAdvice,
  RULES,
  triggers,
  type Fit,
  type Kinds,
  type OverlayChamp,
  type Picks,
} from "@/lib/engine/build-engine";
import { bundleEngine, ENGINE_OUT } from "../../scripts/build-engine.mjs";

const icon = (id: number) => `/icons/items/${220000 + id}.png`;
const item = (id: number, extra: object = {}) => ({ name: `#${id}`, icon: icon(id), ...extra });

const kinds: Kinds = {
  champions: { lux: 0.95, brand: 0.95, annie: 0.9, jinx: 0.05, ashe: 0.1, garen: 0.1 },
  items: {
    3031: ["ad", "crit"], 3046: ["as", "crit"], 3087: ["as", "crit"], 3094: ["as", "crit"], 3036: ["ad", "armorpen"],
    3302: ["armor", "mr", "as"], 6333: ["ad", "armor"], 3065: ["mr"], 3075: ["armor"], 3003: ["ap"],
  },
  boots: [3006],
  recipes: Object.fromEntries([3006, 3031, 3046, 3087, 3094, 3036, 3302, 6333, 3065, 3075, 3003, 3153, 3091, 3124].map((id) => [String(id), [`#${id}`, id === 3006 ? 1100 : 3000, []]])),
  limits: [[3036, 3033, 3302]],
  substitutes: [[3046, 3087]],
};
const fit: Fit = { champions: { Jinx: [0, ["Marksman"]], Ashe: [0, ["Marksman"]], Lux: [0, ["Burst"]], Brand: [0, ["Burst"]], Annie: [0, ["Burst"]] } };
const champ: OverlayChamp = {
  id: "Ashe",
  items: [item(3006), item(3031), item(3046)],
  laterSlots: [
    { slot: 4, items: [item(3036)] },
    { slot: 5, items: [item(3094)] },
    { slot: 6, items: [item(6333)] },
  ],
  situational: [
    item(3065, { when: "Vs magic damage" }),
    item(3302, { when: "Vs auto attacks" }),
    item(3087, { when: "Fits your augment", augments: [9001] }),
    item(3003, { when: "Vs healing" }),
  ],
  destiny: item(3036),
};
const picks: Picks = {
  augments: Object.fromEntries(Array.from({ length: 12 }, (_, n) => [String(100 + n), [`Aug ${n}`, "gold"]])),
  champions: { Ashe: Array.from({ length: 12 }, (_, n) => [100 + n, 1 - n * 0.05] as [number, number]) },
  pairs: { Ashe: [[100, 111, 20]] },
  styles: { 2018: ["ap"] },
  builds: { Ashe: [["crit", 0.8, [3006], [3031, 3046, 3094], [3036]], ["onhit", 0.2, [3006], [3153, 3091, 3124], [3046]]] },
};
const game = (enemies: string[], extra: object = {}) => ({ champ: "Ashe", items: [], enemies: enemies.map((c) => ({ champ: c, items: [] })), ...extra });
const ids = (list: { icon: string | null }[]) => list.map((x) => itemId(x.icon));

describe("build engine", () => {
  it("ships the same code to both apps", () => {
    const js = bundleEngine();
    for (const f of ENGINE_OUT as string[]) expect(readFileSync(f, "utf8"), `${f} is stale: run node scripts/build-engine.mjs`).toBe(js);
  });

  it("keeps assumption rules off (Nico 2026-11-23: apply defaults, then test)", () => {
    for (const r of ["upgradeNext", "augmentReplan", "countTriggers", "stackingFirst", "attackSpeedNudge", "selfHealWeight", "wikiModifiers", "resistAugmentSwaps"])
      expect(RULES[r].on, r).toBe(false);
    for (const [name, r] of Object.entries(RULES)) if (r.on && r.source === "assumption") expect(r.why, name).toMatch(/Nico decides/);
    // only the triggers that passed a test
    expect(Object.keys(triggers(kinds, fit, game(["Lux", "Brand", "Annie"]).enemies))).toEqual(["Vs magic damage", "Vs auto attacks"]);
  });

  it("knows item limits and substitutes", () => {
    const r = itemRules(kinds);
    expect(r.clash(3036, 223302)).toBe(true);
    expect(r.clash(3036, 3036)).toBe(false);
    expect(r.substitute(3087, 223046)).toBe(true);
  });

  it("lays out the full path: core, then one pick per later slot", () => {
    const p = plan({ champ, kinds, picks, fit, game: game([]), taken: [] });
    expect(ids(p.path)).toEqual([3006, 3031, 3046, 3036, 3094, 6333]);
    expect(p.coreLen).toBe(3);
    expect(ids(p.next)).toEqual([3006, 3031]);
    expect(p.swaps).toEqual([]);
  });

  it("swaps in a proven counter for the last open slot vs a magic-heavy team", () => {
    const p = plan({ champ, kinds, picks, fit, game: game(["Lux", "Brand", "Annie"]), taken: [] });
    expect(p.swaps.map((s) => [itemId(s.item.icon), s.kind, itemId(s.replaces?.icon)])).toEqual([[3065, "proven", 6333]]);
  });

  it("replaces the item a counter can't be owned with, not the last slot", () => {
    const p = plan({ champ, kinds, picks, fit, game: game(["Jinx", "Ashe", "Garen"]), taken: [] });
    expect(p.swaps.map((s) => [itemId(s.item.icon), itemId(s.replaces?.icon)])).toEqual([[3302, 3036]]);
  });

  it("an augment item replaces its role substitute", () => {
    const p = plan({ champ, kinds, picks, fit, game: game([]), taken: [9001] });
    expect(p.swaps.map((s) => [itemId(s.item.icon), s.kind, itemId(s.replaces?.icon)])).toEqual([[3087, "augment", 3046]]);
  });

  it("adds measured augment items: Armored Impact -> Thornmail", () => {
    const p = plan({ champ, kinds, picks, fit, game: game([]), taken: [3049] });
    expect(p.swaps.map((s) => itemId(s.item.icon))).toContain(3075);
  });

  it("switches build only for measured augments (Ethereal Weapon -> on-hit)", () => {
    const on = plan({ champ, kinds, picks, fit, game: game([]), taken: [1029] });
    expect(on.switched?.style).toBe("On-hit");
    expect(ids(on.path)).toContain(3153);
    const off = plan({ champ, kinds, picks, fit, game: game([]), taken: [2018] });
    expect(off.switched).toBeNull();
  });

  it("Weapon of Destiny moves the champion's best Weapon item first; Upgrade X only labels it", () => {
    const wod = plan({ champ, kinds, picks, fit, game: game([]), taken: [3081] });
    expect(itemId(wod.next[0].icon)).toBe(3036);
    const up = plan({ champ, kinds, picks, fit, game: game([]), taken: [1336] });
    expect(ids(up.next)).toEqual([3006, 3031]);
    expect(up.why[1]).toMatch(/upgrades it/);
  });

  it("gives no % penetration tip and leaves stacking items where they are", () => {
    const c = { ...champ, laterSlots: [{ slot: 4, items: [item(3003)] }] };
    const p = plan({ champ: c, kinds, picks, fit, game: game(["Garen", "Jinx"], { dead: true, gold: 5000 }), taken: [] });
    expect(p.tips.map((t) => t.kind)).not.toContain("pen");
    expect(ids(p.next)[0]).toBe(3006);
  });

  it("leaves out augments already shown and cards already rerolled", () => {
    const seen = [111];
    const ranked = rankAugments(picks, "Ashe", [100], { seen });
    expect(ranked.find((a) => a.combo === 111)).toBeUndefined(); // ...but adds no combo potential
    const offered = [{ id: 109 }, { id: 110 }, { id: 108 }];
    const first = rerollAdvice(picks, ranked, offered, [100], { seen });
    expect(first?.action).toBe("reroll");
    const again = rerollAdvice(picks, ranked, offered, [100], { seen, rerolled: offered.map((o) => o.id) });
    expect(again?.card ?? null).toBeNull();
  });

  it("never plans two items of one limit group, on any champion's real data", async () => {
    const champs = ((await overlayGET().json()) as { champions: OverlayChamp[] }).champions;
    const k = (await kindsGET().json()) as Kinds;
    const pk = (await picksGET().json()) as Picks;
    const rules = itemRules(k);
    const bad: string[] = [];
    for (const c of champs)
      for (const taken of [[], [3081], [1029], [3049]]) {
        const p = plan({ champ: c, kinds: k, picks: pk, fit: null, game: { champ: c.id, items: [] }, taken });
        const path = ids(p.path);
        path.forEach((a, i) => path.slice(i + 1).forEach((b) => rules.clash(a, b) && bad.push(`${c.id} [${taken}]: ${a} + ${b}`)));
      }
    expect(bad).toEqual([]);
    expect(champs.filter((c) => c.destiny).length).toBeGreaterThan(100);
  }, 60_000);
});
