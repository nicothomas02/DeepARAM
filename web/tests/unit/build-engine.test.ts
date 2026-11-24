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
  LUCKY_TILT,
  luckyBuild,
  luckyOrder,
  whyBest,
  plan,
  rankAugments,
  rerollAdvice,
  RULES,
  situational,
  skillUp,
  triggers,
  type Fit,
  type Kinds,
  type OverlayChamp,
  type Picks,
  shiftOf,
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
    for (const [name, r] of Object.entries(RULES)) if (r.on && r.source === "assumption") expect(r.why, name).toMatch(/Nico (decides|approved)/);
    // only the triggers that passed a test
    expect(Object.keys(triggers(kinds, fit, game(["Lux", "Brand", "Annie"]).enemies))).toEqual(["Vs magic damage", "Vs auto attacks"]);
  });

  it("lists situational items best DeepScore first (Nico 2026-11-24)", () => {
    const c = { ...champ, situational: [item(3065, { when: "Vs magic damage", deepScore: 40 }), item(3003, { when: "Vs healing", deepScore: 70 }), item(3302, { when: "Vs auto attacks" })] };
    expect(ids(situational(c, kinds, fit, [], [], new Set()))).toEqual([3003, 3065, 3302]);
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

  it("confirmed augment items keep their measured line; other augments' items come as estimated swaps", () => {
    const c = { ...champ, laterSlots: [{ slot: 4, items: [item(3036)] }, { slot: 5, items: [item(3094)] }] };
    const p = plan({ champ: c, kinds, picks, fit, game: game([]), taken: [1134] });
    const dd = p.swaps.find((s) => itemId(s.item.icon) === 6333);
    expect(dd?.why).toMatch(/With Draw Your Sword, \d+% of players build Death's Dance/);
    // Armored Impact isn't a confirmed pair: Thornmail may come (Nico 2026-11-24: all augments change the build), but
    // only labeled estimated, never with the confirmed "x% of players build" line
    const ai = plan({ champ, kinds, picks, fit, game: game([]), taken: [3049] }).swaps.find((s) => itemId(s.item.icon) === 3075);
    if (ai) expect(ai.why).toMatch(/\(estimated\)$/);
  });

  it("switches build only for measured augments (Ethereal Weapon -> on-hit)", () => {
    const on = plan({ champ, kinds, picks, fit, game: game([]), taken: [1029] });
    expect(on.switched?.style).toBe("On-hit");
    expect(ids(on.path)).toContain(3153);
    const off = plan({ champ, kinds, picks, fit, game: game([]), taken: [2018] });
    expect(off.switched).toBeNull();
  });

  it("Weapon of Destiny moves the champion's best Weapon item first; measured augments move their item up", () => {
    const wod = plan({ champ, kinds, picks, fit, game: game([]), taken: [3081] });
    expect(itemId(wod.next[0].icon)).toBe(3036);
    // Upgrade Infinity Edge: IE is a 1st/2nd legendary for 83% of holders vs 52% without (augmentShift)
    const up = plan({ champ, kinds, picks, fit, game: game([]), taken: [1336] });
    expect(ids(up.next)).toEqual([3031, 3006]);
    expect(up.timing[0].because).toMatch(/buy this earlier/);
    expect(up.why[ids(up.path).indexOf(3031)]).toMatch(/upgrades it/);
    // a pull too small to matter (Ethereal Weapon -> Nashor's, shrunk) moves nothing on its own
    expect(Math.abs(shiftOf([1029], 3115).early)).toBeLessThan(0.05);
  });

  it("puts a finished item you own off the path into the first open later slot", () => {
    const p = plan({ champ, kinds, picks, fit, game: game([], { items: [3006, 3031, 3075] }), taken: [] });
    expect(ids(p.path)).toEqual([3006, 3031, 3046, 3075, 3094, 6333]);
    expect(ids(p.next)[0]).toBe(3046);
  });

  it("caps the path at six items with boots, like the site's card", () => {
    const c = { ...champ, items: [item(3006), item(3031), item(3046), item(3065)] };
    expect(plan({ champ: c, kinds, picks, fit, game: game([]), taken: [] }).path).toHaveLength(6);
  });

  it("reads the enemy damage lean from the champions, not their items; haste is math only", () => {
    const apItems = { champ: "Garen", items: [3003, 3003, 3003, 3003] };
    expect(triggers(kinds, fit, [apItems, apItems, apItems])["Vs magic damage"]).toBe("");
    const p = plan({ champ, kinds, picks, fit, game: game([], { stats: [0, 1, 150] }), taken: [] });
    for (const t of p.tips) expect(t.text).not.toMatch(/adds less/);
  });

  it("Feeling lucky lets a rarer pick pass only options it roughly ties", () => {
    const rows = [
      { id: 1, score: 3.0, se: 0.3, pick: 0.3 },
      { id: 2, score: 2.9, se: 0.3, pick: 0.02 }, // near-tie and rare: passes 1
      { id: 3, score: 1.0, se: 0.3, pick: 0.01 }, // rare but clearly worse: stays last
      { id: 4, score: 2.0, se: 0.3, pick: 0.2 },
    ];
    const out = luckyOrder(rows, (r) => r.se, (r) => r.pick);
    expect(out.map((r) => r.id)).toEqual([2, 1, 4, 3]);
    expect(out.find((r) => r.id === 2)!.tilt).toBeLessThanOrEqual(LUCKY_TILT);
    // no uncertainty, no tilt
    expect(luckyOrder(rows, () => null, (r) => r.pick).map((r) => r.id)).toEqual([1, 2, 4, 3]);
  });

  it("Feeling lucky takes the less played build style when it wins about as often", () => {
    const off = { style: "ap", share: 0.2, nearBest: true, items: [item(3006), item(3003)] };
    const c = { ...champ, builds: [{ style: "crit", share: 0.8, items: champ.items }, off] };
    expect(luckyBuild(c)?.style).toBe("ap");
    expect(plan({ champ: c, kinds, picks, fit, game: game([]), taken: [], lucky: true }).luckyStyle).toBe("ap");
    expect(plan({ champ: c, kinds, picks, fit, game: game([]), taken: [] }).luckyStyle).toBeNull();
    expect(luckyBuild({ ...c, builds: [c.builds[0], { ...off, nearBest: false }] })).toBeNull();
  });

  it("says why an item is there only from tested reasons", () => {
    const why = { follow: { Ashe: { "3031": 0.6 } }, kit: { "3036": "physical" as const, "3075": "tank" as const }, traits: { Ashe: { physical: true, tank: false, melee: false } } };
    expect(whyBest(3031, "Ashe", "Ashe", [], why)?.text).toBe("Built by most Ashe players.");
    expect(whyBest(3036, "Ashe", "Ashe", [], why)?.text).toBe("Fits Ashe's physical damage.");
    expect(whyBest(3075, "Ashe", "Ashe", [], why)).toBeNull(); // Ashe isn't a tank
    expect(whyBest(6333, "Ashe", "Ashe", [1134], why)?.kind).toBe("augment");
    const profiles = { items: { "3094": { damage: { change: 12, z: 4 }, healing: { change: 30, z: 1 } } } };
    expect(whyBest(3094, "Ashe", "Ashe", [], why, profiles)).toEqual({ text: "What it does: +12% damage to champions (estimated).", kind: "does", estimated: true });
    expect(whyBest(3046, "Ashe", "Ashe", [], why, profiles)).toBeNull();
    // A loss is no reason (Stormsurge -14% damage blocked); fewer deaths is a gain.
    const losses = { items: { "4646": { mitigated: { change: -14, z: -5 } }, "3026": { deaths: { change: -0.5, z: -4 } } } };
    expect(whyBest(4646, "Ashe", "Ashe", [], why, losses)).toBeNull();
    expect(whyBest(3026, "Ashe", "Ashe", [], why, losses)?.kind).toBe("does");
    const p = plan({ champ, kinds, picks, fit, game: game([]), taken: [], why });
    expect(p.reasons).toHaveLength(p.path.length);
    expect(p.reasons[1]?.kind).toBe("follow");
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

  it("AP Ashe with Archmage follows the haste route for the loop augments taken, Hawkshot capped at its rank", () => {
    const c: OverlayChamp = {
      ...champ,
      skills: ["Q", "W", "E"],
      archmage: {
        augment: 2087,
        style: "ap",
        skills: ["W", "Q", "E"],
        routes: [
          { with: [], eRank: 4, need: 160, reach: false, items: [item(3006), item(3031), item(3046)], routeLen: 2 },
          { with: [1349], eRank: 1, need: 40, reach: true, items: [item(3006), item(3003), item(3036)], routeLen: 1 },
        ],
      },
    };
    expect(ids(plan({ champ: c, kinds, picks, fit, game: game([]), taken: [] }).path).slice(0, 3)).toEqual([3006, 3031, 3046]);
    const p = plan({ champ: c, kinds, picks, fit, game: game([]), taken: [2087, 1349] });
    expect(ids(p.path)).toEqual([3006, 3003, 3036]);
    expect(p.coreLen).toBe(2);
    expect(p.rules).toContain("archmageRoute");
    expect(p.switched?.style).toMatch(/^ap/);
    expect(p.why[1]).toMatch(/40 Ability Haste.*rank 1/);
    // Hawkshot stays at rank 1: at level 4 with Q1 W1 E1, the point goes to W (the AP order), never E.
    const tip = plan({ champ: c, kinds, picks, fit, game: game([], { level: 4, skills: [1, 1, 1, 0] }), taken: [2087, 1349] }).tips.find((t) => t.kind === "skill");
    expect(tip?.text).toBe("W");
    expect(skillUp(["E", "Q", "W"], [2, 2, 1, 1], 7, [], "Ashe", 1)).toBe("Q");
  });

  it("switches the skill order once an augment that changes it is taken (Gwen E>Q>W with Ethereal Weapon)", async () => {
    const c: OverlayChamp = { ...champ, skills: ["Q", "E", "W"], augmentSkills: [{ augment: 1029, skills: ["E", "Q", "W"] }] };
    const tip = (taken: number[]) =>
      plan({ champ: c, kinds, picks, fit, game: game([], { level: 4, skills: [1, 1, 1, 0] }), taken }).tips.find((t) => t.kind === "skill")?.text;
    expect(tip([])).toBe("Q");
    expect(tip([1029])).toBe("E");
    expect(plan({ champ: c, kinds, picks, fit, game: game([]), taken: [1029] }).rules).toContain("augmentSkills");
    // Gwen's live order is E>Q>W in every game (Nico 2026-11-24, lib/augment-skills.ts CHAMPION_SKILLS), in every
    // build style, so her Ethereal Weapon entry is gone.
    const gwen = ((await overlayGET().json()) as { champions: OverlayChamp[] }).champions.find((x) => x.id === "Gwen");
    expect(gwen?.skills).toEqual(["E", "Q", "W"]);
    expect(gwen?.augmentSkills).toBeUndefined();
    for (const b of (gwen as unknown as { builds: { skills: string[] }[] }).builds) expect(b.skills).toEqual(["E", "Q", "W"]);
  });

  it("never plans two items of one limit group, on any champion's real data", async () => {
    const champs = ((await overlayGET().json()) as { champions: OverlayChamp[] }).champions;
    const k = (await kindsGET().json()) as Kinds;
    const pk = (await picksGET().json()) as Picks;
    const rules = itemRules(k);
    const bad: string[] = [];
    for (const c of champs)
      for (const taken of [[], [3081], [1029], [1152]]) {
        const p = plan({ champ: c, kinds: k, picks: pk, fit: null, game: { champ: c.id, items: [] }, taken });
        const path = ids(p.path);
        if (path.length > 6) bad.push(`${c.id} [${taken}]: ${path.length} items`);
        // with no augments, the app shows the site card's path
        if (!taken.length && c.full?.length && path.slice(p.coreLen).join() !== ids(c.full).join()) bad.push(`${c.id}: path differs from the site card`);
        path.forEach((a, i) => path.slice(i + 1).forEach((b) => rules.clash(a, b) && bad.push(`${c.id} [${taken}]: ${a} + ${b}`)));
      }
    expect(bad).toEqual([]);
    expect(champs.filter((c) => c.destiny).length).toBeGreaterThan(100);
  }, 60_000);
});
