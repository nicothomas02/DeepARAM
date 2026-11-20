import "server-only";
import championIds from "@/data/champion-ids.json";
import { scoreRows } from "./card-score";
import { championPage } from "./champion-page";
import { championEstimates } from "./estimates";

// One ranking of a champion's augments, shared by everything that names its best augments: the champion page's
// game card and augment table, the page's search description, and the build helper (Nico, 2026-11-20: the card
// and the rest of the site must agree). Augments rank by their letter grade on this champion first (S, A, B, C: the
// one measure the feed gives per champion), then by DeepScore: the estimated win rate with it here, trusted less
// when the champion rarely takes it, so a rare pick with a small boost (Icathia's Fall on Yasuo, 0.3% of games)
// can't top the list. The estimate leans on each augment's effect over all champions, so on its own it would put a
// generally strong augment over one this champion is graded S with. Ties fall back to pick rate. The timeframe
// card ranks past patches the same way (lib/timeframe.ts).

const IDS = championIds as Record<string, number>;

/** Augment id -> DeepScore on this champion; empty when there's no estimate. */
export function augmentScores(alias: string): Map<number, number> {
  const p = championPage(alias);
  const est = championEstimates(IDS[alias] ?? -1);
  if (!p || !est) return new Map();
  return new Map(
    scoreRows(
      p.augments.flatMap((a) => {
        const e = est.augments.get(a.id);
        return e ? [{ id: a.id, winRate: e.winRate, pickRate: a.pickRate }] : [];
      }),
    ).map((r) => [r.id, r.deepScore as number]),
  );
}

const GRADE: Record<string, number> = { S: 4, A: 3, B: 2, C: 1 };
type Row = { id: number; pickRate: number; grade?: string };

/** Compare two augment rows: better grade first, then higher DeepScore, then higher pick rate. */
export const byScore = (scores: Map<number, number>) => (x: Row, y: Row) =>
  (GRADE[y.grade ?? ""] ?? 0) - (GRADE[x.grade ?? ""] ?? 0) ||
  (scores.get(y.id) ?? -1) - (scores.get(x.id) ?? -1) ||
  y.pickRate - x.pickRate;

/** The champion's augments, best first, with names and rarities. */
export function rankedAugments(alias: string) {
  const p = championPage(alias);
  if (!p) return [];
  const scores = augmentScores(alias);
  return [...p.augments].sort(byScore(scores)).map((a) => ({ ...a, deepScore: scores.get(a.id) }));
}
