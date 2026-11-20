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
