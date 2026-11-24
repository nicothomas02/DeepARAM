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
  startFor,
  fillStart,
  picksLeft,
  partnerPicks,
  partnerOdds,
  nearTies,
  augmentConflict,
  tieBreak,
  TIER_ODDS,
  triggers,
  type Fit,
  type Kinds,
  type OverlayChamp,
  type Picks,
  shiftOf,
  stickerValue,
  STICKERS,
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

  it("follows a split: Katarina Q to 3, then max E", () => {
    const split = { first: "Q", points: 3 };
    const seq: string[] = [];
    const pts = [0, 0, 0, 0];
    for (let lv = 1; lv <= 13; lv++) {
      const k = skillUp(["E", "Q", "W"], pts, lv, [], "Katarina", 5, split);
      seq.push(k);
      pts["QWER".indexOf(k)]++;
    }
    expect(seq.join("")).toBe("QEWQQREEEERQQ");
  });

  it("follows a W split: Ashe W to 3, then max Q", () => {
    const split = { first: "W", points: 3, weak: true };
    const seq: string[] = [];
    const pts = [0, 0, 0, 0];
    for (let lv = 1; lv <= 13; lv++) {
      const k = skillUp(["Q", "W", "E"], pts, lv, [], "Ashe", 5, split);
      seq.push(k);
      pts["QWER".indexOf(k)]++;
    }
    expect(seq.join("")).toBe("WQEWWRQQQQRWW");
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

  it("switches the start to the first augment's own (Upgrade Stormsurge: Hextech Alternator on Ahri)", async () => {
    const ahri = ((await overlayGET().json()) as { champions: OverlayChamp[] }).champions.find((x) => x.id === "Ahri");
    const storm = ahri?.augmentStarts?.find((a) => a.augment === 3150);
    expect(storm?.start.map((s) => s.name)).toContain("Hextech Alternator");
    expect(startFor(ahri, [3150]).start.map((s) => s.name)).toContain("Hextech Alternator");
    expect(startFor(ahri, [3150]).augment).toBe(3150);
    // Only the first augment: taken later, the start is already bought.
    expect(startFor(ahri, [1030, 3150]).augment).toBeNull();
    expect(startFor(ahri, []).start).toEqual(ahri?.start);
    // Eureka: Ahri's players start Lost Chapter anyway, so it doesn't change her start.
    expect(ahri?.augmentStarts?.some((a) => a.augment === 1030)).toBe(false);
  });

  it("starts with the best start you can afford when you have extra gold (Debonair headliner)", () => {
    const n = (name: string) => ({ name, icon: null });
    const c = { start: [n("Long Sword"), n("Guardian's Blade")], richStarts: [{ start: [n("B. F. Sword"), n("Long Sword")], cost: 1650 }, { start: [n("Serrated Dirk"), n("Pickaxe")], cost: 1875 }] } as unknown as OverlayChamp;
    expect(startFor(c, [], 1400).start).toEqual(c.start);
    expect(startFor(c, [], 1700)).toMatchObject({ rich: true, start: c.richStarts![0].start });
    expect(startFor(c, [], 1600).rich).toBe(false);
    expect(startFor(c, []).rich).toBe(false);
  });

  it("spends extra gold on the first item's parts, or on the item the first augment leads to", async () => {
    const champs = ((await overlayGET().json()) as { champions: OverlayChamp[] }).champions;
    const k = (await kindsGET().json()) as Kinds;
    const names = (c: OverlayChamp | undefined, taken: number[], gold?: number) => startFor(c, taken, gold, k).start.map((s) => s.name);
    const ahri = champs.find((x) => x.id === "Ahri");
    // Normal gold: nothing changes.
    expect(startFor(ahri, [], 1400, k)).toMatchObject({ filled: false, start: ahri?.start });
    // Debonair +1,000: Lost Chapter for Luden's Echo, Guardian's Orb kept.
    expect(names(ahri, [], 2400)).toEqual(expect.arrayContaining(["Guardian's Orb", "Lost Chapter"]));
    // Upgrade Stormsurge (+500) and Debonair (+1,000): the whole Stormsurge.
    expect(ahri?.augmentStarts?.find((a) => a.augment === 3150)?.toward).toBe(4646);
    expect(names(ahri, [3150], 2900)).toEqual(["Stormsurge"]);
    // Every champion, every gold step: never spends more than it has, never leaves the start behind unless it built into it.
    const cost = (ids: number[]) => ids.reduce((sum, i) => sum + k.recipes[i][1], 0);
    for (const c of champs)
      for (const gold of [1554, 1900, 2400, 2900]) {
        const st = startFor(c, [], gold, k);
        if (!st.filled) continue;
        const ids = st.start.map((s) => itemId(s.icon));
        expect(cost(ids), `${c.id} at ${gold}`).toBeLessThanOrEqual(gold);
        expect(cost(ids), `${c.id} at ${gold}`).toBeGreaterThan(cost((c.start ?? []).map((s) => itemId(s.icon))));
      }
  });

  it("counts a headliner's extra augments as picks left (K/DA, Superfans)", () => {
    expect(picksLeft(0)).toBe(3);
    expect(picksLeft(3)).toBe(0);
    expect(picksLeft(0, "K/DA")).toBeCloseTo(3.93);
    expect(picksLeft(3, "kda")).toBeCloseTo(0.93);
    expect(picksLeft(3, "Superfans")).toBeCloseTo(0.29);
    expect(picksLeft(3, "Pentakill")).toBe(0);
  });

  it("counts the screens left that can show a partner's tier (wiki: shared tier, first two never both Silver)", () => {
    expect(partnerPicks(0, "silver", { tier: "silver" })).toBe(2);
    expect(partnerPicks(0, "gold", { tier: "silver" })).toBe(3);
    expect(partnerPicks(1, "silver", { tier: "silver" })).toBe(2);
    expect(partnerPicks(0, "silver", { tier: "gold" })).toBe(3);
    // Headliners only once the app knows them.
    expect(partnerPicks(0, "prismatic", { headliner: "Command Line" })).toBe(0);
    expect(partnerPicks(0, "gold", { headliner: "Command Line" })).toBe(3);
    expect(partnerPicks(0, "gold", { headliner: "Maestro" })).toBe(4);
    // Combo potential: the chance the partner is offered again (tierOdds), from tier odds and the pool left.
    const silver = Object.fromEntries(Array.from({ length: 60 }, (_, n) => [String(100 + n), [`Aug ${n}`, "silver"]])) as Picks["augments"];
    const big: Picks = { ...picks, augments: silver, champions: { Ashe: Array.from({ length: 60 }, (_, n) => [100 + n, 1 - n * 0.005] as [number, number]) } };
    const at = (tier?: string) => rankAugments(big, "Ashe", [], { tier }).find((a) => a.id === 100)!.potential;
    expect(at("gold")).toBeCloseTo(20 * partnerOdds(0, "silver", 60, { tier: "gold" }));
    expect(at("silver")).toBeLessThan(at("gold"));
  });

  it("gives combo partners the chance they're offered again, by tier (archive tier odds, Nico 2026-11-24)", () => {
    for (const t of [...Object.values(TIER_ODDS.second), ...Object.values(TIER_ODDS.next), TIER_ODDS.later])
      expect(Object.values(t).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    // A Silver first screen: the second can't be Silver.
    expect(partnerOdds(0, "silver", 60, { tier: "silver" })).toBeCloseTo(1 - (1 - 0.296 * 0.1) ** 2);
    expect(partnerOdds(0, "silver", 60, { tier: "gold" })).toBeCloseTo(1 - (1 - 0.336 * 0.1) * (1 - 0.296 * 0.1) ** 2);
    // Prismatic rarely follows Prismatic.
    expect(partnerOdds(1, "prismatic", 60, { tier: "prismatic" })).toBeLessThan(partnerOdds(1, "prismatic", 60, { tier: "gold" }));
    // A smaller pool left at that tier: likelier to be shown.
    expect(partnerOdds(1, "gold", 20, {})).toBeGreaterThan(partnerOdds(1, "gold", 60, {}));
    expect(partnerOdds(3, "gold", 60)).toBe(0);
    expect(partnerOdds(3, "gold", 60, { headliner: "K/DA" })).toBeCloseTo(0.93 * 0.453 * 0.1);
    expect(partnerOdds(0, "prismatic", 60, { headliner: "Command Line" })).toBe(0);
    expect(partnerOdds(0, "gold", 60, { headliner: "Command Line" })).toBeGreaterThan(partnerOdds(0, "gold", 60));
    expect(partnerOdds(0, "gold", 60, { headliner: "Maestro" })).toBeGreaterThan(partnerOdds(0, "gold", 60));
  });

  it("puts augments that can't work with what you took last, with the reason (wiki)", () => {
    const aug = { ...picks.augments, "1004": ["Back To Basics", "prismatic"], "1349": ["Ultimate Awakening", "prismatic"], "1205": ["ADAPt", "silver"], "1206": ["EscAPADe", "silver"],
      "2088": ["Snowday", "silver"], "1006": ["Blade Waltz", "prismatic"], "3004": ["Get Jinxed", "gold"], "1401": ["Growth Spurt", "gold"] } as Picks["augments"];
    const p: Picks = { ...picks, augments: aug, champions: { Ashe: [[1349, 0.2], [1206, 0.1], [1401, 0.05], [100, 0.01]] }, pairs: {} };
    expect(augmentConflict(p, [1004], 1349)).toMatch(/Back to Basics/);
    expect(augmentConflict(p, [1349], 1004)).toMatch(/Ultimate Awakening/);
    expect(augmentConflict(p, [1205], 1206)).toMatch(/ADAPt/);
    expect(augmentConflict(p, [2088, 1006], 1401)).toMatch(/summoner spell/);
    expect(augmentConflict(p, [1006], 1401)).toBeNull();
    const r = rankAugments(p, "Ashe", [1004, 1205]);
    expect(r.map((a) => a.id).slice(-2)).toEqual([1349, 1206]);
    expect(r[r.length - 1].conflict).toBeTruthy();
  });

  it("breaks a near-tie by combo potential, else the less common pick", () => {
    const ranked = [{ id: 1, score: 5, boost: 5, potential: 0, combo: null, mate: null, deep: 50 }, { id: 2, score: 4.8, boost: 4.7, potential: 0.1, combo: 9, mate: null, deep: 50 }];
    const p: Picks = { ...picks, champions: { Ashe: [[1, 0.05, 50, 1, 0.5, 0.2], [2, 0.047, 50, 1, 0.5, 0.05]] } };
    expect(tieBreak(p, "Ashe", [1, 2], ranked)).toEqual({ id: 2, why: "more combo potential" });
    expect(tieBreak(p, "Ashe", [1, 2], ranked.map((a) => ({ ...a, potential: 0 })))).toEqual({ id: 2, why: "fewer players take it" });
  });

  it("calls cards within noise of the best a near-tie (engine scorecard)", () => {
    const p: Picks = { ...picks, champions: { Ashe: [[1, 0.05, 50, 1, 0.5], [2, 0.045, 50, 1, 0.5], [3, 0.03, 50, 1, 0.5], [4, 0.049, 50, 0, -1]] } };
    // 5.0 vs 4.5 points, standard error 0.5 each: band 1.39, a tie; 3.0 is not; an estimate is never a tie.
    expect(nearTies(p, "Ashe", [{ id: 1, score: 5 }, { id: 2, score: 4.5 }, { id: 3, score: 3 }])).toEqual([2]);
    expect(nearTies(p, "Ashe", [{ id: 1, score: 5 }, { id: 4, score: 4.9 }])).toEqual([]);
  });

  it("Command Line's first reroll draws a tier higher; Debonair's gold breaks a tie", () => {
    const aug = Object.fromEntries([
      ...Array.from({ length: 8 }, (_, n) => [String(200 + n), [`S${n}`, "silver"]]),
      ...Array.from({ length: 8 }, (_, n) => [String(300 + n), [`G${n}`, "gold"]]),
    ]) as Picks["augments"];
    const own = [...Array.from({ length: 8 }, (_, n) => [200 + n, 0.5 - n * 0.01]), ...Array.from({ length: 8 }, (_, n) => [300 + n, 0.6 - n * 0.01])] as [number, number][];
    const p: Picks = { ...picks, augments: aug, champions: { Ashe: own }, pairs: {} };
    const ranked = rankAugments(p, "Ashe", []);
    const offered = [{ id: 200 }, { id: 205 }, { id: 207 }];
    const plain = rerollAdvice(p, ranked, offered, []);
    const cl = rerollAdvice(p, ranked, offered, [], { headliner: "Command Line" });
    expect(plain?.hacked).toBeUndefined();
    expect(cl?.hacked).toBe(true);
    expect(cl?.action).toBe("reroll");
    expect(cl!.gain).toBeGreaterThan(plain!.gain);
    // One reroll used on this screen: the rest are normal again.
    expect(rerollAdvice(p, ranked, offered, [], { headliner: "Command Line", rerolled: [999, 207] })?.hacked).toBeUndefined();
    const tie = [{ id: 200, score: 50, gold: 200 }, { id: 201, score: 50, gold: 700 }, { id: 202, score: 40, gold: 500 }];
    expect(rerollAdvice(p, ranked, tie, [])?.best).toBe(200);
    expect(rerollAdvice(p, ranked, tie, [], { headliner: "Debonair" })?.best).toBe(201);
  });

  it("fills a start from the recipes: owned parts count, the biggest part that fits goes first", () => {
    const recipes = { 1: ["Part", 400, []], 2: ["Other", 300, []], 3: ["Mid", 900, [1, 1]], 4: ["Big", 2000, [3, 2]] } as unknown as Kinds["recipes"];
    expect(fillStart([1], [4], 1000, recipes)).toEqual([3]);
    expect(fillStart([1], [4], 700, recipes)).toEqual([1, 2]);
    expect(fillStart([], [4], 2000, recipes)).toEqual([4]);
    expect(fillStart([1], [4], 400, recipes)).toBeNull();
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

describe("HEARTSTEEL stickers (estimated)", () => {
  const icon = (id: number) => ({ name: String(id), icon: `/x/${id}.png` });
  const kinds = { champions: { Mage: 1, Marksman: 0 }, items: { "1": ["ap", "haste"], "2": ["ad", "as"] }, boots: [], recipes: {} } as unknown as Kinds;
  const mage = { id: "Mage", items: [icon(1)] } as OverlayChamp;
  const adc = { id: "Marksman", items: [icon(2)] } as OverlayChamp;
  const picks = { augments: {}, champions: { Mage: [[1404, -0.005, 50, 1]] }, pairs: {}, styles: {} } as unknown as Picks;

  it("values only stats the champion uses", () => {
    const yMage = stickerValue("Yone", mage, kinds, picks)!;
    const yAdc = stickerValue("Yone", adc, kinds, picks)!;
    expect(yMage.parts.find((p) => p.stat === "attack speed")!.used).toBe(0);
    expect(yAdc.parts.find((p) => p.stat === "attack speed")!.used).toBe(1);
    expect(yMage.gold).toBe(1000); // 20 haste only
    expect(stickerValue("Ezreal", mage, kinds, picks)!.parts.find((p) => p.stat === "attack damage")!.used).toBe(0);
    expect(yAdc.why).toMatch(/estimated/);
  });

  it("per-level bonuses use the average level from the pick to 18; Aphelios follows Stats!", () => {
    expect(stickerValue("Sett", adc, kinds, picks, 1)!.gold).toBe(Math.round(30 * 9.5 * 400 / 150 * 0.5));
    expect(stickerValue("Aphelios", mage, kinds, picks)!.points).toBeCloseTo(0.5, 5);
    expect(stickerValue("Nobody", mage, kinds, picks)).toBeNull();
    expect(Object.keys(STICKERS)).toHaveLength(6);
  });

  it("adds the sticker's points to that augment's ranking", () => {
    const p = { augments: {}, champions: { Mage: [[10, 0.01, 50, 1], [11, 0.005, 50, 1]] }, pairs: {}, styles: {} } as unknown as Picks;
    expect(rankAugments(p, "Mage", [])[0].id).toBe(10);
    expect(rankAugments(p, "Mage", [], { stickers: { 11: 1 } })[0].id).toBe(11);
  });
});

describe("split skill orders", () => {
  it("never split into the ability the champion maxes first", async () => {
    const { CHAMPION_SPLITS, CHAMPION_SKILLS } = await import("@/lib/augment-skills");
    for (const [champ, split] of Object.entries(CHAMPION_SPLITS)) {
      const order = CHAMPION_SKILLS[champ];
      if (order) expect(order[0], champ).not.toBe(split.first);
    }
  });
});

describe("crit cap (critCap)", () => {
  it("swaps a near-tied crit pick for a non-crit one at 100% crit, never for Yasuo", async () => {
    const { plan, CRIT_CONVERTERS } = await import("@/lib/engine/build-engine");
    const icon = (id: number) => `/assets/dd/16.23.1/img/item/${220000 + id}.png`;
    const champ0 = {
      id: "Tristana",
      skills: ["Q", "E", "W"],
      items: [{ name: "Berserker's Greaves", icon: icon(3006) }, { name: "Yun Tal Wildarrows", icon: icon(3032) }],
      laterSlots: [{ slot: 2, items: [{ name: "Infinity Edge", icon: icon(3031), deepScore: 70, tie: true }, { name: "Lord Dominik's Regards", icon: icon(3036), deepScore: 68, tie: true }] }],
    };
    const kinds = {
      champions: { Tristana: 0.1, Yasuo: 0.1 },
      items: { "3031": ["ad", "crit"], "3036": ["ad"], "3032": ["ad", "crit", "as"], "3006": ["as"] },
      boots: [3006],
      recipes: { "3031": ["Infinity Edge", 3500, []], "3036": ["Lord Dominik's Regards", 3100, []], "3032": ["Yun Tal Wildarrows", 3000, []], "3006": ["Berserker's Greaves", 1100, []] },
    } as never;
    const g = (champ: string, crit: number) => ({ champ, items: [3006, 3032], stats: [crit, 1.5, 0], level: 11 });
    const at = (champ: string, crit: number) => plan({ champ: { ...champ0, id: champ }, kinds, picks: null, fit: null, game: g(champ, crit), taken: [] } as never);
    expect(at("Tristana", 0.6).path.map((x) => x.name)).toContain("Infinity Edge");
    const capped = at("Tristana", 1);
    expect(capped.path.map((x) => x.name)).toContain("Lord Dominik's Regards");
    expect(capped.rules).toContain("critCap");
    expect(CRIT_CONVERTERS.has("yasuo")).toBe(true);
    expect(at("Yasuo", 1).path.map((x) => x.name)).toContain("Infinity Edge");
  });
});

describe("augments tip a weaker split (splitAugments)", () => {
  it("maxes the favored ability and keeps the split otherwise", async () => {
    const { splitFor } = await import("@/lib/engine/build-engine");
    const weak = { first: "Q", points: 3, weak: true };
    expect(splitFor(["W", "Q", "E"], weak, []).split).toEqual(weak);
    expect(splitFor(["W", "Q", "E"], weak, [1103])).toMatchObject({ order: ["Q", "W", "E"], split: undefined, tipped: true });
    expect(splitFor(["W", "Q", "E"], weak, [3171])).toMatchObject({ order: ["W", "Q", "E"], split: undefined, tipped: true });
    expect(splitFor(["W", "Q", "E"], weak, [1103, 1150]).split).toEqual(weak);
    expect(splitFor(["W", "Q", "E"], weak, [1151]).split).toEqual(weak);
    // Katarina and Kayn's splits aren't weak: augments don't move them.
    expect(splitFor(["E", "Q", "W"], { first: "Q", points: 3 }, [1103]).tipped).toBe(false);
  });
});
