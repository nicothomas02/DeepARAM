import "server-only";
import { augmentPages } from "./augments";
import { SHOW_AUGMENT_WIN_RATES } from "./augment-policy";
import { liveTiers } from "./highlights";
import { itemPages } from "./item-pages";

// The small cards shown when hovering a link to a champion, augment or item page (HoverPreview),
// keyed by the link's path. Live patch only.

export type Preview = {
  name: string;
  icon?: string;
  kind: "champion" | "augment" | "item";
  /** Champion tier letter or augment rarity. */
  tier?: string;
  winRate?: number;
  pickRate?: number;
  lines?: string[];
};

export function previews(): Record<string, Preview> {
  const out: Record<string, Preview> = {};
  for (const c of liveTiers()) {
    out[`/champions/${c.id}`] = { kind: "champion", name: c.name, icon: `/icons/champions/${c.id}.webp`, tier: c.tier, winRate: c.winRate, pickRate: c.pickRate };
  }
  for (const a of augmentPages()) {
    out[`/augments/${a.slug}`] = {
      kind: "augment",
      name: a.name,
      icon: `/icons/augments/${a.id}.webp`,
      tier: a.tier,
      ...(SHOW_AUGMENT_WIN_RATES ? { winRate: a.winRate } : {}),
      pickRate: a.pickRate,
      lines: a.best.length ? [`Best on ${a.best.slice(0, 3).map((b) => b.name).join(", ")}`] : [],
    };
  }
  for (const i of itemPages()) {
    out[`/items/${i.slug}`] = {
      kind: "item",
      name: i.name,
      icon: i.icon,
      lines: [...(i.cost ? [`${i.cost.toLocaleString("en-US")} gold`] : []), ...i.stats.slice(0, 4), ...(i.builders.length ? [`Built most by ${i.builders.slice(0, 3).map((b) => b.name).join(", ")}`] : [])],
    };
  }
  return out;
}
