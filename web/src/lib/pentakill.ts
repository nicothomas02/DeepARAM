import "server-only";
import championIds from "@/data/champion-ids.json";
import { windowJson } from "./champion-page";
import { readRepoJson } from "./repo-data";

// Pentakill tab (/tier-list?tab=pentakill): which ability each champion should Empower in a Pentakill game, one
// basic ability at the start and a second one (the ultimate allowed) at level 18. data/estimates/champion_upgrades.py
// picks them in the Simulator on the champion's most popular build and turns the gain into estimated win rate points.

type Pick = { score: number; early: number; mid: number; late: number };
export type PentakillData = {
  patch: string;
  champions: Record<
    string,
    {
      key: string;
      pentakill: {
        start: string;
        level18: string;
        start_options: Record<string, Pick>;
        level18_options: Record<string, number>;
        boost?: number;
      } | null;
    }
  >;
};

export type PentakillRow = {
  /** Champion id, as the tables and pages use it ("MonkeyKing"). */
  champion: string;
  start: string;
  level18: string;
  startName: string;
  level18Name: string;
  startIcon: string;
  level18Icon: string;
  /** Estimated win rate points from both Empowers, as a fraction (0.004 = 0.4 points). */
  boost: number;
  /** Simulated: how much stronger each pick makes the champion, as a fraction. */
  startGain: number;
  level18Gain: number;
  /** The best start pick other than the chosen one, and how far behind it is, as a fraction (negative when the
   *  writer chose a lower-scored ability, which the role judgment can). */
  runnerUp: string;
  runnerUpName: string;
  margin: number;
};

type Ability = { slot: string; name: string; icon?: string };
/** champions/data.js, the part with each champion's ability names and icons. */
export type ClientAbilities = { champions: { alias: string; abilities?: Ability[] }[] };

// Where the data file lists Q, W and E in no fixed order, ties break in this order.
const SLOTS = ["Q", "W", "E", "R"];
const slotOrder = (s: string) => (SLOTS.includes(s) ? SLOTS.indexOf(s) : SLOTS.length);
// A score the file left out, null or NaN counts as no gain, never as NaN on the page.
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

let cache: PentakillRow[] | null = null;
let file: { loaded: boolean; data: unknown } = { loaded: false, data: null };

/** data/estimates/champion_upgrades.json, read once; lib/champion-upgrades.ts reads its other parts from here. */
export function upgradesFile<T>(): T | null {
  if (!file.loaded) file = { loaded: true, data: readRepoJson<unknown>("data/estimates/champion_upgrades.json") };
  return file.data as T | null;
}

export function pentakill(): PentakillRow[] {
  return (cache ??= pentakillRows(upgradesFile<PentakillData>(), windowJson<ClientAbilities>("champions/data.js")));
}

/** The tab's rows from the data file and the client's ability names: best boost first, then by champion. */
export function pentakillRows(data: PentakillData | null, client: ClientAbilities | null): PentakillRow[] {
  if (!data?.champions) return [];
  const byKey = new Map(Object.entries(championIds).map(([alias, key]) => [String(key), alias]));
  const abilities = new Map((client?.champions ?? []).map((c) => [c.alias, new Map((c.abilities ?? []).map((a) => [a.slot, a]))]));
  const rows: PentakillRow[] = [];
  for (const [key, c] of Object.entries(data.champions)) {
    const pk = c?.pentakill;
    const champion = byKey.get(key);
    // A champion without picks (no build to simulate), without a boost or unknown to the site has no row; the
    // level 18 pick must be another ability.
    if (!pk || !champion || !pk.start || !pk.level18 || pk.start === pk.level18 || !Number.isFinite(pk.boost)) continue;
    const own = abilities.get(champion);
    const name = (slot: string) => own?.get(slot)?.name ?? "";
    const icon = (slot: string) => own?.get(slot)?.icon ?? "";
    const options = Object.entries(pk.start_options ?? {}).map(([slot, p]) => [slot, num(p?.score)] as const);
    const startScore = options.find(([slot]) => slot === pk.start)?.[1] ?? 0;
    // The runner-up is the best of the other options, never the start pick itself (the writer judges by role, so
    // the chosen pick isn't always the top score, and ties are common when an ability gains nothing).
    const [runnerUp] = options.filter(([slot]) => slot !== pk.start).sort((a, b) => b[1] - a[1] || slotOrder(a[0]) - slotOrder(b[0]));
    rows.push({
      champion,
      start: pk.start,
      level18: pk.level18,
      startName: name(pk.start),
      level18Name: name(pk.level18),
      startIcon: icon(pk.start),
      level18Icon: icon(pk.level18),
      boost: num(pk.boost) / 100,
      startGain: startScore / 100,
      level18Gain: num(pk.level18_options?.[pk.level18]) / 100,
      runnerUp: runnerUp?.[0] ?? "",
      runnerUpName: runnerUp ? name(runnerUp[0]) : "",
      margin: runnerUp ? (startScore - runnerUp[1]) / 100 : 0,
    });
  }
  // The tab opens sorted by boost; equal boosts keep one order whatever the file's.
  return rows.sort((a, b) => b.boost - a.boost || a.champion.localeCompare(b.champion));
}
