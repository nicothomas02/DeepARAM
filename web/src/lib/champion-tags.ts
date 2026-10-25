import "server-only";
import { readRepoJson } from "./repo-data";
import type { TagInfo } from "./tag-info";

// Each champion's archetype tags: Riot's official class and subclass (Mage, Burst), then playstyle tags
// (Riot's official two per champion: Initiator, Burst, Ally Protection…), each with a colour and a one-line meaning,
// plus Riot's 1–3 playstyle ratings.
// Data: champions/tags.json.

type Tags = {
  colors: Record<string, string>;
  meanings: Record<string, string>;
  classes: Record<string, string[]>;
  champions: Record<string, { roles: string[]; classes: string[]; subclasses: string[]; playstyles: string[]; ratings?: Ratings }>;
};

/** Riot's 1–3 playstyle ratings from the client's champion details screen. */
export type Ratings = { damage: number; toughness: number; control: number; mobility: number; utility: number };

// Champions too new for a Riot class fall back to their game roles, named as the class they match.
const ROLE_CLASS: Record<string, string> = { Assassin: "Slayer", Support: "Controller" };

let cache: { tags: Record<string, string[]>; info: TagInfo; ratings: Record<string, Ratings> } | null = null;

export function championTagData() {
  if (cache) return cache;
  const d = readRepoJson<Tags>("champions/tags.json");
  if (!d) return (cache = { tags: {}, info: {}, ratings: {} });
  const classes = new Set(Object.keys(d.classes));
  const info: TagInfo = {};
  for (const [name, color] of Object.entries(d.colors)) {
    if (name === "Support") continue;
    const kind = classes.has(name) ? "class" : Object.values(d.classes).some((s) => s.includes(name)) ? "sub" : "play";
    info[name] = { color, meaning: d.meanings[name] ?? classMeaning(name, d.classes[name] ?? []), kind };
  }
  const tags: Record<string, string[]> = {};
  const ratings: Record<string, Ratings> = {};
  for (const [alias, c] of Object.entries(d.champions)) {
    if (c.ratings) ratings[alias] = c.ratings;
    const base = c.classes.length ? c.classes : c.roles.map((r) => ROLE_CLASS[r] ?? r);
    // A subclass named like its class (Marksman) shows once.
    tags[alias] = [...new Set([...base, ...c.subclasses, ...c.playstyles])].filter((t) => info[t]);
  }
  return (cache = { tags, info, ratings });
}

const classMeaning = (name: string, subs: string[]) =>
  subs.length > 1 || subs[0] !== name ? `Riot's ${name} class: ${subs.join(", ")}.` : `Riot's ${name} class.`;

/** Tags for one champion; seasonal skins (Jade_Ahri) share the base champion's. */
export function championTags(alias: string): string[] {
  const { tags } = championTagData();
  return tags[alias] ?? tags[alias.replace(/^Jade_/, "")] ?? [];
}

/** Every champion's tags, keyed by alias, for pages that ship them to the browser. */
export function allChampionTags(aliases: string[]): Record<string, string[]> {
  return Object.fromEntries(aliases.map((a) => [a, championTags(a)]).filter(([, t]) => t.length));
}

/** A champion's official playstyle ratings, or null when the client has none for it. */
export function championRatings(alias: string): Ratings | null {
  const { ratings } = championTagData();
  return ratings[alias] ?? ratings[alias.replace(/^Jade_/, "")] ?? null;
}
