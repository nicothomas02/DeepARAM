// Re-ranking a champion's augments once a visitor marks the ones they took (components/champion/AugmentTable.tsx):
// each other augment gains its estimated synergy with those (lib/augment-synergy.ts reads the pairs on the server).
import { COMBO_CAP, COMBO_ODDS } from "./engine/build-engine";

export type SynergyPair = {
  a: number;
  b: number;
  /** Estimated win-rate points the pair adds over the two alone (negative: they overlap). */
  points: number;
  /** When pick order decides (One Hit Wonder and Purist Caster): points with a taken first, and with b taken first. */
  order?: [number, number];
  /** From a confirmed mechanic rather than the Simulator alone. */
  rule: boolean;
  /** Why, for rule pairs (English). */
  why?: string;
};

export type SynergyPart = { with: number; points: number; why?: string };

/** Extra estimated win rate (a fraction) each augment not yet taken gets from its synergy with the taken ones. */
export function synergyWith(pairs: SynergyPair[], taken: number[]): Map<number, { total: number; parts: SynergyPart[] }> {
  const out = new Map<number, { total: number; parts: SynergyPart[] }>();
  const have = new Set(taken);
  for (const p of pairs)
    for (const [mine, other] of [
      [p.a, p.b],
      [p.b, p.a],
    ]) {
      if (!have.has(other) || have.has(mine)) continue;
      // The taken one came first, since `mine` isn't taken yet.
      const points = p.order ? p.order[other === p.a ? 0 : 1] : p.points;
      if (!points) continue;
      const row = out.get(mine) ?? { total: 0, parts: [] };
      row.total += points / 100;
      row.parts.push({ with: other, points, ...(p.why ? { why: p.why } : {}) });
      out.set(mine, row);
    }
  for (const row of out.values()) row.parts.sort((x, y) => Math.abs(y.points) - Math.abs(x.points));
  return out;
}

/** Share of a confirmed pair's points an augment gets per pick still to come after it, and the most it gets: the
 *  build engine's numbers (measured on 11,702 player-games, PR #631: a half-taken combo's partner arrived about 4% of
 *  the time per pick left), so the site and the apps rank the same way. */
export const COMBO_SHARE_PER_PICK = COMBO_ODDS;
export const COMBO_SHARE_MAX = COMBO_CAP;

/**
 * Combo potential (Nico 2026-11-21): each augment not yet taken whose confirmed partner (a rule pair, never the
 * Simulator alone) is still in the pool and not taken gets a share of the pair's points: 4% per pick left after it,
 * at most 12%, from its best partner. Points as in the pairs (win-rate points). Matches the desktop companion.
 */
export function comboPotential(
  pairs: SynergyPair[],
  taken: number[],
  pool: Set<number>,
  picks: number,
): Map<number, { with: number; points: number }> {
  const out = new Map<number, { with: number; points: number }>();
  const have = new Set(taken);
  const left = picks - taken.length - 1;
  const share = Math.min(COMBO_SHARE_MAX, COMBO_SHARE_PER_PICK * Math.max(0, left));
  if (!share) return out;
  for (const p of pairs) {
    if (!p.rule) continue;
    for (const [mine, other] of [
      [p.a, p.b],
      [p.b, p.a],
    ]) {
      if (have.has(mine) || have.has(other) || !pool.has(other)) continue;
      // `mine` comes first, then the partner.
      const full = p.order ? p.order[mine === p.a ? 0 : 1] : p.points;
      const points = full * share;
      if (points > (out.get(mine)?.points ?? 0)) out.set(mine, { with: other, points: Math.round(points * 100) / 100 });
    }
  }
  return out;
}

/** A pair's "why" (English, data/estimates/augment_synergy_rules.json) as a translatable template: each augment
 *  name in it becomes {1}, {2} in order of appearance, so the sentence translates once and the names fill in in the
 *  page's language. `names`: [English name, id] of the two augments. */
export function synergyWhyTemplate(why: string, names: [string, number][]): { key: string; ids: number[] } {
  const found = names.filter(([n]) => n && why.includes(n)).sort((x, y) => why.indexOf(x[0]) - why.indexOf(y[0]));
  let key = why;
  found.forEach(([n], i) => (key = key.split(n).join(`{${i + 1}}`)));
  return { key, ids: found.map(([, id]) => id) };
}
