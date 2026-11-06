import "server-only";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import { augmentHref } from "./augments";
import { champName } from "./highlights";
import { item } from "./items";
import { itemPages } from "./item-pages";
import { readRepoJson } from "./repo-data";

// The Kitchen's Traps and Bug finder tabs (/kitchen?tab=traps, ?tab=bug-finder): builds that work on paper but
// may not in the game. data/checks/findings.py finds them; data/checks/curated.json records what happened when
// one was tried in game.

export type CheckKind = "loop" | "gap" | "sim" | "wasted";
export type CheckStatus = "trap" | "to_test" | "confirmed";

type Raw = {
  id: string;
  kind: CheckKind;
  status: CheckStatus;
  title: string;
  champions: string[];
  augments: number[];
  items: number[];
  theory: string;
  practice?: string;
  test?: string;
};
type Data = { patch: string; built: string; traps: Raw[]; bugs: Raw[] };

export type Named = { id: string; name: string; icon: string; href: string | null };
export type Finding = {
  id: string;
  kind: CheckKind;
  status: CheckStatus;
  title: string;
  champions: Named[];
  augments: Named[];
  items: Named[];
  theory: string;
  /** Traps: what happens in real games. */
  practice: string | null;
  /** Bug finder: how to try it in game. */
  test: string | null;
};
export type Checks = { patch: string; traps: Finding[]; bugs: Finding[] };

const IDS = championIds as Record<string, number>;
const ALIAS = new Map(Object.keys(IDS).map((a) => [a.toLowerCase(), a]));
const AUGMENTS = augmentNames as Record<string, string>;

function champion(id: string): Named {
  const alias = ALIAS.get(id.toLowerCase()) ?? id;
  return { id: alias, name: champName(alias), icon: `/icons/champions/${alias}.webp`, href: alias in IDS ? `/champions/${alias}` : null };
}

function augment(id: number): Named {
  return { id: String(id), name: AUGMENTS[String(id)] ?? String(id), icon: `/icons/augments/${id}.webp`, href: augmentHref(id) };
}

function anItem(id: number): Named {
  const i = item(id);
  const page = itemPages().find((p) => p.id === id);
  return { id: String(id), name: i?.name ?? String(id), icon: i?.icon ?? "", href: page ? `/items/${page.slug}` : null };
}

function shape(f: Raw): Finding {
  return {
    id: f.id,
    kind: f.kind,
    status: f.status,
    title: f.title,
    champions: f.champions.map(champion),
    augments: f.augments.map(augment),
    items: f.items.map(anItem),
    theory: f.theory,
    practice: f.practice ?? null,
    test: f.test ?? null,
  };
}

let cache: Checks | null = null;

export function checks(): Checks {
  if (cache) return cache;
  const data = readRepoJson<Data>("data/checks/findings.json");
  cache = { patch: data?.patch ?? "", traps: (data?.traps ?? []).map(shape), bugs: (data?.bugs ?? []).map(shape) };
  return cache;
}
