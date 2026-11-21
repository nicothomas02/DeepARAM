// Re-ranking a champion's augments once a visitor marks the ones they took (components/champion/AugmentTable.tsx):
// each other augment gains its estimated synergy with those (lib/augment-synergy.ts reads the pairs on the server).

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

/** Share of a confirmed pair's points an augment gets per pick still to come after it, and the most it gets. */
export const COMBO_SHARE_PER_PICK = 0.25;
export const COMBO_SHARE_MAX = 0.6;

/**
 * Combo potential (Nico 2026-11-21): each augment not yet taken whose confirmed partner (a rule pair, never the
 * Simulator alone) is still in the pool and not taken gets a share of the pair's points: 25% per pick left after it,
 * at most 60%, from its best partner. Points as in the pairs (win-rate points). Matches the desktop companion.
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
