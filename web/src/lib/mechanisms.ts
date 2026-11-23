import "server-only";
import { readRepoJson } from "./repo-data";

// What an augment or item directly changes for the player holding it (data/estimates/mechanism_profiles.json): the
// gap to the same champion in games of similar length, per stat. It explains a pick and never ranks or filters one
// (thread "Reduce over-reliance on win rate", 2026-11-23). Shown as an estimate with no word on where it comes from.

export const METRICS = ["damage", "healing", "mitigated", "cc", "deaths"] as const;
export type Metric = (typeof METRICS)[number];
type Profile = Record<Metric, { change: number; z: number }>;
type Profiles = { made: string; augments: Record<string, Profile>; items: Record<string, Profile> };

/** One effect worth saying: the metric and its signed, formatted change ("+91%", "-0.4"). */
export type Effect = { metric: Metric; n: string };

/** The served file: every profile, change and z only. */
export const mechanismProfiles = () => readRepoJson<Profiles>("data/estimates/mechanism_profiles.json");

/**
 * The (at most `max`) clearest effects of an augment or item: |z| >= 3, largest |z| first. `shield`: the pick also
 * shields, and shields on allies aren't measured, so its healing line would mislead and is left out.
 */
export function whatItDoes(kind: "augments" | "items", id: number, { shield = false, max = 2 } = {}): Effect[] {
  const all = mechanismProfiles()?.[kind];
  if (!all) return [];
  const base = kind === "items" && id >= 100000 ? id % 10000 : id;
  const p = all[String(base)] ?? (kind === "augments" && base < 1000 ? all[String(base + 1000)] : undefined);
  if (!p) return [];
  // Clear (|z| >= 3) and big enough to matter (8% a minute, 0.3 deaths per 10 minutes): a "+3% damage" on Infinity
  // Edge is real but reads as noise (sanity rule).
  const big = (m: Metric) => Math.abs(p[m].change) >= (m === "deaths" ? 0.3 : 8);
  return METRICS.filter((m) => p[m] && Math.abs(p[m].z) >= 3 && big(m) && !(shield && m === "healing"))
    .sort((a, b) => Math.abs(p[b].z) - Math.abs(p[a].z))
    .slice(0, max)
    .map((m) => {
      const c = p[m].change;
      const sign = c > 0 ? "+" : c < 0 ? "-" : "";
      return { metric: m, n: m === "deaths" ? `${sign}${Math.abs(c).toFixed(1)}` : `${sign}${Math.round(Math.abs(c))}%` };
    });
}
