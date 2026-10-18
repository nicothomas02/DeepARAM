import "server-only";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import { champName } from "./highlights";
import { augmentRows } from "./augment-winrate";
import { readRepoJson } from "./repo-data";

// One page per augment (/augments/<slug>): live win rate (fair, lib/augment-winrate.ts) and pick rate, its rank among all augments,
// the champions it does best on, and the champions who pick it most often.

const IDS = championIds as Record<string, number>;
const ALIAS = Object.fromEntries(Object.entries(IDS).map(([alias, id]) => [id, alias]));
const NAMES = augmentNames as Record<string, string>;

export const augmentSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

type Raw = { augment_id: number; win_rate: number; pick_rate: number; win_rank?: number; pick_rank?: number; tier?: string; best_champions?: number[] };
type Builds = { augments?: { all?: { id: number; pick_rate: number }[] } };

export type AugmentPage = {
  id: number;
  slug: string;
  name: string;
  tier: string;
  winRate: number;
  pickRate: number;
  winRank: number | null;
  pickRank: number | null;
  of: number;
  best: { id: string; name: string }[];
  pickers: { id: string; name: string; pickRate: number }[];
};

let cache: AugmentPage[] | null = null;
export function augmentPages(): AugmentPage[] {
  if (cache) return cache;
  const raw = augmentRows<Raw>().filter((a) => NAMES[a.augment_id] && a.tier);
  // Who takes each augment most: every champion's augment pick rates (data/cn/builds/<id>.json).
  const pickers = new Map<number, { id: string; name: string; pickRate: number }[]>();
  for (const [alias, cid] of Object.entries(IDS)) {
    for (const a of readRepoJson<Builds>(`data/cn/builds/${cid}.json`)?.augments?.all ?? []) {
      pickers.set(a.id, [...(pickers.get(a.id) ?? []), { id: alias, name: champName(alias), pickRate: a.pick_rate }]);
    }
  }
  cache = raw.map((a) => ({
    id: a.augment_id,
    slug: augmentSlug(NAMES[a.augment_id]),
    name: NAMES[a.augment_id],
    tier: String(a.tier).toLowerCase(),
    winRate: a.win_rate,
    pickRate: a.pick_rate,
    winRank: a.win_rank ?? null,
    pickRank: a.pick_rank ?? null,
    of: raw.length,
    best: (a.best_champions ?? []).map((id) => ALIAS[id]).filter(Boolean).slice(0, 6).map((id) => ({ id, name: champName(id) })),
    pickers: (pickers.get(a.augment_id) ?? []).sort((x, y) => y.pickRate - x.pickRate).slice(0, 8),
  }));
  return cache;
}

export const augmentBySlug = (slug: string) => augmentPages().find((a) => a.slug === slug) ?? null;
// Only augments in today's pool have a page; a removed one (an old patch recap) gets no link.
let withPage: Set<string> | null = null;
export const augmentHref = (id: number | string) => {
  withPage ??= new Set(augmentRows<Raw>().flatMap((a) => (NAMES[a.augment_id] && a.tier ? [String(a.augment_id)] : [])));
  const name = NAMES[String(id)];
  return name && withPage.has(String(id)) ? `/augments/${augmentSlug(name)}` : null;
};
