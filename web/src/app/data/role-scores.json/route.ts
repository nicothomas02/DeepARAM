import { readRepoJson } from "@/lib/repo-data";

// The owner app's post-game "what mattered" card (data/estimates/role_scores.py, what_mattered): each champion's
// post-game score, its stats with signs, and the typical player per champion (mean and SD of each stat; pooled by
// main subclass, subclass_of, where a champion has too few players). Aggregates only. Built once per deploy.
type RoleScores = {
  scores: Record<string, [string, number][]>;
  champions: Record<string, { score: string }>;
  labels: Record<string, string>;
  min_norm: number;
  norms: Record<string, unknown>;
  subclass_norms: Record<string, unknown>;
  subclass_of: Record<string, string>;
  score_of?: Record<string, string>;
};

export const dynamic = "force-static";

export function GET() {
  const r = readRepoJson<RoleScores>("data/estimates/role_scores.json");
  if (!r) return Response.json({ scores: {}, champions: {}, labels: {}, norms: {}, subclass_norms: {}, subclass_of: {} });
  // Every champion's score (its own pick, else the subclass default), so the app never guesses a default.
  const champions = r.score_of ?? Object.fromEntries(Object.entries(r.champions ?? {}).map(([id, v]) => [id, v.score]));
  return Response.json({ scores: r.scores, champions, labels: r.labels, min_norm: r.min_norm, norms: r.norms ?? {}, subclass_norms: r.subclass_norms ?? {}, subclass_of: r.subclass_of ?? {} });
}
