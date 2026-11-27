import "server-only";
import { readRepoJson } from "./repo-data";
import { damageDealtWorth, impactTally } from "./analysis";
import type { Validation } from "./sim-analysis";

/** The public repository with the studies' code, notebooks and tests. Null until it is public (Nico decides),
 *  so the Research tab shows no link to a private repository. */
export const NOTEBOOK_REPO: string | null = null;

// What the Research page reads (simulator/analysis/validation.json, data/analysis/patch_impact.json). Each
// reader returns null when its file is missing, so the page just leaves that figure out.

export const patchImpactSummary = () => {
  const t = impactTally();
  const w = damageDealtWorth();
  return t && w ? { ...t, pts: w.pts, ci: w.ci } : null;
};

export function simulatorValidation() {
  const v = readRepoJson<Validation>("simulator/analysis/validation.json");
  if (!v || !v.history?.length) return null;
  return {
    n: v.n,
    rho: v.dps_vs_damage_share.rho,
    ci: v.dps_vs_damage_share.ci95 ?? null,
    adjusted: v.role_adjusted.spearman.rho,
    slope: v.role_adjusted.calibration_slope,
    versions: v.history.length,
    first: v.history[0].spearman,
    last: v.history_current.spearman,
  };
}
