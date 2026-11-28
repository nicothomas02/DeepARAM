import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GET as overlayGET } from "@/app/data/overlay.json/route";
import { GET as kindsGET } from "@/app/data/damage-types.json/route";
import { GET as picksGET } from "@/app/data/augment-picks.json/route";
import { GET as fitGET } from "@/app/data/team-fit.json/route";
import { plan, itemId, ownedId, BACK_TO_BASICS, type Fit, type Kinds, type OverlayChamp, type Picks, type GameState } from "@/lib/engine/build-engine";
import augmentItems from "@/data/augment-items.json";

// Sanity flags on real archived games (Nico 2026-11-28: "test all past matches to find issues"). Each check is a
// generic rule about the item, the kit and the augments, not a list of cases. ENGINE_SANITY_STEPS = the private steps file
// (tools/replay/engine_steps.py); without it the suite is skipped. ENGINE_SANITY_STRICT=1 fails on any flag.
const FILE = process.env.ENGINE_SANITY_STEPS;
type Raw = { g: number; champ: string; taken: number[]; game: GameState };
const JEWELED = new Set([1048, 48]);
/** Tear items: they stack and scale with mana spent, so a champion with no mana never fills them. */
const TEAR = new Set([3003, 3004, 3040, 3042, 3119, 3121]);

describe.skipIf(!FILE)("engine sanity on real archived games", () => {
  it("flags nonsensical recommendations", async () => {
    const champs = ((await overlayGET().json()) as { champions: OverlayChamp[] }).champions;
    const k = (await kindsGET().json()) as Kinds, picks = (await picksGET().json()) as Picks & { styles?: Record<string, string[]>; builds?: Record<string, [string, number, number[], number[], number[], number[]?][]> }, fit = (await fitGET().json()) as Fit;
    const byId = new Map(champs.map((c) => [c.id.toLowerCase(), c]));
    // each champion's resource (Data Dragon partype: Mana, Energy, Fury, None...)
    const ddDir = join(process.cwd(), "public/assets/dd");
    const ddVer = existsSync(ddDir) ? (JSON.parse(readFileSync(join(process.cwd(), "src/data/dd-version.json"), "utf8")) as { version?: string }).version : undefined;
    const ddChamps = ddVer && existsSync(join(ddDir, ddVer, "data/en_US/champion.json")) ? (JSON.parse(readFileSync(join(ddDir, ddVer, "data/en_US/champion.json"), "utf8")) as { data: Record<string, { partype: string }> }).data : {};
    const resource = new Map(Object.entries(ddChamps).map(([kk, v]) => [kk.toLowerCase(), v.partype]));
    const raw = JSON.parse(readFileSync(FILE!, "utf8")) as Raw[];
    const tags = (id: number) => new Set(k.items[String(ownedId(id))] ?? []);
    const dmg = (id: number) => { const t = tags(id); const ad = t.has("ad") || t.has("crit") || t.has("armorpen"); const ap = t.has("ap") || t.has("magicpen"); return ad && !ap ? "ad" : ap && !ad ? "ap" : ad && ap ? "hybrid" : "none"; };
    const legend = (id: number) => (k.recipes[String(ownedId(id))]?.[1] ?? 0) >= 2000 && !k.boots.includes(ownedId(id));
    // augments after which players build the other damage type (engine 1.4.20, data/augment-type-switch.json), when present
    const swFile = join(process.cwd(), "src/data/augment-type-switch.json");
    const sw = (existsSync(swFile) ? JSON.parse(readFileSync(swFile, "utf8")).augments : {}) as Record<string, { to: string; name: string }>;
    const pairs = (augmentItems as { pairs: { augment: number; item: number; rate: number; base: number; augmentName: string; itemName: string }[] }).pairs.filter((p) => p.rate >= 0.5 && p.rate - p.base >= 0.2);
    const known = new Map<string, Set<number>>();
    const knownOf = (c: OverlayChamp) => {
      let s = known.get(c.id);
      if (s) return s;
      s = new Set<number>();
      const add = (l?: { icon: string | null }[]) => (l ?? []).forEach((x) => s!.add(ownedId(itemId(x.icon))));
      add(c.items); add(c.rest); add(c.full); add(c.later); (c.laterSlots ?? []).forEach((x) => add(x.items)); add(c.situational as { icon: string | null }[]);
      const ck = Object.keys(picks.builds ?? {}).find((x) => x.toLowerCase() === c.id.toLowerCase());
      for (const b of ck ? picks.builds![ck] : []) for (const l of [b[2], b[3], b[4]]) for (const i of l ?? []) s.add(ownedId(i));
      known.set(c.id, s);
      return s;
    };
    const flags = new Map<string, { n: number; champs: Map<string, number>; ex: string[] }>();
    const flag = (kind: string, champ: string, ex: string) => {
      const f = flags.get(kind) ?? { n: 0, champs: new Map<string, number>(), ex: [] as string[] };
      f.n++; f.champs.set(champ, (f.champs.get(champ) ?? 0) + 1); if (f.ex.length < 6 && !f.ex.some((e) => e.startsWith(champ + " "))) f.ex.push(`${champ} ${ex}`);
      flags.set(kind, f);
    };
    let n = 0;
    for (const s of raw) {
      const champ = byId.get(s.champ.toLowerCase());
      if (!champ) continue;
      const out = plan({ champ, kinds: k, picks, fit, game: { ...s.game, champ: champ.id }, taken: s.taken });
      n++;
      const owned = new Set(s.game.items.map((i) => ownedId(i)));
      const ownedLeg = [...owned].filter(legend);
      const path = out.path.map((x) => ownedId(itemId(x.icon)));
      const open = path.filter((i) => !owned.has(i));
      const apShare = k.champions[Object.keys(k.champions).find((x) => x.toLowerCase() === champ.id.toLowerCase()) ?? ""] ?? 0.5;
      const kind = apShare >= 0.75 ? "ap" : apShare <= 0.25 ? "ad" : "mixed";
      const augStyles = new Set(s.taken.flatMap((a) => picks.styles?.[String(a)] ?? []));
      const switchTo = new Set(s.taken.map((a) => sw[String(a)]?.to).filter(Boolean));
      const ownedTypes = new Set(ownedLeg.map(dmg));
      const kn = knownOf(champ);
      const at = `t${s.game.t} lv${s.game.level} items ${[...owned]} taken ${s.taken} path ${path}`;
      // 1. off-kit damage: an unbought item of the other damage type, not in any of the champion's builds, with nothing
      //    (an owned item of that type, an augment pointing there, a re-plan) to explain it
      for (const i of open) {
        const d = dmg(i);
        if (!legend(i) || d === "none" || d === "hybrid" || kind === "mixed" || d === kind) continue;
        const explained = ownedTypes.has(d) || switchTo.has(d) || out.switched || (d === "ad" && [...augStyles].some((x) => ["crit", "onhit", "lethality", "fighter"].includes(String(x)))) || (d === "ap" && augStyles.has("ap"));
        if (!explained) flag(kn.has(i) ? "off-type item (in a public build)" : "off-type item (in no public build)", champ.id, `${i} ${at}`);
      }
      // 2. crit items on an ability champion with no crit source (Jeweled Gauntlet, a crit augment, owned crit)
      if (apShare >= 0.6) for (const i of open) if (tags(i).has("crit") && legend(i) && !s.taken.some((a) => JEWELED.has(a)) && !augStyles.has("crit") && !ownedLeg.some((o) => tags(o).has("crit"))) flag("crit item, no crit source", champ.id, `${i} ${at}`);
      // 3. any unbought item that no public build of the champion uses and that no rule explains (lit, swap, timing)
      const lit = new Set([...out.lit.map((l) => ownedId(itemId(l.item.icon))), ...out.swaps.map((x) => ownedId(itemId(x.item.icon)))]);
      for (const i of open) if (legend(i) && !kn.has(i) && !lit.has(i)) {
        const w = out.why[path.indexOf(i)] ?? "";
        const rule = /^Switched to/.test(w) ? `a style switch: ${w.match(/^Switched to (\w+)/)?.[1]}` : /^Earlier: /.test(w) ? `an augment rush: ${w.match(/^Earlier: ([^:]+):/)?.[1]}` : /players usually buy it|most played build/.test(w) ? "the card's own order" : /^With /.test(w) ? "an augment swap" : "other";
        flag(`item in no public build (from ${rule})`, champ.id, `${i} why "${w.slice(0, 90)}" ${at}`);
      }
      // 4. sell tips: selling your only finished legendary, or a sell tip while the plan could re-plan around it
      for (const t of out.tips) if (t.kind === "sell" && path.includes(ownedId(t.item!))) flag("sell tip for an item the path keeps", champ.id, `${t.item} ${at}`);
      for (const t of out.tips) if (t.kind === "sell") {
        if (ownedLeg.length === 1) flag("sell tip on your only legendary", champ.id, `${t.item} ${at}`);
        else flag("sell tip", champ.id, `${t.item} ${at}`);
      }
      // 5. Back To Basics: an unbought item that leans on the ultimate
      if (s.taken.some((a) => BACK_TO_BASICS.has(a))) for (const i of open) if (tags(i).has("ult")) flag("ult item with Back To Basics", champ.id, `${i} ${at}`);
      // 8. Tear items on a champion without mana
      const res = resource.get(champ.id.toLowerCase());
      if (res !== undefined && res !== "Mana") for (const i of open) if (TEAR.has(i)) flag(`mana item on a ${res || "resourceless"} champion`, champ.id, `${i} ${at}`);
      // 6. an augment whose players nearly all build one item (Steel Your Heart -> Heartsteel), item missing
      for (const p of pairs) if (s.taken.includes(p.augment) && !path.includes(p.item) && !owned.has(p.item) && open.length > 0 && kn.has(p.item)) flag(`augment item missing (${p.augmentName} -> ${p.itemName})`, champ.id, at);
      // 7. an augment after which players build the other damage type, and the path still has none of it
      for (const to of switchTo) if (kind !== "mixed" && to !== kind && open.length >= 2 && !open.some((i) => dmg(i) === to) && !ownedTypes.has(kind)) flag("type-switch augment, path didn't switch", champ.id, at);
    }
    const summary = Object.fromEntries([...flags].sort((a, b) => b[1].n - a[1].n).map(([kd, f]) => [kd, { moments: f.n, champions: f.champs.size, top: [...f.champs].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, x]) => `${c} ${x}`), examples: f.ex }]));
    console.log(JSON.stringify({ plans: n, flags: summary }, null, 1));
    if (process.env.ENGINE_SANITY_OUT) writeFileSync(process.env.ENGINE_SANITY_OUT, JSON.stringify({ plans: n, flags: Object.fromEntries([...flags].map(([kd, f]) => [kd, { moments: f.n, champions: f.champs.size }])) }));
    expect(n).toBeGreaterThan(0);
    if (process.env.ENGINE_SANITY_STRICT) expect([...flags.keys()]).toEqual([]);
  }, 1_800_000);
});
