import { describe, expect, it } from "vitest";
import { GET as overlayGET } from "@/app/data/overlay.json/route";
import { GET as kindsGET } from "@/app/data/damage-types.json/route";
import { GET as picksGET } from "@/app/data/augment-picks.json/route";
import { GET as fitGET } from "@/app/data/team-fit.json/route";
import { plan, itemId, itemRules, mustHave, RULES, type Fit, type Kinds, type OverlayChamp, type Picks, type Plan, type GameState } from "@/lib/engine/build-engine";

// Engine regression suite (2026-11-25): every champion plays a seeded game (augments from its own pool, buys from its
// own path with off-path detours, random enemies and allies), and every plan along the way must keep the engine's
// promises. These hold whatever the day's data says, so a data refresh can't break them but an engine change can.

const once = (get: () => Response) => { let p: Promise<unknown> | null = null; return () => (p ??= get().json()); };
const overlayJSON = once(overlayGET), kindsJSON = once(kindsGET), picksJSON = once(picksGET), fitJSON = once(fitGET);

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Step = { input: Parameters<typeof plan>[0]; out: Plan; champ: OverlayChamp };
let cache: Promise<{ steps: Step[]; k: Kinds }> | null = null;

/** One seeded game per champion: 7 shop visits, an augment at levels 1/7/11/15, a buy per visit. */
function games() {
  return (cache ??= (async () => {
    const champs = ((await overlayJSON()) as { champions: OverlayChamp[] }).champions;
    const k = (await kindsJSON()) as Kinds, picks = (await picksJSON()) as Picks, fit = (await fitJSON()) as Fit;
    const steps: Step[] = [];
    const limits = itemRules(k);
    champs.forEach((c, ci) => {
      const r = rng(ci + 1);
      const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
      const ck = Object.keys(picks.champions).find((x) => x.toLowerCase() === c.id.toLowerCase());
      const pool = (ck ? picks.champions[ck] : []).slice(0, 15).map((x) => x[0]);
      const others = champs.filter((x) => x !== c);
      const enemies = Array.from({ length: 5 }, () => pick(others));
      const allies = Array.from({ length: 4 }, () => pick(others)).map((a) => ({ champ: a.id, level: 10 }));
      const ids = (list?: { icon: string | null }[]) => (list ?? []).map((x) => itemId(x.icon)).filter((i) => i > 0 && k.recipes[i]);
      const route = [...ids(c.items), ...(c.laterSlots ?? []).map((s) => ids(s.items)[0]).filter(Boolean)];
      const detours = [...ids(c.situational), ...ids(c.rest)];
      const taken: number[] = [];
      const items: number[] = [];
      for (let v = 0; v < 7; v++) {
        const level = 1 + v * 2.5;
        if (pool.length && [1, 7, 11, 15].some((l) => level >= l && taken.length < [1, 7, 11, 15].indexOf(l) + 1)) {
          const a = pick(pool.filter((x) => !taken.includes(x)));
          if (a !== undefined) taken.push(a);
        }
        const game: GameState = {
          champ: c.id, items: [...items], gold: Math.floor(r() * 4000), level: Math.round(level), dead: r() < 0.5, t: 60 + v * 150,
          enemies: enemies.map((e, i) => ({ champ: e.id, items: ids(e.items).slice(0, Math.min(v, 3)), level: Math.round(level) + (i % 2) })),
          allies,
        };
        const input = { champ: c, kinds: k, picks, fit, game, taken: [...taken] };
        steps.push({ input, out: plan(input), champ: c });
        // buy: the route's next item, or (1 in 4) a detour
        const nextBuy = r() < 0.25 && detours.length ? pick(detours) : route.find((i) => !items.includes(i));
        // the shop won't sell an item that shares a unique group with one you hold (LDR / Terminus / Mortal Reminder):
        // a detour like that is a game that can't happen (2026-11-27: Ashe's situational list gained Terminus)
        if (nextBuy !== undefined && items.length < 6 && !items.includes(nextBuy) && !items.some((i) => limits.clash(i, nextBuy))) items.push(nextBuy);
      }
    });
    return { steps, k };
  })());
}

describe("engine regression suite (every champion, seeded games)", () => {
  it("plays enough games to mean something", async () => {
    const { steps } = await games();
    expect(steps.length).toBeGreaterThan(1000);
  }, 120_000);

  it("is deterministic: the same game gives the same plan", async () => {
    const { steps } = await games();
    for (const s of steps.filter((_, i) => i % 7 === 3)) expect(JSON.stringify(plan(s.input))).toBe(JSON.stringify(s.out));
  }, 120_000);

  it("keeps the path whole: at most six items, none twice, no two of one limit group, owned items never dropped for nothing", async () => {
    const { steps, k } = await games();
    const rules = itemRules(k);
    for (const { input, out } of steps) {
      const p = out.path.map((x) => itemId(x.icon));
      const at = `${input.game.champ} items ${input.game.items} taken ${input.taken}`;
      expect(p.length, at).toBeLessThanOrEqual(6);
      expect(new Set(p).size, at).toBe(p.length);
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) expect(rules.clash(p[i], p[j]), `${at}: ${p[i]} + ${p[j]}`).toBe(false);
      expect(out.coreLen, at).toBeLessThanOrEqual(p.length);
    }
  }, 120_000);

  it("Next only names items the path shows and you don't own", async () => {
    const { steps } = await games();
    for (const { input, out } of steps) {
      const p = new Set(out.path.map((x) => itemId(x.icon)));
      const owned = new Set(input.game.items.map((i) => i % 10000));
      for (const n of out.next) {
        const id = itemId(n.icon);
        expect(owned.has(id), `${input.game.champ} owns Next ${id}`).toBe(false);
        if (RULES.pathOrder.on) expect(p.has(id), `${input.game.champ} items ${input.game.items} taken ${input.taken} enemies ${input.game.enemies?.map((e) => e.champ)} Next ${id} not in path ${[...p]} rules ${out.rules}`).toBe(true);
      }
    }
  }, 120_000);

  it("only reports rules that exist and are on", async () => {
    const { steps } = await games();
    for (const { out } of steps) for (const r of out.rules) expect(RULES[r]?.on, r).toBe(true);
  }, 120_000);

  it("every hover reason matches the rule that made it", async () => {
    const { steps } = await games();
    const kinds = new Set<string>();
    for (const { input, out } of steps) {
      const at = `${input.game.champ} taken ${input.taken}`;
      for (const s of out.swaps) {
        kinds.add(s.kind);
        expect(s.why.length, at).toBeGreaterThan(0);
        if (s.kind === "kit") expect(out.rules.some((r) => r === "ccCounters" || r === "vowPartner"), at).toBe(true);
        if (s.kind === "proven") expect(out.rules, at).toContain("provenCounters");
        if (s.kind === "kit" && itemId(s.item.icon) === 3109) expect(s.why, at).toMatch(/^Pledge to /);
      }
      for (const l of out.lit) expect(l.why.length, at).toBeGreaterThan(0);
      for (const p of out.pointers) expect(p.why.length, at).toBeGreaterThan(0);
      for (const b of out.breakpoints) {
        expect(b.why, at).toMatch(/^Enemy (armor|magic resist|health) about \d+/);
        expect(b.passed, at).toBe(b.value >= b.threshold);
      }
      if (out.breakpoints.some((b) => b.passed)) expect(out.rules, at).toContain("breakpoints");
      for (const t of out.timing) expect(t.because.length, at).toBeGreaterThan(0);
      const owned = new Set(input.game.items.map((i) => i % 10000));
      for (const t of out.tips) {
        if (t.kind === "sell") expect(owned.has(t.item!), `${at}: sells ${t.item} it doesn't own`).toBe(true);
        if (t.kind === "anvil" || t.kind === "elixir") expect(out.next.length, at).toBe(0);
      }
      if (out.rules.includes("converterItems") || out.rules.includes("leanIn") || out.rules.includes("augmentRush")) expect(input.taken.length, at).toBeGreaterThan(0);
    }
    expect(kinds.size).toBeGreaterThan(0);
  }, 120_000);

  it("an augment never pushes a must-have item out of the core", async () => {
    const { steps } = await games();
    for (const { input, out } of steps) {
      if (!input.taken.length || out.switched) continue;
      const must = mustHave(input.game.champ);
      const before = plan({ ...input, taken: [] });
      const coreBefore = before.path.slice(0, before.coreLen).map((x) => itemId(x.icon)).filter((i) => must.has(i));
      const coreNow = new Set(out.path.slice(0, out.coreLen).map((x) => itemId(x.icon)));
      // a must-have still in the path and not yet bought stays in the core (pathOrder may reorder inside it; owned items keep their slot)
      const pathNow = new Set(out.path.map((x) => itemId(x.icon)));
      const owned = new Set(input.game.items.map((x) => x % 10000));
      for (const i of coreBefore) if (pathNow.has(i) && !owned.has(i)) expect(coreNow.has(i), `${input.game.champ} items ${input.game.items} taken ${input.taken}: must-have ${i} left the core; before ${before.path.map((x) => itemId(x.icon))}/${before.coreLen} now ${[...pathNow]}/${out.coreLen} rules ${out.rules}`).toBe(true);
    }
  }, 120_000);

  it("gold alone never changes the path (only tips)", async () => {
    const { steps } = await games();
    for (const s of steps.filter((_, i) => i % 5 === 2)) {
      const rich = plan({ ...s.input, game: { ...s.input.game, gold: (s.input.game.gold ?? 0) + 2000 } });
      expect(rich.path.map((x) => itemId(x.icon)), s.input.game.champ).toEqual(s.out.path.map((x) => itemId(x.icon)));
    }
  }, 120_000);
});
