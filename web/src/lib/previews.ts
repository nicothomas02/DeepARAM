import "server-only";
import { augmentPages } from "./augments";
import { SHOW_AUGMENT_WIN_RATES } from "./augment-policy";
import { liveTiers } from "./highlights";
import { itemPages } from "./item-pages";
import descriptions from "@/data/descriptions.json";
import augmentNames from "@/data/augment-names.json";

const DESC = descriptions as { items: Record<string, string>; augments: Record<string, string> };
const AUG_NAMES = augmentNames as Record<string, string>;

// The small cards shown when hovering a link to a champion, augment or item page (HoverPreview),
// keyed by the link's path. Live patch only. Item and augment cards also carry the official description and are keyed
// by their icon too ("icon:<src>"), so hovering any item or augment icon on the site shows them, link or not
// (Nico 2026-11-25: "allow hovering mouse over items and augments to show their description").

export type Preview = {
  name: string;
  icon?: string;
  kind: "champion" | "augment" | "item";
  /** Champion tier letter or augment rarity. */
  tier?: string;
  winRate?: number;
  pickRate?: number;
  lines?: string[];
  /** Item or augment id, for the name and description in the page's language (components/I18n.tsx). */
  id?: string;
  /** The official description in English, §Name§ marking a passive's or active's name. */
  desc?: string;
};

export function previews(): Record<string, Preview> {
  const out: Record<string, Preview> = {};
  for (const c of liveTiers()) {
    out[`/champions/${c.id}`] = { kind: "champion", name: c.name, icon: `/icons/champions/${c.id}.webp`, tier: c.tier, winRate: c.winRate, pickRate: c.pickRate };
  }
  const seen = new Set<string>();
  for (const a of augmentPages()) {
    seen.add(String(a.id));
    out[`icon:/icons/augments/${a.id}.webp`] = out[`/augments/${a.slug}`] = {
      kind: "augment",
      name: a.name,
      icon: `/icons/augments/${a.id}.webp`,
      tier: a.tier,
      ...(SHOW_AUGMENT_WIN_RATES ? { winRate: a.winRate } : {}),
      pickRate: a.pickRate,
      lines: a.best.length ? [`Best on ${a.best.slice(0, 3).map((b) => b.name).join(", ")}`] : [],
      id: String(a.id),
      desc: DESC.augments[String(a.id)],
    };
  }
  // Augments with a description but no page of their own (too few games): their icon still shows name and description.
  for (const [id, desc] of Object.entries(DESC.augments)) {
    if (seen.has(id) || !AUG_NAMES[id]) continue;
    out[`icon:/icons/augments/${id}.webp`] = { kind: "augment", name: AUG_NAMES[id], icon: `/icons/augments/${id}.webp`, id, desc };
  }
  for (const i of itemPages()) {
    const card: Preview = (out[`/items/${i.slug}`] = {
      kind: "item",
      name: i.name,
      icon: i.icon,
      lines: [...(i.cost ? [`${i.cost.toLocaleString("en-US")} gold`] : []), ...i.stats.slice(0, 4), ...(i.builders.length ? [`Built most by ${i.builders.slice(0, 3).map((b) => b.name).join(", ")}`] : [])],
      id: String(i.id),
      desc: DESC.items[String(i.id)],
    });
    if (i.icon) out[`icon:${i.icon}`] = card;
  }
  return out;
}
