import "server-only";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import { augmentHref } from "./augments";
import { items } from "./items";
import { itemPages } from "./item-pages";
import { patchName } from "./patch-name";
import { readRepoJson } from "./repo-data";

// Hidden gems tab (/tier-list?tab=hidden-gems): choices fewer than 2% of a champion's players make that still win
// clearly more than the champion's usual ones. data/estimates/synergies.py finds them: each choice's lift over the
// champion's other options for the same slot, turned into a next-patch forecast whose 90% range is calibrated on
// how much of a rare choice's lift really carried over from one patch to the next. Only choices whose whole range
// sits above zero are listed. Augments are listed without win rates: the feed's per-champion grade and an
// estimated order only.

type ItemGem = {
  champion: number;
  items: number[];
  pick_rate: number;
  win_rate: number;
  baseline: number;
  lift: number;
  lift_lo: number;
  lift_hi: number;
  forecast: number;
  forecast_lo: number;
  forecast_hi: number;
  games: number;
};
type AugmentGem = { champion: number; id: number; pick_rate: number; grade: string; games: number; rank: number };
type FamilyCheck = {
  checked: number;
  forecast_90_coverage: number;
  sample_only_95_coverage: number;
  gems_checked: number;
  gems_still_ahead: number | null;
  every_rare_still_ahead: number | null;
};
type Data = {
  patch: string;
  max_pick: number;
  stale: string[];
  calibrated_on: string[] | null;
  items: Record<string, ItemGem[]>;
  augments: AugmentGem[];
  backtest: Record<string, FamilyCheck> | null;
};

export const GEM_FAMILIES = ["starting", "boots", "core", "other", "full_builds"] as const;
export type GemFamily = (typeof GEM_FAMILIES)[number];

export type GemItem = { id: number; name: string; icon: string; href: string | null };
export type ItemGemRow = {
  champion: string;
  items: GemItem[];
  pickRate: number;
  winRate: number;
  /** This patch: win rate minus the champion's usual for that slot, and its 95% range from sample size alone. */
  lift: number;
  liftLo: number;
  liftHi: number;
  /** Next patch: expected lift and its 90% range. */
  forecast: number;
  forecastLo: number;
  forecastHi: number;
  games: number;
};
export type AugmentGemRow = { champion: string; id: number; name: string; href: string | null; grade: string; pickRate: number; rank: number };
export type GemCheck = { family: GemFamily; checked: number; coverage: number; naive: number; flagged: number; stillAhead: number | null; everyRare: number | null };
export type HiddenGems = {
  patch: string;
  maxPick: number;
  items: Partial<Record<GemFamily, ItemGemRow[]>>;
  augments: AugmentGemRow[];
  checks: GemCheck[];
  checkedOn: string[] | null;
};

let cache: HiddenGems | null | undefined;

export function hiddenGems(): HiddenGems | null {
  if (cache !== undefined) return cache;
  const data = readRepoJson<Data>("data/estimates/synergies.json");
  if (!data) return (cache = null);
  const alias = new Map(Object.entries(championIds as Record<string, number>).map(([a, id]) => [id, a]));
  const all = items();
  const slugs = new Map(itemPages().map((p) => [p.id, p.slug]));
  const item = (id: number): GemItem | null => {
    const it = all.get(id);
    if (!it?.icon) return null;
    const slug = slugs.get(id);
    return { id, name: it.name, icon: it.icon, href: slug ? `/items/${slug}` : null };
  };
  const out: HiddenGems = { patch: data.patch, maxPick: data.max_pick, items: {}, augments: [], checks: [], checkedOn: data.calibrated_on?.map(patchName) ?? null };
  for (const fam of GEM_FAMILIES) {
    const rows = data.items[fam];
    if (!rows?.length) continue;
    out.items[fam] = rows.flatMap((g) => {
      const champion = alias.get(g.champion);
      const set = g.items.map(item);
      if (!champion || set.some((i) => !i)) return [];
      return [
        {
          champion,
          items: set as GemItem[],
          pickRate: g.pick_rate,
          winRate: g.win_rate,
          lift: g.lift,
          liftLo: g.lift_lo,
          liftHi: g.lift_hi,
          forecast: g.forecast,
          forecastLo: g.forecast_lo,
          forecastHi: g.forecast_hi,
          games: g.games,
        },
      ];
    });
  }
  const names = augmentNames as Record<string, string>;
  out.augments = data.augments.flatMap((a) => {
    const champion = alias.get(a.champion);
    const name = names[String(a.id)];
    if (!champion || !name) return [];
    return [{ champion, id: a.id, name, href: augmentHref(a.id), grade: a.grade, pickRate: a.pick_rate, rank: a.rank }];
  });
  for (const fam of GEM_FAMILIES) {
    const b = data.backtest?.[fam];
    if (!b || !(fam in out.items)) continue;
    out.checks.push({
      family: fam,
      checked: b.checked,
      coverage: b.forecast_90_coverage,
      naive: b.sample_only_95_coverage,
      flagged: b.gems_checked,
      stillAhead: b.gems_still_ahead,
      everyRare: b.every_rare_still_ahead,
    });
  }
  return (cache = out);
}
