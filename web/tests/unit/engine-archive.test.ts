import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { GET as overlayGET } from "@/app/data/overlay.json/route";
import { GET as kindsGET } from "@/app/data/damage-types.json/route";
import { GET as picksGET } from "@/app/data/augment-picks.json/route";
import { GET as fitGET } from "@/app/data/team-fit.json/route";
import { plan, itemId, itemRules, ownedId, RULES, type Fit, type Kinds, type OverlayChamp, type Picks, type GameState } from "@/lib/engine/build-engine";

// Real-game replay (2026-11-28): ENGINE_ARCHIVE_STEPS points at a JSON list of game states rebuilt from archived games
// (the private archive's tools/replay/engine_steps.py: every player's items, level, allies and enemies each few minutes, augments
// by level). Those games are private, so the file never enters this repo; without it this suite is skipped. It checks the
// same promises as engine-invariants.test.ts on real inventories (half-built items, sold items, odd orders).
const FILE = process.env.ENGINE_ARCHIVE_STEPS;
const EVERY = Number(process.env.ENGINE_ARCHIVE_EVERY ?? 1);
type Raw = { g: number; champ: string; taken: number[]; game: GameState };

describe.skipIf(!FILE)("engine on real archived games", () => {
  it("keeps every promise on real inventories", async () => {
    const champs = ((await overlayGET().json()) as { champions: OverlayChamp[] }).champions;
    const k = (await kindsGET().json()) as Kinds, picks = (await picksGET().json()) as Picks, fit = (await fitGET().json()) as Fit;
    const byId = new Map(champs.map((c) => [c.id.toLowerCase(), c]));
    const raw = (JSON.parse(readFileSync(FILE!, "utf8")) as Raw[]).filter((_, i) => i % EVERY === 0);
    const r0 = itemRules(k), tears = new Set([3003, 3004, 3119, 2526]);
    const clash = (a: number, b: number) => !(tears.has(ownedId(a)) && tears.has(ownedId(b)) && ownedId(a) !== ownedId(b)) && r0.clash(a, b);
    const fails = new Map<string, string[]>();
    const fail = (kind: string, at: string) => { const l = fails.get(kind) ?? []; if (l.length < 5) l.push(at); fails.set(kind, l); };
    const count = new Map<string, number>();
    const bump = (kind: string) => count.set(kind, (count.get(kind) ?? 0) + 1);
    let n = 0, skipped = 0;
    const penOn = (RULES as Record<string, { on: boolean }>).penSecond?.on;
    for (const s of raw) {
      const champ = byId.get(s.champ.toLowerCase());
      if (!champ) { skipped++; continue; }
      const input = { champ, kinds: k, picks, fit, game: { ...s.game, champ: champ.id }, taken: s.taken };
      let out;
      try { out = plan(input); } catch (e) { bump("throws"); fail("throws", `${s.g} ${s.champ}: ${(e as Error).message}`); continue; }
      n++;
      const at = `${s.g} ${s.champ} t${s.game.t} items ${s.game.items} taken ${s.taken}`;
      const p = out.path.map((x) => itemId(x.icon));
      const owned = new Set(s.game.items.map((i) => i % 10000));
      const pathSet = new Set(p);
      const bad = (kind: string, ok: boolean, extra = "") => { if (!ok) { bump(kind); fail(kind, `${at} ${extra}`); } };
      bad("path over six", p.length <= 6, `${p}`);
      bad("item twice", new Set(p).size === p.length, `${p}`);
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) bad("limit-group clash", !clash(p[i], p[j]), `${p[i]}+${p[j]}`);
      bad("coreLen over path", out.coreLen <= p.length);
      for (const x of out.next) { const id = itemId(x.icon); bad("Next owned", !owned.has(id), `${id}`); if (RULES.pathOrder.on) bad("Next not in path", pathSet.has(id), `${id} path ${p}`); }
      for (const r of out.rules) bad("unknown rule", !!RULES[r]?.on, r);
      for (const sw of out.swaps) {
        bad("swap without reason", sw.why.length > 0);
        if ("label" in sw) bad("swap without label", (sw as { label: string }).label.length > 0, `${itemId(sw.item.icon)} ${sw.kind}`);
        if (sw.replaces) bad("swap replaces an owned item", !owned.has(itemId(sw.replaces.icon)), `${itemId(sw.replaces.icon)}`);
        bad("swap names an owned item", !owned.has(itemId(sw.item.icon)), `${itemId(sw.item.icon)}`);
      }
      for (const b of out.breakpoints) bad("breakpoint passed flag", b.passed === (b.value >= b.threshold));
      for (const t of out.tips) if (t.kind === "sell") bad("sells an item not owned", owned.has(t.item!), `${t.item}`);
      // what you bought stays on the path: every finished legendary you hold (the engine's boughtFirst promise)
      const legend = [...owned].filter((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !k.boots.includes(i));
      if (legend.length <= 6) for (const i of legend) bad("owned legendary dropped", pathSet.has(i), `${i} path ${p}`);
      if (penOn && out.rules.includes("penSecond")) {
        bump("_penSecond");
        bad("penSecond without a lit reason", out.lit.some((l) => /^Enemy [a-z ]+ about \d+/.test(l.why)));
      }
      if (n % 9 === 0) {
        const rich = plan({ ...input, game: { ...input.game, gold: (input.game.gold ?? 0) + 2000 } });
        bad("gold changed the path", JSON.stringify(rich.path.map((x) => itemId(x.icon))) === JSON.stringify(p));
        bad("not deterministic", JSON.stringify(plan(input)) === JSON.stringify(out));
      }
    }
    const summary = { plans: n, skipped, counts: Object.fromEntries(count), examples: Object.fromEntries(fails) };
    console.log(JSON.stringify(summary, null, 1));
    // ENGINE_ARCHIVE_OUT: the private replay workflow keeps this for its history (no game ids leave that repo)
    if (process.env.ENGINE_ARCHIVE_OUT) writeFileSync(process.env.ENGINE_ARCHIVE_OUT, JSON.stringify(summary));
    expect(n).toBeGreaterThan(0);
    expect([...count.keys()].filter((x) => !x.startsWith("_"))).toEqual([]);
  }, 1_800_000);
});
