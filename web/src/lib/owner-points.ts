import "server-only";
import championIds from "@/data/champion-ids.json";
import { augmentTiers } from "./augment-tiers";
import { augmentPages } from "./augments";
import { augmentScores } from "./champion-augments";
import { augmentSynergy } from "./augment-synergy";
import { championPage } from "./champion-page";
import { champList } from "./champions";
import { augmentSpread, championEstimates } from "./estimates";
import { scorecard } from "./scorecard";
import { augmentSynergies } from "./synergies";
import type { OwnerPoints } from "./owner-view";

// The owner view (Nico 2026-11-27): the public site shows augments without win-rate points (Riot's developer policy,
// lib/augment-policy.ts); the signed-in owner still sees them. Those numbers are gathered here at build time
// (scripts/owner-points.ts) into web/src/generated/owner-points.json, which is not in the repo and not a public file:
// the Worker bundles it into its own code, and /api/owner/points hands it out only after checking the owner's sign-in.

const IDS = championIds as Record<string, number>;
const r4 = (n: number | undefined | null) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null);

export function ownerPoints(): OwnerPoints {
  const out: OwnerPoints = { tierList: {}, augments: {}, champions: {}, patches: {} };
  const best = new Map(augmentPages().map((p) => [p.id, p.best]));
  for (const a of augmentTiers())
    out.tierList[a.id] = { lift: r4(a.lift), edge: r4(a.edge), spread: r4(augmentSpread(a.id)), best: best.get(a.id)?.[0]?.id ?? null };
  for (const a of augmentPages()) {
    const champions: Record<string, number> = {};
    for (const tab of augmentSynergies(a.id))
      if (tab.id === "champions") for (const r of tab.rows) if (r.score !== undefined) champions[String(r.names[0].id)] = r4(r.score)!;
    out.augments[a.id] = { edge: r4(augmentTiers().find((x) => x.id === a.id)?.edge), best: a.best.map((b) => [b.id, r4(b.boost)]), champions };
  }
  for (const { id: alias } of champList()) {
    const p = championPage(alias);
    if (!p?.augments.length) continue;
    const est = championEstimates(IDS[alias] ?? -1);
    const pooled = augmentScores(alias).edges;
    const live = augmentScores(alias, true).edges;
    const rows: Record<string, [number | null, number | null, number | null]> = {};
    for (const a of p.augments) rows[a.id] = [r4(est?.augments.get(a.id)?.lift), r4(pooled?.get(a.id)), r4(live?.get(a.id))];
    // Points only: the pairs themselves (which augments, why) are on the public page with just their direction.
    const pairs = augmentSynergy(alias, p.augments.map((a) => a.id)).map(
      (x): [number, number, number, ...number[]] => [x.a, x.b, x.points, ...(x.order ?? [])],
    );
    out.champions[alias] = { rows, pairs };
  }
  for (const s of scorecard()) {
    const x = s.augments;
    if (x && typeof x === "object") out.patches[s.from] = [x.deepscore.lead, x.popular.lead];
  }
  return out;
}
