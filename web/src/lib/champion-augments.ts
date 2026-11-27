import "server-only";
import championIds from "@/data/champion-ids.json";
import { augmentPrior, priorLeads, scoreRows, type AugmentPrior, type LeadRow } from "./card-score";
import { FIT, grade } from "./deepscore";
import { championPage } from "./champion-page";
import { champList } from "./champions";
import { championEstimates } from "./estimates";

// One ranking of a champion's augments, shared by everything that names its best augments: the champion page's
// game card and augment table, the page's search description, and the build helper (Nico, 2026-11-20: the card
// and the rest of the site must agree). Augments rank by their letter grade on this champion first (S, A, B, C: the
// one measure the feed gives per champion), then by DeepScore: the estimated win rate with it here, trusted less
// when the champion rarely takes it, so a rare pick with a small boost (Icathia's Fall on Yasuo, 0.3% of games)
// can't top the list. The estimate leans on each augment's effect over all champions, so on its own it would put a
// generally strong augment over one this champion is graded S with. Ties fall back to pick rate. The timeframe
// card ranks past patches the same way (lib/timeframe.ts).
//
// With real games and wins per champion and augment (AramHex, Nico 2026-11-21), DeepScore comes straight from them:
// each augment's win rate shrunk toward the champion's list by its own sampling noise (lib/card-score.ts), and the
// letter grade no longer goes first. Backtest (AramHex 16.20-16.23, 173 champions, augments in at least 1% of the
// champion's games): the top 5 by real DeepScore led the champion by +3.9 / +4.5 / +4.8 pts on the next patch, vs
// +1.1 / +1.9 / +2.0 for grade-then-popularity and +3.8 / +4.4 / +4.7 for grade-then-real-DeepScore. Holding an
// augment and winning are correlated, not proof it causes the win (correlation rule).
//
// 2026-11-27: real-games DeepScore leans on how each augment does on the other champions (lib/card-score.ts
// priorLeads): one rule for the page, the card and the apps' augment panel (augmentLeads), ahead of the bound rule on
// top-5 lists and never worse on 3-card offers in the next-patch replay.

const IDS = championIds as Record<string, number>;

/** A score map built from real games (grade no longer leads, byScore). edges: each augment's lead over the champion's
 *  augment average in win-rate points (lib/deepscore.ts grade edge), for the DeepScore badge's hover. */
export type Scores = Map<number, number> & { real?: boolean; edges?: Map<number, number> };

/** Augment id -> DeepScore on this champion; empty when there's no estimate. By default each augment's games pool in
 *  earlier patches where its result didn't change (Nico 2026-11-23; AugmentRow.pooled); thisPatch scores on the
 *  live patch's games alone (the augment table's "This patch only" switch). */
export function augmentScores(alias: string, thisPatch = false): Scores {
  const p = championPage(alias);
  const leads = augmentLeads(alias, thisPatch);
  if (p && leads.size) {
    const ids = p.augments.map((a) => a.id);
    const g = grade(ids.map((id) => leads.get(id)!));
    const m: Scores = new Map(ids.map((id, i) => [id, g[i].deepScore]));
    m.real = true;
    m.edges = new Map(ids.map((id, i) => [id, g[i].edge]));
    return m;
  }
  const est = championEstimates(IDS[alias] ?? -1);
  if (!p || !est) return new Map();
  const rows = scoreRows(
    p.augments.flatMap((a) => {
      const e = est.augments.get(a.id);
      return e ? [{ id: a.id, winRate: e.winRate, pickRate: a.pickRate }] : [];
    }),
  );
  const m: Scores = new Map(rows.map((r) => [r.id, r.deepScore as number]));
  m.edges = new Map(rows.flatMap((r) => (typeof r.deepEdge === "number" ? [[r.id, r.deepEdge] as [number, number]] : [])));
  return m;
}

/** The rows real-games DeepScore ranks on: earlier patches pooled in where nothing changed (AugmentRow.pooled) unless
 *  thisPatch. Null unless every augment has real games. */
function leadRows(alias: string, thisPatch: boolean): LeadRow[] | null {
  const p = championPage(alias);
  if (!p || !p.augments.length || !p.augments.every((a) => a.games && a.winRate !== undefined)) return null;
  return p.augments.map((a) => ({ id: a.id, pickRate: a.pickRate, ...(!thisPatch && a.pooled ? { winRate: a.pooled.winRate, games: a.pooled.games } : { winRate: a.winRate!, games: a.games! }) }));
}

const priors = new Map<boolean, AugmentPrior>();
function prior(thisPatch: boolean): AugmentPrior {
  let f = priors.get(thisPatch);
  if (!f) {
    const lists: Record<string, LeadRow[]> = {};
    for (const { id } of champList()) {
      const rows = leadRows(id, thisPatch);
      if (rows) lists[id] = rows;
    }
    f = augmentPrior(lists);
    priors.set(thisPatch, f);
  }
  return f;
}

/** Augment id -> its real-games score on this champion as a win-rate lead (lib/card-score.ts priorLeads), the order
 *  DeepScore follows; empty without real games. The apps' augment panel adds synergy points on this scale. */
export function augmentLeads(alias: string, thisPatch = false): Map<number, number> {
  const rows = leadRows(alias, thisPatch);
  if (!rows || !FIT.augments) return new Map();
  const mu = prior(thisPatch);
  return priorLeads(rows, (id) => mu(alias, id), FIT.augments);
}

const GRADE: Record<string, number> = { S: 4, A: 3, B: 2, C: 1 };
type Row = { id: number; pickRate: number; grade?: string };

/** Compare two augment rows: better grade first (estimates only), then higher DeepScore, then higher pick rate. */
export const byScore = (scores: Scores) => (x: Row, y: Row) =>
  (scores.real ? 0 : (GRADE[y.grade ?? ""] ?? 0) - (GRADE[x.grade ?? ""] ?? 0)) ||
  (scores.get(y.id) ?? -1) - (scores.get(x.id) ?? -1) ||
  y.pickRate - x.pickRate;

/** The champion's augments, best first, with names and rarities. */
export function rankedAugments(alias: string) {
  const p = championPage(alias);
  if (!p) return [];
  const scores = augmentScores(alias);
  return [...p.augments].sort(byScore(scores)).map((a) => ({ ...a, deepScore: scores.get(a.id) }));
}
