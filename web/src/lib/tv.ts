// Everything the Apple TV app shows, in one file: live tiers and quick builds per champion, the augment
// tier list, the Chef's Special and the PBE changes. Served at /data/tv.json, built once per deploy.
// Shape is decoded by apps/tvos/DeepARAMTVKit/Sources/DeepARAMTVKit/TVData.swift.
import augmentNames from "@/data/augment-names.json";
import { augmentTiers } from "@/lib/augment-tiers";
import { chefsSpecial, liveTiers, livePatch } from "@/lib/highlights";
import { patchName } from "@/lib/patch-name";
import { readRepoJson } from "@/lib/repo-data";
import { whatToBuildData } from "@/lib/what-to-build";

type Icon = { name: string; icon: string | null };
type Rarity = "prismatic" | "gold" | "silver";
const RARITIES: Rarity[] = ["prismatic", "gold", "silver"];

type Change = { stat: string; live: string; pbe: string };
type Pbe = {
  meta: { label: string; dataAsOf: string; caveat: string; augmentPool: { live: number; pbe: number } };
  augments: {
    added: { name: string | null; tier: string; description: string | null; icon?: string }[];
    removed: { name: string; tier: string; icon?: string }[];
    changed: { name: string; tier?: string; direction?: string; changes: Change[]; icon?: string }[];
  };
  championChanges: { list: { champion: string; changes: string[] }[] };
  itemChanges: { list: { item: string; changes: string[] }[] };
  modeChanges: string[];
};

const champIcon = (id: string) => `/icons/champions/${id}.webp`;
const augIcon = (id: number | string) => `/icons/augments/${id}.webp`;
const AUG_ID = Object.fromEntries(Object.entries(augmentNames as Record<string, string>).map(([id, name]) => [name, id]));

export function tvData() {
  const data = whatToBuildData();
  const tiers = new Map(liveTiers().map((t) => [t.id, t]));
  const item = (id: number): Icon => ({ name: data.items[id][0], icon: data.items[id][1] || null });

  const champions = data.champions.map((c) => {
    const build = c.best ?? c.popular;
    const items = [...(c.boots?.items ?? []), ...(build?.items ?? [])].filter((id, i, all) => all.indexOf(id) === i && data.items[id]).map(item);
    const augments = Object.fromEntries(
      RARITIES.map((r) => [r, (c.augs[r] ?? []).filter((a) => data.augs[a]).map((a) => ({ name: data.augs[a], icon: augIcon(a) }))]),
    ) as Record<Rarity, Icon[]>;
    const t = tiers.get(c.id);
    return {
      id: c.id,
      name: c.name,
      icon: champIcon(c.id),
      tier: t?.tier ?? null,
      winRate: t?.winRate ?? null,
      pickRate: t?.pickRate ?? null,
      skills: c.skills,
      items,
      augments,
    };
  });

  const augments = augmentTiers().map((a) => ({
    name: a.name,
    icon: augIcon(a.id),
    rarity: a.rarity,
    tier: a.tier,
    winRate: a.winRate,
    pickRate: a.pickRate,
  }));

  const s = chefsSpecial();
  const special = s && {
    title: s.title,
    date: s.date,
    champion: s.champion,
    name: s.name,
    icon: champIcon(s.champion),
    why: s.why,
    play: s.play || null,
    items: s.items.map((i) => ({ name: i.name, icon: i.icon ?? null })),
    augments: s.augments.map((a) => ({ name: a.name, rarity: a.rarity, core: a.core, icon: AUG_ID[a.name] ? augIcon(AUG_ID[a.name]) : (a.icon ?? null) })),
  };

  const p = readRepoJson<Pbe>("data/pbe/kiwi-s3.json");
  const pbe = p && {
    label: p.meta.label,
    dataAsOf: p.meta.dataAsOf,
    caveat: p.meta.caveat,
    augmentPool: p.meta.augmentPool,
    augments: {
      added: p.augments.added.filter((a) => a.name).map((a) => ({ name: a.name!, rarity: a.tier, description: a.description, icon: a.icon ?? null })),
      removed: p.augments.removed.map((a) => ({ name: a.name, rarity: a.tier, icon: a.icon ?? null })),
      changed: p.augments.changed.map((a) => ({ name: a.name, rarity: a.tier ?? null, direction: a.direction ?? null, changes: a.changes, icon: a.icon ?? null })),
    },
    championChanges: p.championChanges.list,
    itemChanges: p.itemChanges.list,
    modeChanges: p.modeChanges,
  };

  return { patch: patchName(livePatch()), champions, augments, chefsSpecial: special, pbe };
}
