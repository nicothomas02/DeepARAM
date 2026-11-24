import "server-only";
import championIds from "@/data/champion-ids.json";
import { augmentSynergy } from "./augment-synergy";
import { augmentTiers } from "./augment-tiers";
import { readRepoJson } from "./repo-data";
import { championPage } from "./champion-page";
import { champList } from "./champions";
import { championEstimates } from "./estimates";
import { augmentScores } from "./champion-augments";
import { shrunkLeads } from "./card-score";
import { FIT } from "./deepscore";
import { livePatch } from "./highlights";
import { patchName } from "./patch-name";

// Every champion's augments in the champion page's order, for the desktop app's augment panel (apps/desktop
// companion.html): ranked like the champion page (real games: DeepScore order), else by the estimated boost, else by its
// DeepScore, with the confirmed synergy pairs so the panel can re-rank once the player marks what they took.
// The panel shows the ranking and each augment's DeepScore on this champion (Nico 2026-11-20), never raw win
// rates. Public data only.

export type AugmentPicks = {
  /** id -> [name, rarity] */
  augments: Record<string, [string, string]>;
  /** alias -> augment ids, best first: [id, ranking score (boost, as a fraction), DeepScore on this champion (as on
   *  the champion page; -1 when there's none), 1 when the score is the estimated boost, 0 when it stands in from
   *  DeepScore, the score's standard error in win-rate points (real games only, else -1), pick rate on the champion]
   *  The last two let the engine's Feeling lucky tilt tell near-ties apart (lib/engine luckyOrder). */
  champions: Record<string, [number, number, number, number, number, number][]>;
  /** alias -> [a, b, points] synergy pairs (points: estimated win-rate points; order-dependent pairs use the larger) */
  pairs: Record<string, [number, number, number][]>;
  /** augment id -> the build styles it points to (crit, onhit, ap, lethality, fighter, tank, enchanter) */
  styles: Record<string, string[]>;
  /** alias -> the champion's builds by style (public live stats, data/estimates/build_archetypes.json), most played
   *  first: [style, share of games, boots, core, later] (item ids). Niche builds (data/estimates/niche_builds.json) come
   *  after, with a 6th entry: the augments that switch to them. */
  builds: Record<string, [string, number, number[], number[], number[], number[]?][]>;
  /** alias -> the same rows as `champions`, ranked on the live patch's games alone ("16.23 only"); only champions
   *  where pooling earlier patches changes something. `champions` is the pooled default ("16.23+"). */
  only: Record<string, [number, number, number, number, number, number][]>;
  /** The live patch's name ("16.23"), for the switch's labels. */
  patch: string | null;
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
    only: {},
    patch: patchName(livePatch()) || null,
  };
  for (const a of tiers) if (a.styles.length) out.styles[a.id] = a.styles;
  const arch =
    readRepoJson<{ champions: Record<string, Archetype[]> }>(
      "data/estimates/build_archetypes.json",
    )?.champions ?? {};
  const niche =
    readRepoJson<{ champions: Record<string, (Archetype & { triggers?: number[] })[]> }>("data/estimates/niche_builds.json")?.champions ?? {};
  for (const { id: alias } of champList()) {
    const p = championPage(alias);
    if (!p?.augments.length) continue;
    const est = championEstimates(ids[alias] ?? -1);
    // thisPatch: the "16.23 only" switch (Nico 2026-11-24), the live patch's games alone, as on the champion page.
    const rank = (thisPatch: boolean) => {
      const deep = augmentScores(alias, thisPatch);
      const use = (a: (typeof p.augments)[number]) =>
        !thisPatch && a.pooled ? a.pooled : a.winRate !== undefined && a.games ? { winRate: a.winRate, games: a.games } : null;
      // Real games and wins on this champion (AramHex): rank by each augment's shrunk lead over the champion's list,
      // the same order as its DeepScore on the champion page (2026-11-23: the old estimated boost, built from overall
      // augment strength, disagreed with the page's #1 in 63% of champion x rarity lists). Shown as DeepScore only.
      const real = deep.real
        ? shrunkLeads(
            // Earlier patches pooled in where nothing changed, as the page's default DeepScore (AugmentRow.pooled).
            p.augments.map((a) => ({ id: a.id, pickRate: a.pickRate, ...(use(a) ?? { winRate: a.winRate ?? 0, games: a.games }) })),
            FIT.augments,
          )
        : new Map<number, number>();
      return p.augments.map((a) => {
        out.augments[a.id] = [a.name, a.rarity];
        const lead = real.get(a.id);
        const lift = lead === undefined ? est?.augments.get(a.id)?.lift : undefined;
        // No estimate: fall back to DeepScore around its middle (50), scaled to about the same size as a boost.
        const score = lead ?? lift ?? ((scores.get(a.id) ?? 50) - 50) / 1000;
        const g = use(a);
        const se = lead !== undefined && g && g.games > 0 ? Math.round(Math.sqrt((g.winRate * (1 - g.winRate)) / g.games) * 10000) / 100 : -1;
        return [a.id, r4(score), deep.get(a.id) ?? -1, lift === undefined ? 0 : 1, se, r4(a.pickRate)] as [number, number, number, number, number, number];
      });
    };
    const rows = rank(false);
    // Only where pooling changed something, so the app shows the switch only when the two differ (like the page).
    if (p.augments.some((a) => a.pooled)) {
      const only = rank(true).sort((x, y) => y[1] - x[1]);
      const pooled = [...rows].sort((x, y) => y[1] - x[1]);
      if (only.some((r, i) => r[0] !== pooled[i][0] || r[2] !== pooled[i][2])) out.only[alias] = only;
    }
    out.champions[alias] = rows.sort((x, y) => y[1] - x[1]);
    const usual = arch[String(ids0[alias])] ?? [];
    const rare = usual.length ? (niche[String(ids0[alias])] ?? []).filter((n) => !usual.some((a) => a.style === n.style)) : [];
    if (usual.length + rare.length > 1)
      out.builds[alias] = [
        ...usual.map((b): [string, number, number[], number[], number[]] => [b.style, r4(b.share), b.boots ?? [], b.core ?? [], b.later ?? []]),
        ...rare.map((b): [string, number, number[], number[], number[], number[]] => [b.style, r4(b.share), b.boots ?? [], b.core ?? [], b.later ?? [], b.triggers ?? []]),
      ];
    out.pairs[alias] = augmentSynergy(
      alias,
      rows.map((r) => r[0]),
    ).map((s) => [s.a, s.b, r4(s.order ? Math.max(...s.order) : s.points)]);
  }
  return out;
}
