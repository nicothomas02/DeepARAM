import "server-only";
import championIds from "@/data/champion-ids.json";
import { augmentSynergy } from "./augment-synergy";
import { augmentTiers } from "./augment-tiers";
import { readRepoJson } from "./repo-data";
import { championPage } from "./champion-page";
import { champList } from "./champions";
import { championEstimates } from "./estimates";
import { augmentScores } from "./champion-augments";

// Every champion's augments in the champion page's order, for the desktop app's augment panel (apps/desktop
// companion.html): ranked by the champion's estimated boost from each augment (the page's "Boost"), else by its
// DeepScore, with the confirmed synergy pairs so the panel can re-rank once the player marks what they took.
// The panel shows the ranking and each augment's DeepScore on this champion (Nico 2026-11-20), never raw win
// rates. Public data only.

export type AugmentPicks = {
  /** id -> [name, rarity] */
  augments: Record<string, [string, string]>;
  /** alias -> augment ids, best first: [id, ranking score (boost, as a fraction), DeepScore on this champion (as on
   *  the champion page; -1 when there's none), 1 when the score is the estimated boost, 0 when it stands in from
   *  DeepScore] */
  champions: Record<string, [number, number, number, number][]>;
  /** alias -> [a, b, points] synergy pairs (points: estimated win-rate points; order-dependent pairs use the larger) */
  pairs: Record<string, [number, number, number][]>;
  /** augment id -> the build styles it points to (crit, onhit, ap, lethality, fighter, tank, enchanter) */
  styles: Record<string, string[]>;
  /** alias -> the champion's builds by style (public live stats, data/estimates/build_archetypes.json), most played
   *  first: [style, share of games, boots, core, later] (item ids) */
  builds: Record<string, [string, number, number[], number[], number[]][]>;
};

type Archetype = {
  style: string;
  share: number;
  boots?: number[];
  core?: number[];
  later?: number[];
};

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function augmentPicks(): AugmentPicks {
  const scores = new Map(augmentTiers().map((a) => [a.id, a.deepScore]));
  const ids0 = championIds as Record<string, number>;
  const ids = championIds as Record<string, number>;
  const tiers = augmentTiers();
  const out: AugmentPicks = {
    augments: {},
    champions: {},
    pairs: {},
    styles: {},
    builds: {},
  };
  for (const a of tiers) if (a.styles.length) out.styles[a.id] = a.styles;
  const arch =
    readRepoJson<{ champions: Record<string, Archetype[]> }>(
      "data/estimates/build_archetypes.json",
    )?.champions ?? {};
  for (const { id: alias } of champList()) {
    const p = championPage(alias);
    if (!p?.augments.length) continue;
    const est = championEstimates(ids[alias] ?? -1);
    const deep = augmentScores(alias);
    const rows = p.augments.map((a) => {
      out.augments[a.id] = [a.name, a.rarity];
      const lift = est?.augments.get(a.id)?.lift;
      // No estimate: fall back to DeepScore around its middle (50), scaled to about the same size as a boost.
      const score = lift ?? ((scores.get(a.id) ?? 50) - 50) / 1000;
      return [a.id, r4(score), deep.get(a.id) ?? -1, lift === undefined ? 0 : 1] as [number, number, number, number];
    });
    out.champions[alias] = rows.sort((x, y) => y[1] - x[1]);
    const builds = arch[String(ids0[alias])] ?? [];
    if (builds.length > 1)
      out.builds[alias] = builds.map((b) => [
        b.style,
        r4(b.share),
        b.boots ?? [],
        b.core ?? [],
        b.later ?? [],
      ]);
    out.pairs[alias] = augmentSynergy(
      alias,
      rows.map((r) => r[0]),
    ).map((s) => [s.a, s.b, r4(s.order ? Math.max(...s.order) : s.points)]);
  }
  return out;
}
