import "server-only";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import { readRepoJson } from "./repo-data";
import { champName } from "./highlights";
import { augmentHref } from "./augments";
import { item } from "./items";
import { itemPages } from "./item-pages";
import { augmentItems } from "./estimates";

// Synergies (data/estimates/synergies.json, rebuilt daily by data/estimates/synergies.py; method in its docstring):
// how well each augment, item, full build and augment combo fits a champion, and each champion and combo fits an
// augment. Every score is in win rate points over the champion's usual choice and leans on the estimate when a choice
// has few games ("expected"). Choices that fail a check (not sold, an augment-only item, out of the augment pool, the
// bug finder's Traps) are left out. Augments get a score only, never a win rate (Riot's developer policy).

type Kind = "expected";
type ItemRaw = {
  items: number[];
  pick_rate: number;
  games: number;
  lift: number;
  expected: number;
  kind?: Kind;
  sim?: string;
  flag?: string;
  caution?: string[];
};
type AugRaw = { id: number; pick_rate: number; games: number; score: number; kind?: Kind; sim?: string; flag?: string; caution?: string[] };
type ComboRaw = { ids: [number, number]; pick_rate: number; games: number; score: number; flag?: string; caution?: string[] };
type Family = "starting" | "boots" | "full_builds";
type Raw = {
  few_games?: number;
  champions?: Record<string, Partial<Record<Family, ItemRaw[]>> & { augments?: AugRaw[]; combos?: ComboRaw[] }>;
};

const IDS = championIds as Record<string, number>;
const ALIAS = Object.fromEntries(Object.entries(IDS).map(([alias, id]) => [id, alias])) as Record<number, string>;
const NAMES = augmentNames as Record<string, string>;
const data = () => readRepoJson<Raw>("data/estimates/synergies.json");

export type SynIcon = { src: string; round?: boolean };
export type SynName = { kind: "champions" | "items" | "augments"; id: string | number; name: string };
/** One row of a Synergies list, ready for the client table (components/Synergies.tsx). */
export type SynRow = {
  key: string;
  icons: SynIcon[];
  names: SynName[];
  href?: string;
  /** Win rate points over the champion's usual choice (a share: 0.02 is 2 pts). Absent on share-only lists. */
  score?: number;
  /** Share of the champion's games (or, on share lists, of the augment's champions) with it. */
  pick: number;
  games?: number;
  /** The score leans on the estimate (few games of its own). */
  expected?: boolean;
  /** Starter or Boots, on the champion page's Items list. */
  slot?: "Starter" | "Boots";
  sim?: "agrees" | "disagrees";
  caution?: boolean;
};
export type SynTab = { id: string; label: string; what: string; rows: SynRow[]; note: string; share?: boolean };

const augIcon = (id: number): SynIcon => ({ src: `/icons/augments/${id}.webp`, round: true });
const augName = (id: number): SynName => ({ kind: "augments", id, name: NAMES[String(id)] ?? "" });
const keep = (r: { flag?: string }) => !r.flag;
const sim = (s?: string) => (s === "agrees" || s === "disagrees" ? s : undefined);

let slugs: Map<number, string> | null = null;
const itemHref = (id: number) => {
  slugs ??= new Map(itemPages().map((i) => [i.id, i.slug]));
  const s = slugs.get(id);
  return s ? `/items/${s}` : undefined;
};

function itemRow(r: ItemRaw, slot?: SynRow["slot"]): SynRow | null {
  const its = r.items.map((id) => ({ id, it: item(id) }));
  if (its.some((x) => !x.it?.icon)) return null;
  return {
    key: `${slot ?? "b"}-${r.items.join("-")}`,
    icons: its.map((x) => ({ src: x.it!.icon! })),
    names: its.map((x) => ({ kind: "items", id: x.id, name: x.it!.name })),
    href: r.items.length === 1 ? itemHref(r.items[0]) : undefined,
    score: r.expected,
    pick: r.pick_rate,
    games: r.games,
    expected: r.kind === "expected" || undefined,
    slot,
    sim: sim(r.sim),
    caution: r.caution?.length ? true : undefined,
  };
}

export const fewGames = () => data()?.few_games ?? 1000;

/** A champion's Synergies tabs: augments, items (starter and boots), full builds and augment combos. */
export function championSynergies(id: number): SynTab[] {
  const c = data()?.champions?.[String(id)];
  if (!c) return [];
  const augs: SynRow[] = (c.augments ?? []).filter(keep).map((a) => ({
    key: `a-${a.id}`,
    icons: [augIcon(a.id)],
    names: [augName(a.id)],
    href: augmentHref(a.id) ?? undefined,
    score: a.score,
    pick: a.pick_rate,
    games: a.games,
    expected: a.kind === "expected" || undefined,
    sim: sim(a.sim),
    caution: a.caution?.length ? true : undefined,
  }));
  const items = [
    ...(c.starting ?? []).filter(keep).map((r) => itemRow(r, "Starter")),
    ...(c.boots ?? []).filter(keep).map((r) => itemRow(r, "Boots")),
  ].filter((r): r is SynRow => !!r);
  const builds = (c.full_builds ?? [])
    .filter(keep)
    .map((r) => itemRow(r))
    .filter((r): r is SynRow => !!r);
  const combos: SynRow[] = (c.combos ?? []).filter(keep).map((p) => ({
    key: `c-${p.ids.join("-")}`,
    icons: p.ids.map(augIcon),
    names: p.ids.map(augName),
    score: p.score,
    pick: p.pick_rate,
    games: p.games,
    expected: true,
    caution: p.caution?.length ? true : undefined,
  }));
  const tabs: SynTab[] = [
    { id: "augments", label: "Augments", what: "Augment", rows: augs, note: "Points of win rate each augment adds on this champion, estimated." },
    { id: "items", label: "Items", what: "Item", rows: items, note: "Points of win rate over this champion's usual starter items or boots." },
    { id: "builds", label: "Full builds", what: "Six items", rows: builds, note: "Points of win rate over this champion's usual full builds." },
    {
      id: "combos",
      label: "Augment combos",
      what: "Augment pair",
      rows: combos,
      note: "Estimated from each augment's own score: no games record the pair together.",
    },
  ];
  return tabs.filter((t) => t.rows.length);
}

/** An augment's Synergies tabs: the champions it fits, the augments it pairs with, and the items built with it. */
export function augmentSynergies(id: number): SynTab[] {
  const champs = data()?.champions ?? {};
  const fits: SynRow[] = [];
  const partners = new Map<number, { w: number; s: number; champs: number; pick: number; games: number; caution: boolean }>();
  for (const [cid, c] of Object.entries(champs)) {
    const alias = ALIAS[Number(cid)];
    if (!alias) continue;
    const a = c.augments?.find((x) => x.id === id);
    if (a && keep(a))
      fits.push({
        key: `ch-${cid}`,
        icons: [{ src: `/icons/champions/${alias}.webp` }],
        names: [{ kind: "champions", id: alias, name: champName(alias) }],
        href: `/champions/${alias}`,
        score: a.score,
        pick: a.pick_rate,
        games: a.games,
        expected: a.kind === "expected" || undefined,
        sim: sim(a.sim),
        caution: a.caution?.length ? true : undefined,
      });
    for (const p of c.combos ?? []) {
      if (!keep(p) || !p.ids.includes(id)) continue;
      const other = p.ids[0] === id ? p.ids[1] : p.ids[0];
      const e = partners.get(other) ?? { w: 0, s: 0, champs: 0, pick: 0, games: 0, caution: false };
      e.w += p.games;
      e.s += p.score * p.games;
      e.champs += 1;
      e.pick += p.pick_rate;
      e.games += p.games;
      e.caution ||= !!p.caution?.length;
      partners.set(other, e);
    }
  }
  // A partner needs the pair on at least two champions so one champion can't carry it.
  const combos: SynRow[] = [...partners]
    .filter(([, e]) => e.champs >= 2 && e.w > 0)
    .map(([other, e]) => ({
      key: `p-${other}`,
      icons: [augIcon(id), augIcon(other)],
      names: [augName(id), augName(other)],
      href: augmentHref(other) ?? undefined,
      score: e.s / e.w,
      // The pair's average pick rate on those champions.
      pick: e.pick / e.champs,
      games: e.games,
      expected: true,
      caution: e.caution || undefined,
    }));
  const items: SynRow[] = augmentItems(id).flatMap((f) => {
    const it = item(f.id);
    if (!it?.icon) return [];
    return [{ key: `i-${f.id}`, icons: [{ src: it.icon }], names: [{ kind: "items" as const, id: f.id, name: it.name }], href: itemHref(f.id), pick: f.share }];
  });
  const tabs: SynTab[] = [
    { id: "champions", label: "Champions", what: "Champion", rows: fits, note: "Points of win rate this augment adds on each champion, estimated." },
    {
      id: "combos",
      label: "Augment combos",
      what: "Augment pair",
      rows: combos,
      note: "Estimated across the champions that often take both: no games record the pair together.",
    },
    { id: "items", label: "Items", what: "Item", rows: items, note: "Share of the champions who take this augment that build each item.", share: true },
  ];
  return tabs.filter((t) => t.rows.length);
}

/** Expected win rate for a build panel row (the champion page's Expected switch), keyed by family and items. */
export function expectedBuilds(id: number): Map<string, { delta: number; expected: boolean }> {
  const c = data()?.champions?.[String(id)];
  const out = new Map<string, { delta: number; expected: boolean }>();
  for (const fam of ["starting", "boots", "full_builds"] as Family[])
    for (const r of c?.[fam] ?? [])
      out.set(expectedKey(fam, r.items), { delta: r.expected - r.lift, expected: r.kind === "expected" });
  return out;
}
export const expectedKey = (fam: Family, items: number[]) => `${fam}:${[...items].sort((a, b) => a - b).join(",")}`;
