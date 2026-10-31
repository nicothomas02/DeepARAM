import "server-only";
import augmentNames from "@/data/augment-names.json";
import championNames from "@/data/champion-names.json";
import type { SearchItem } from "@/components/SearchPalette";
import languages from "@/i18n/languages.json";
import { augmentHref } from "./augments";
import { foldName } from "./fold";
import { augmentTiers } from "./augment-tiers";
import { itemPages } from "./item-pages";
import { readRepoCsv, readRepoJson } from "./repo-data";
import { navPages } from "./tabs";
import { champStats, type PatchRow } from "./tiers";

// Small summaries of each section's data, read from the repo at build time.
// Used by the home page highlights and the header search.

const CHAMPS = championNames as Record<string, string>;
const AUGS = augmentNames as Record<string, string>;

// Aliases differ in case between data files (FiddleSticks / Fiddlesticks), so fall back to a case-blind match.
const CHAMPS_LOWER = new Map(Object.entries(CHAMPS).map(([k, v]) => [k.toLowerCase(), v]));
export const champName = (id: string) => CHAMPS[id] ?? CHAMPS_LOWER.get(id.toLowerCase()) ?? id.replace(/([a-z])([A-Z])/g, "$1 $2");

export type Ranked = { id: string; name: string; winRate: number; pickRate: number; tier?: string };

export function topChampions(n = 6): Ranked[] {
  const rows = readRepoCsv("data/cn/champions.csv") ?? [];
  return rows
    .map((r) => ({ id: r.name, name: champName(r.name), winRate: Number(r.win_rate), pickRate: Number(r.pick_rate) }))
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, n);
}

/** The best augments by DeepScore, the same score and order as the Tier List's Augments tab. */
export function topAugments(n = 6) {
  return [...augmentTiers()].sort((a, b) => b.deepScore - a.deepScore).slice(0, n);
}

/** The best legendary items by DeepScore (item scores compare within a tier, so legendaries are ranked together). */
export function topItems(n = 6) {
  return itemPages()
    .filter((i) => i.tier === "legendary" && i.deepScore !== null)
    .sort((a, b) => (b.deepScore ?? 0) - (a.deepScore ?? 0))
    .slice(0, n);
}

export function statsDate() {
  const meta = readRepoJson<{ meta: { champion_stat_date?: string } }>("data/cn/champions.json")?.meta;
  const d = meta?.champion_stat_date;
  return d && d.length === 8 ? new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T00:00:00Z`) : null;
}

/** The live patch the current stats cover, like "16.20". PBE data stays on the PBE tab. */
export const livePatch = () => readRepoCsv("data/cn/history/patches.csv")?.at(-1)?.patch ?? null;

type Builds = { builds: { champion: string; title: string; augments: string[]; why: string }[] };

type DummyDps = { champions: { champion: string; dps: number }[] };
/** Damage per second of each champion's simulated best build on a training dummy with the average enemy's
 *  max Health and resists, held at 50% Health (so missing-Health damage counts the same for everyone). */
export function topDps(n = 5) {
  const dummy = readRepoJson<DummyDps>("simulator/viewer/replay-data/dummy-dps.json");
  return (dummy?.champions ?? [])
    .map((c) => ({ id: c.champion, name: champName(c.champion), dps: c.dps }))
    .sort((a, b) => b.dps - a.dps)
    .slice(0, n);
}

export function counts() {
  return {
    champions: readRepoCsv("data/cn/champions.csv")?.length ?? 0,
    augments: (readRepoCsv("data/cn/augments.csv") ?? []).filter((r) => r.tier).length,
  };
}

export const searchPages = (): SearchItem[] => [
  { group: "Pages", name: "Home", hint: "Page", href: "/" },
  ...[...navPages(), { href: "/account#my-stats", label: "My Stats" }].map((t) => ({ group: "Pages", name: t.label, hint: "Page", href: t.href })),
];

// Every champion's name in each site language, folded, so search finds a champion typed in any language
// (阿狸 or Ари on the English site). Only names that differ from the English one are kept.
function championNamesEverywhere(): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const { code } of languages) {
    if (code === "en") continue;
    const d = readRepoJson<{ champions?: Record<string, string> }>(`web/public/i18n/names/${code}.json`);
    for (const [alias, name] of Object.entries(d?.champions ?? {})) (out[alias] ??= new Set()).add(foldName(name));
  }
  return Object.fromEntries(
    Object.entries(out).map(([alias, set]) => {
      set.delete(foldName(champName(alias)));
      return [alias, [...set]];
    }),
  );
}

export function searchItems(): SearchItem[] {
  const pct = (v: number) => `${(v * 100).toFixed(1)}% win`;
  const everywhere = championNamesEverywhere();
  const pages = searchPages();
  const champs = (readRepoCsv("data/cn/champions.csv") ?? []).map((r) => ({
    group: "Champions",
    name: champName(r.name),
    hint: pct(Number(r.win_rate)),
    href: `/champions/${r.name}`,
    icon: `/icons/champions/${r.name}.webp`,
    ref: ["champions", r.name] as SearchItem["ref"],
    alt: everywhere[r.name]?.length ? everywhere[r.name] : undefined,
  }));
  const augs = (readRepoCsv("data/cn/augments.csv") ?? [])
    .filter((r) => AUGS[r.augment_id])
    .map((r) => ({
      group: "Augments",
      name: AUGS[r.augment_id],
      hint: r.tier || "Augment",
      href: augmentHref(r.augment_id) ?? `/tier-list?tab=augments&q=${encodeURIComponent(AUGS[r.augment_id])}`,
      icon: `/icons/augments/${r.augment_id}.webp`,
      ref: ["augments", r.augment_id] as SearchItem["ref"],
    }));
  const builtItems = itemPages().map((i) => ({ group: "Items", name: i.name, hint: i.cost ? `${i.cost} gold` : "Item", href: `/items/${i.slug}`, icon: i.icon, ref: ["items", String(i.id)] as SearchItem["ref"] }));
  return [
    ...pages,
    ...champs.sort((a, b) => a.name.localeCompare(b.name)),
    ...augs.sort((a, b) => a.name.localeCompare(b.name)),
    ...builtItems,
  ];
}

export type HomeChamp = { id: string; name: string; tier: string; winRate: number; pickRate: number; deepScore: number };

/** Live-patch tiers for every champion (same DeepScore tiers as the Tier List's default view). */
export function liveTiers(): HomeChamp[] {
  const patch = livePatch();
  const num = (v?: string) => (v === undefined || v === "" ? null : Number(v));
  const rows: PatchRow[] = (readRepoCsv("data/cn/history/by_patch.csv") ?? [])
    .filter((r) => r.patch === patch)
    .map((r) => ({
      patch: r.patch,
      days: Number(r.days),
      name: r.name,
      win_rate: Number(r.win_rate),
      pick_rate: Number(r.pick_rate),
      damage: num(r.avg_damage_ratio),
      tank: num(r.avg_tank_ratio),
      kp: num(r.avg_participation_rate),
      dead: num(r.avg_death_time),
      augs: r.augment_ids ?? "",
    }));
  if (!patch || !rows.length) return [];
  return champStats(rows, new Set([patch])).map((c) => ({ id: c.name, name: champName(c.name), tier: c.tier, winRate: c.win_rate, pickRate: c.pick_rate, deepScore: c.deepScore }));
}

export const kitchenBuilds = () => readRepoJson<Builds>("data/cook-builds/builds.json")?.builds ?? [];

// The Lab's Chef's Special: one unusual build a day (data/cook-builds/chefs-special.json, null on days without one).
type RawSpecial = {
  id?: string;
  title: string;
  chef?: string;
  champion: string;
  champion_name: string;
  tier?: string;
  core_win_rate?: number;
  champion_win_rate?: number;
  why: string;
  play?: string;
  items?: string[];
  augments?: { name: string; rarity: string; core: boolean; win_rate?: number; icon?: string }[];
  href?: string;
};
export function chefsSpecial() {
  const s = readRepoJson<RawSpecial | null>("data/cook-builds/chefs-special.json");
  if (!s?.title || !s.champion) return null;
  const pages = new Map(itemPages().map((i) => [i.name, i]));
  return {
    id: s.id || `${s.chef ?? ""}-${s.champion}`,
    title: s.title,
    date: /^\d{4}-\d{2}-\d{2}$/.test(s.chef ?? "") ? s.chef! : null,
    champion: s.champion,
    name: s.champion_name || champName(s.champion),
    tier: s.tier ?? "",
    winRate: s.core_win_rate ?? null,
    champWinRate: s.champion_win_rate ?? null,
    why: s.why,
    play: s.play ?? "",
    items: (s.items ?? []).map((name) => ({ name, icon: pages.get(name)?.icon, href: pages.has(name) ? `/items/${pages.get(name)!.slug}` : null })),
    augments: (s.augments ?? []).map((a) => ({ name: a.name, rarity: a.rarity.toLowerCase(), core: a.core, icon: a.icon })),
    href: s.href || "/kitchen#chefs-special",
  };
}
