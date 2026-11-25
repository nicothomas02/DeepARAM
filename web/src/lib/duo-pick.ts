// "Best pairs" (Nico 2026-11-25: "show more variety, not the same champ repeatedly, just their best"): the pairs by
// win rate boost, best first, keeping a pair only when neither champion is already in a kept pair. So each champion
// shows up once, with its best partner still free. Used by Home's Best duos card and the Duos tab's default view;
// "All pairs" keeps every pair.
export function bestPairs<T extends { a: string; b: string; delta: number }>(rows: T[], n = Infinity): T[] {
  const used = new Set<string>();
  const out: T[] = [];
  for (const r of [...rows].sort((x, y) => y.delta - x.delta)) {
    if (out.length >= n) break;
    if (used.has(r.a) || used.has(r.b)) continue;
    used.add(r.a);
    used.add(r.b);
    out.push(r);
  }
  return out;
}
