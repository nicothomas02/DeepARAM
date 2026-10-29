// Pentakill picks and Best upgrades on crafted data: a champion with no picks, a pick missing from its options,
// ties and null scores, a runner-up that isn't the start pick, unknown champions, rows in a fixed order, augment
// sets that aren't 4 real augments, a Weapon of Destiny with no options or no page, and the Simulated flag.
import { describe, expect, it } from "vitest";
import { upgradesFrom, type UpgradesChampion } from "@/lib/champion-upgrades";
import { pentakillRows, type PentakillData, type PentakillRow } from "@/lib/pentakill";

type Champ = PentakillData["champions"][string];

const pick = (score: number) => ({ score, early: score, mid: score, late: score });
const champ = (over: Partial<NonNullable<Champ["pentakill"]>> = {}): Champ => ({
  key: "Aatrox",
  pentakill: {
    start: "Q",
    level18: "R",
    start_options: { Q: pick(5), W: pick(1), E: pick(0.5) },
    level18_options: { W: 0.2, E: 0.1, R: 0.8 },
    boost: 0.4,
    ...over,
  },
});
// Aatrox is 266, Ahri 103, Akali 84 (data/champion-ids.json).
const data = (champions: Record<string, Champ>, patch = "16.21"): PentakillData => ({ patch, champions });
const client = {
  champions: [
    { alias: "Aatrox", abilities: [{ slot: "Q", name: "The Darkin Blade", icon: "/assets/aatrox-q.png" }, { slot: "W", name: "Infernal Chains" }, { slot: "R", name: "World Ender", icon: "/assets/aatrox-r.png" }] },
    { alias: "Ahri" },
  ],
};
const rows = (champions: Record<string, Champ>) => pentakillRows(data(champions), client);
const one = (over?: Partial<NonNullable<Champ["pentakill"]>>): PentakillRow => rows({ "266": champ(over) })[0];

describe("Pentakill rows on crafted data", () => {
  it("gives nothing without data, a champion list or picks", () => {
    expect(pentakillRows(null, client)).toEqual([]);
    expect(pentakillRows(data({}), client)).toEqual([]);
    expect(rows({ "266": { key: "Aatrox", pentakill: null } })).toEqual([]);
  });

  it("names the picks with the champion's own abilities and leaves missing names and icons empty", () => {
    const r = one();
    expect(r).toMatchObject({ champion: "Aatrox", start: "Q", level18: "R", startName: "The Darkin Blade", level18Name: "World Ender" });
    expect(r.startIcon).toBe("/assets/aatrox-q.png");
    expect(r.boost).toBeCloseTo(0.004);
    expect(r.startGain).toBeCloseTo(0.05);
    expect(r.level18Gain).toBeCloseTo(0.008);
    // No icon on W, no abilities at all on Ahri: empty strings, never undefined.
    expect(one({ start: "W" })).toMatchObject({ startName: "Infernal Chains", startIcon: "" });
    expect(pentakillRows(data({ "103": champ() }), client)[0]).toMatchObject({ champion: "Ahri", startName: "", startIcon: "", level18Name: "", level18Icon: "" });
    expect(pentakillRows(data({ "103": champ() }), null)[0]).toMatchObject({ champion: "Ahri", startName: "" });
  });

  it("skips champions the site doesn't know, and picks without a boost or an ability", () => {
    expect(rows({ "999999": champ() })).toEqual([]);
    expect(one({ boost: undefined })).toBeUndefined();
    expect(one({ boost: NaN })).toBeUndefined();
    expect(one({ boost: null as unknown as number })).toBeUndefined();
    expect(one({ start: "" })).toBeUndefined();
    expect(one({ level18: "" })).toBeUndefined();
    // The level 18 pick must be another ability.
    expect(one({ level18: "Q" })).toBeUndefined();
  });

  it("survives a pick missing from its options and null or NaN scores", () => {
    // The start pick isn't among the options: no gain rather than a crash.
    const r = one({ start_options: { W: pick(1), E: pick(0.5) } });
    expect(r.startGain).toBe(0);
    expect(r.runnerUp).toBe("W");
    expect(r.margin).toBeCloseTo(-0.01);
    expect(one({ start_options: {} })).toMatchObject({ startGain: 0, runnerUp: "", margin: 0 });
    expect(one({ level18_options: {} }).level18Gain).toBe(0);
    expect(one({ level18_options: { R: NaN } }).level18Gain).toBe(0);
    const nulled = one({ start_options: { Q: pick(null as unknown as number), W: pick(NaN), E: pick(0.5) } });
    expect(nulled.startGain).toBe(0);
    expect(nulled.runnerUp).toBe("E");
    expect(nulled.margin).toBeCloseTo(-0.005);
    for (const v of Object.values(nulled)) if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
  });

  it("names the best other option as the runner-up, never the start pick itself", () => {
    // Q and W tie at the top; the writer chose W. The runner-up is Q, not W.
    const r = one({ start: "W", start_options: { Q: pick(2), W: pick(2), E: pick(1) } });
    expect(r.runnerUp).toBe("Q");
    expect(r.margin).toBe(0);
    // The start pick scored below another option: the runner-up is that option, with a negative margin.
    const low = one({ start: "E", start_options: { Q: pick(3), W: pick(1), E: pick(2) } });
    expect(low.runnerUp).toBe("Q");
    expect(low.margin).toBeCloseTo(-0.01);
  });

  it("breaks ties among the other options in Q, W, E order, whatever the file's order", () => {
    expect(one({ start: "Q", start_options: { E: pick(0), W: pick(0), Q: pick(3) } }).runnerUp).toBe("W");
    expect(one({ start: "W", start_options: { E: pick(0), Q: pick(0), W: pick(3) } }).runnerUp).toBe("Q");
    expect(one({ start: "Q", start_options: { E: pick(0.2), W: pick(0.1), Q: pick(3) } }).runnerUp).toBe("E");
  });

  it("sorts rows by boost, then by champion, so equal boosts keep one order", () => {
    const out = rows({ "84": champ({ boost: 0.2 }), "266": champ({ boost: 0.2 }), "103": champ({ boost: 0.9 }) });
    expect(out.map((r) => r.champion)).toEqual(["Ahri", "Aatrox", "Akali"]);
    const flipped = rows({ "266": champ({ boost: 0.2 }), "84": champ({ boost: 0.2 }), "103": champ({ boost: 0.9 }) });
    expect(flipped.map((r) => r.champion)).toEqual(["Ahri", "Aatrox", "Akali"]);
  });
});

describe("Best upgrades on crafted data", () => {
  const penta = { champion: "Aatrox" } as PentakillRow;
  const pages = new Map([
    [3031, { id: 3031, slug: "infinity-edge", name: "Infinity Edge", icon: "/assets/ie.png" }],
    [3072, { id: 3072, slug: "bloodthirster", name: "Bloodthirster" }],
  ]);
  // Real augment ids (data/augment-names.json): 1388 Infinite Recursion, 2076 Stay Resolute, 1004 Back to Basics,
  // 1195 Giant Slayer, 1333 Escape Plan.
  const set = (augments: number[], over: Partial<{ score: number; synergy: number; simulated: boolean }> = {}) => ({
    best: { augments, score: 11.3, synergy: 1.22, ...over },
  });
  const full: UpgradesChampion = {
    weapon_of_destiny: { takedowns: 17, options: [{ item: 3031, sim_gain: 40.84 }, { item: 3072, sim_gain: 15 }] },
    augments: set([1388, 2076, 1004, 1195]),
  };
  const up = (c: Partial<UpgradesChampion> | undefined, p: PentakillRow | null = penta) =>
    upgradesFrom(c === undefined ? undefined : { weapon_of_destiny: null, augments: null, ...c }, pages, p);

  it("gives nothing for a champion without data or with nothing to show", () => {
    expect(up(undefined, null)).toBeNull();
    expect(up({}, null)).toBeNull();
    // Pentakill picks alone are worth a panel.
    expect(up(undefined)).toEqual({ augments: null, destiny: null, pentakill: penta });
    expect(up({ weapon_of_destiny: { takedowns: 17, options: [] } }, null)).toBeNull();
  });

  it("turns the file's percentages into fractions and keeps the Simulated flag a boolean", () => {
    const u = up(full)!;
    expect(u.augments).toMatchObject({ ids: [1388, 2076, 1004, 1195], boost: 0.113, simulated: false });
    expect(u.augments!.synergy).toBeCloseTo(0.0122);
    expect(u.destiny).toMatchObject({ id: 3031, slug: "infinity-edge", name: "Infinity Edge", icon: "/assets/ie.png", takedowns: 17 });
    expect(u.destiny!.gain).toBeCloseTo(0.4084);
    expect(u.pentakill).toBe(penta);
    expect(up({ augments: set([1388, 2076, 1004, 1195], { simulated: true }) })!.augments!.simulated).toBe(true);
    expect(up({ augments: set([1388, 2076, 1004, 1195], { simulated: undefined }) })!.augments!.simulated).toBe(false);
  });

  it("shows only sets of 4 different augments the site knows", () => {
    const aug = (c: Partial<UpgradesChampion>) => up(c, null);
    expect(aug({ augments: set([1388, 2076, 1004]) })).toBeNull();
    expect(aug({ augments: set([1388, 2076, 1004, 1195, 1333]) })).toBeNull();
    expect(aug({ augments: set([1388, 2076, 1004, 1004]) })).toBeNull();
    // An augment missing from the pool (no name): the set can't be picked.
    expect(aug({ augments: set([1388, 2076, 1004, 9999999]) })).toBeNull();
    expect(aug({ augments: { best: { augments: undefined as unknown as number[], score: 1, synergy: 0 } } })).toBeNull();
    expect(aug({ augments: { best: undefined as unknown as { augments: number[]; score: number; synergy: number } } })).toBeNull();
    expect(aug({ augments: set([1388, 2076, 1004, 1195]) })!.augments!.ids).toEqual([1388, 2076, 1004, 1195]);
  });

  it("never shows NaN as a boost", () => {
    const u = up({ augments: set([1388, 2076, 1004, 1195], { score: NaN, synergy: null as unknown as number }) })!;
    expect(u.augments).toMatchObject({ boost: 0, synergy: 0 });
    const d = up({ weapon_of_destiny: { takedowns: NaN, options: [{ item: 3031, sim_gain: null as unknown as number }] } })!;
    expect(d.destiny).toMatchObject({ gain: 0, takedowns: 0 });
  });

  it("needs a Weapon of Destiny option with an item page, and takes the first one", () => {
    expect(up({ weapon_of_destiny: { takedowns: 17, options: [] } }, null)).toBeNull();
    expect(up({ weapon_of_destiny: { takedowns: 17, options: undefined as unknown as [] } }, null)).toBeNull();
    expect(up({ weapon_of_destiny: { takedowns: 17, options: [{ item: 1, sim_gain: 50 }] } }, null)).toBeNull();
    const d = up({ weapon_of_destiny: { takedowns: 17, options: [{ item: 3072, sim_gain: 15 }, { item: 3031, sim_gain: 40 }] } }, null)!;
    expect(d.destiny).toMatchObject({ id: 3072, slug: "bloodthirster", icon: "", gain: 0.15 });
    expect(d.augments).toBeNull();
    expect(d.pentakill).toBeNull();
  });
});
