import "server-only";
import championIds from "@/data/champion-ids.json";
import { windowJson } from "./champion-page";
import { aramhexLatest, shrunkLifts } from "./aramhex-real";
import { grade } from "./deepscore";

// Pentakill tab (/tier-list?tab=pentakill): which ability each champion should Empower in a Pentakill game, one
// basic ability at the start and a second one (the ultimate allowed) at level 18. Since AramHex (2026-11-23) the picks
// come from real games: each Empower's games and wins on the champion (augments HEAVY Q, POWER W, THRASH E, DOOM R,
// data/aramhex/patches/<patch>/augments.json). A pick's score is its win rate above the champion's average in
// Pentakill games, shrunk by sample size (lib/aramhex-real.ts). AramHex counts Empowers held at game end, so a basic
// ability's games hold both start and level 18 picks; DOOM is only ever a level 18 pick, and games that reach level
// 18 run long, so DOOM is judged against how DOOM does on every champion. Correlated, not causal.

const SLOTS = { Q: "3170", W: "3171", E: "3172", R: "3173" } as const;
type Slot = keyof typeof SLOTS;
/** An Empower counts as a real start pick with at least this share of the champion's most picked one (as builds). */
const MIN_SHARE = 0.25;

export type PentakillRow = {
  /** Champion id, as the tables and pages use it ("MonkeyKing"). */
  champion: string;
  start: string;
  level18: string;
  startName: string;
  level18Name: string;
  startIcon: string;
  level18Icon: string;
  /** DeepScore of the start pick, 0-100 against every champion's start pick. */
  startScore: number;
  /** DeepScore of the level 18 pick, against every champion's level 18 pick. */
  level18Score: number;
  /** Real Pentakill games on the champion (its basic-ability Empowers). */
  games: number;
  /** The second-best start pick, when it's within sampling noise of the first: either one works. */
  closeCall: string | null;
};

type Ability = { slot: string; name: string; icon?: string };

let cache: PentakillRow[] | null = null;

export function pentakill(): PentakillRow[] {
  return (cache ??= read());
}

function read(): PentakillRow[] {
  const data = aramhexLatest<Record<string, Record<string, [number, number]>>>("augments");
  if (!data) return [];
  const byKey = new Map(Object.entries(championIds).map(([alias, key]) => [String(key), alias]));
  const client = windowJson<{ champions: { alias: string; abilities?: Ability[] }[] }>("champions/data.js");
  const abilities = new Map((client?.champions ?? []).map((c) => [c.alias, new Map((c.abilities ?? []).map((a) => [a.slot, a]))]));
  type Opt = { champion: string; slot: Slot; games: number; wins: number; base: number };
  const champs: { champion: string; games: number; opts: Opt[] }[] = [];
  for (const [key, augs] of Object.entries(data)) {
    const champion = byKey.get(key);
    if (!champion) continue;
    const count = (s: Slot) => augs[SLOTS[s]] ?? [0, 0];
    const basics = (["Q", "W", "E"] as Slot[]).map((s) => [s, ...count(s)] as const);
    const g = basics.reduce((t, [, n]) => t + n, 0);
    const w = basics.reduce((t, [, , k]) => t + k, 0);
    if (g < 200) continue;
    const opts = (["Q", "W", "E", "R"] as Slot[]).map((s) => ({ champion, slot: s, games: count(s)[0], wins: count(s)[1], base: w / g }));
    champs.push({ champion, games: g, opts });
  }
  const all = champs.flatMap((c) => c.opts);
  const shrunk = shrunkLifts(all);
  const lifts = new Map(all.map((o, k) => [o, shrunk[k]]));
  // DOOM's games all reach level 18: judge it against DOOM's average lift on every champion, not the basics'.
  const doom = all.filter((o) => o.slot === "R" && o.games > 0);
  const doomShift = doom.length ? doom.reduce((t, o) => t + lifts.get(o)! * o.games, 0) / doom.reduce((t, o) => t + o.games, 0) : 0;
  const level18Lift = (o: Opt) => lifts.get(o)! - (o.slot === "R" ? doomShift : 0);
  const v = (o: Opt) => (o.base * (1 - o.base)) / Math.max(1, o.games);
  const picks = champs.map((c) => {
    const basics = c.opts.filter((o) => o.slot !== "R");
    const top = Math.max(...basics.map((o) => o.games));
    const ranked = [...basics].sort((a, b) => Number(b.games >= MIN_SHARE * top) - Number(a.games >= MIN_SHARE * top) || lifts.get(b)! - lifts.get(a)!);
    const [start, second] = ranked;
    const close = second && second.games >= MIN_SHARE * top && lifts.get(start)! - lifts.get(second)! < 2 * Math.sqrt(v(start) + v(second));
    const later = c.opts.filter((o) => o !== start && o.games > 0).sort((a, b) => level18Lift(b) - level18Lift(a))[0] ?? second;
    return { c, start, later, close: close ? second.slot : null };
  });
  const startGrades = grade(picks.map((p) => lifts.get(p.start)!));
  const laterGrades = grade(picks.map((p) => level18Lift(p.later)));
  return picks.map((p, k) => {
    const own = abilities.get(p.c.champion);
    return {
      champion: p.c.champion,
      start: p.start.slot,
      level18: p.later.slot,
      startName: own?.get(p.start.slot)?.name ?? "",
      level18Name: own?.get(p.later.slot)?.name ?? "",
      startIcon: own?.get(p.start.slot)?.icon ?? "",
      level18Icon: own?.get(p.later.slot)?.icon ?? "",
      startScore: startGrades[k].deepScore,
      level18Score: laterGrades[k].deepScore,
      games: p.c.games,
      closeCall: p.close,
    };
  });
}
