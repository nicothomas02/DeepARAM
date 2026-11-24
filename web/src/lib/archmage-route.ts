import "server-only";
import { readRepoJson } from "./repo-data";
import { clashes } from "./item-limits";

/**
 * AP Ashe with Archmage (Nico 2026-11-24: "Have AP Ashe build follow guide from aramhex for optimizing with
 * archmage"). The guide's method, on our own numbers: Archmage makes Hawkshot (E) and R refund each other, and from
 * enough Ability Haste the loop never stops. So the build reaches that haste first, with the fewest of the items AP
 * Ashe players build plus Ionian Boots (then the higher DeepScore, then the cheaper), and fills the rest of the build
 * by DeepScore. The haste each set of loop augments needs, per R and E rank, comes from the site's Infinite Ashe
 * calculator (tools/fun/ashe-calculator/thresholds.js -> data/estimates/ashe_archmage.json). Estimated.
 */

/**
 * Which reading of Archmage's random target the targets use (thresholds.js): "onCooldown" (refunds land only on
 * abilities on cooldown and Volley isn't cast: the guide's) or "anyAbility" (Q can take a refund too: no loop).
 */
export const ARCHMAGE_RULE: "onCooldown" | "anyAbility" = "onCooldown";
export const ASHE = 22;
/** Augments that change the loop, shown on the card when Ashe takes them (Ultimate Awakening, Recursion, Purist). */
export const CARD_EXTRAS = [[], [1349], [3055], [2018], [1349, 3055]] as const;

type FileItem = { name: string; price: number; haste: number; ultHaste: number };
type File = {
  archmage: number;
  items: Record<string, FileItem>;
  rules: Record<string, Record<string, Record<string, (number | null)[]>>>;
};

export type ArchmageRoute = {
  /** Loop augments taken with Archmage (ids), none for Archmage alone. */
  with: number[];
  /** Hawkshot rank that needs the least haste with this route (fewest points first when tied). */
  eRank: number;
  /** Ability Haste the loop needs at R rank 3 with that Hawkshot rank (items' Ultimate Haste counted). */
  need: number | null;
  /** Ability Haste the route's items give (boots included). */
  haste: number;
  /** Whether the items alone reach `need`; else the route is the most haste the build can hold. */
  reach: boolean;
  /** Boots first, then the haste items to reach the loop (most haste first), then the rest by DeepScore. */
  items: number[];
  /** How many of `items` after the boots are the haste route (the rest fill the build). */
  routeLen: number;
};

const base = (i: number) => (i >= 100000 ? i % 10000 : i);

/**
 * The routes for AP Ashe: `pool` = the items AP Ashe players build (her AP build's core and later items), `boots` =
 * that build's boots, `score` = each item's DeepScore on Ashe.
 */
export function archmageRoutes(pool: number[], boots: number | undefined, score: (id: number) => number, file = readRepoJson<File>("data/estimates/ashe_archmage.json")): ArchmageRoute[] {
  const rule = file?.rules[ARCHMAGE_RULE];
  if (!file || !rule) return [];
  const stat = (i: number) => file.items[String(base(i))];
  const items = [...new Set(pool.map(base))].filter((i) => stat(i));
  const bootHaste = boots !== undefined ? (stat(boots)?.haste ?? 0) : 0;
  const ok = (set: number[]) => set.every((a, i) => set.slice(i + 1).every((b) => !clashes(a, b)));
  const sets: number[][] = [];
  const grow = (from: number, cur: number[]) => {
    if (cur.length) sets.push(cur);
    if (cur.length === 5) return;
    for (let i = from; i < items.length; i++) if (ok([...cur, items[i]])) grow(i + 1, [...cur, items[i]]);
  };
  grow(0, []);
  sets.push([]);
  const mean = (s: number[]) => (s.length ? s.reduce((t, i) => t + score(i), 0) / s.length : 0);
  const price = (s: number[]) => s.reduce((t, i) => t + (stat(i)?.price ?? 0), 0);

  return CARD_EXTRAS.map((extras) => {
    const key = [...extras].sort((a, b) => a - b).join("+") || "-";
    const grid = rule[key];
    // Best Hawkshot rank for a set: the least haste needed (fewest points when tied).
    const needFor = (s: number[]) => {
      const row = grid?.[s.some((i) => (stat(i)?.ultHaste ?? 0) > 0) ? "R3u" : "R3"] ?? [];
      let best: { e: number; need: number } | null = null;
      row.forEach((n, i) => {
        if (n !== null && (!best || n < best.need)) best = { e: i + 1, need: n };
      });
      return best as { e: number; need: number } | null;
    };
    const hasteOf = (s: number[]) => bootHaste + s.reduce((t, i) => t + (stat(i)?.haste ?? 0), 0);
    const reaching = sets
      .map((s) => ({ s, n: needFor(s), h: hasteOf(s) }))
      .filter((x) => x.n && x.h >= x.n.need)
      .sort((x, y) => x.s.length - y.s.length || mean(y.s) - mean(x.s) || price(x.s) - price(y.s));
    const most = [...sets].sort((x, y) => hasteOf(y) - hasteOf(x) || mean(y) - mean(x))[0] ?? [];
    const pick = reaching[0] ?? { s: most, n: needFor(most), h: hasteOf(most) };
    const route = [...pick.s].sort((a, b) => (stat(b)?.haste ?? 0) - (stat(a)?.haste ?? 0) || score(b) - score(a));
    const fill = items
      .filter((i) => !route.includes(i))
      .sort((a, b) => score(b) - score(a))
      .reduce<number[]>((out, i) => (out.length + route.length < 5 && ok([...route, ...out, i]) ? [...out, i] : out), []);
    return {
      with: [...extras],
      eRank: pick.n?.e ?? 5,
      need: pick.n?.need ?? null,
      haste: pick.h,
      reach: !!reaching[0],
      items: [...(boots !== undefined ? [boots] : []), ...route, ...fill],
      routeLen: route.length,
    };
  });
}
