import "server-only";
import { itemPages } from "./item-pages";
import { readRepoJson } from "./repo-data";

// Builds for a chosen augment (or pair) on a champion page, from data/estimates/augment_builds.py: the Simulator's
// best five items plus boots with the augment taken, next to its best items with no augment. A build "changes" when
// two or more of its items differ from the no-augment one, which marks the augment as build-changing.

type Raw = {
  champions: Record<
    string,
    {
      base: { items: string[] };
      builds: { augments: string[]; items: string[]; changed: number }[];
    }
  >;
};

export type BuildItem = { id: number; name: string; icon: string; slug: string };
export type AugmentBuild = {
  /** Augment ids, one or two. */
  augments: number[];
  /** Item ids, looked up in AugmentBuilds.items (each item's details are sent once per page). */
  items: number[];
  /** How many of the items differ from the no-augment build. */
  changed: number;
};
export type AugmentBuilds = { items: Record<number, Omit<BuildItem, "id">>; base: number[]; builds: AugmentBuild[] };

/** At least this many different items make an augment "build-changing" on a champion. */
export const CHANGES_BUILD = 2;

let keys: { items: Record<string, number>; augments: Record<string, number> } | null = null;
function simKeys() {
  if (keys) return keys;
  const it = readRepoJson<{ items: Record<string, { id: number }> }>("simulator/data/items.json")?.items ?? {};
  const au = readRepoJson<{ augments: Record<string, { id: number }> | { id: number; key?: string }[] }>("simulator/data/augments.json")?.augments ?? {};
  const augs: Record<string, number> = {};
  for (const [k, v] of Object.entries(au)) if (v && typeof v === "object" && "id" in v) augs[(v as { key?: string }).key ?? k] = v.id;
  keys = { items: Object.fromEntries(Object.entries(it).map(([k, v]) => [k, v.id])), augments: augs };
  return keys;
}

export function augmentBuilds(alias: string): AugmentBuilds | null {
  const c = readRepoJson<Raw>("data/estimates/augment_builds.json")?.champions[alias];
  if (!c) return null;
  const k = simKeys();
  const pages = new Map(itemPages().map((p) => [p.id, p]));
  const info: AugmentBuilds["items"] = {};
  const items = (list: string[]) =>
    list.flatMap((key) => {
      const p = pages.get(k.items[key]);
      if (!p?.icon) return [];
      info[p.id] = { name: p.name, icon: p.icon, slug: p.slug };
      return [p.id];
    });
  const builds = c.builds.flatMap((b) => {
    const ids = b.augments.map((a) => k.augments[a]);
    return ids.every((x) => x !== undefined) ? [{ augments: ids, items: items(b.items), changed: b.changed }] : [];
  });
  return builds.length ? { items: info, base: items(c.base.items), builds } : null;
}

/** Augment ids that change this champion's build (for the augment list's "Changes your build" mark). */
export function buildChangers(alias: string): Set<number> {
  return new Set(
    (augmentBuilds(alias)?.builds ?? []).filter((b) => b.augments.length === 1 && b.changed >= CHANGES_BUILD).map((b) => b.augments[0]),
  );
}
