import "server-only";
import championIds from "@/data/champion-ids.json";
import { windowJson } from "./champion-page";
import { grade } from "./deepscore";
import { itemPages } from "./item-pages";
import { items as clientItems } from "./items";
import { readRepoJson } from "./repo-data";

// The Tier List's Weapon of Destiny and Pentakill tabs (Nico 2026-11-20: back, labelled Predicted). The game data
// doesn't record which item a Weapon of Destiny player upgraded or which ability a Pentakill player Empowered, so
// both come from data/estimates/predict_tabs.py: real picks seen since the two launched, pooled across champions of
// the same class and kept to items each champion actually builds. Nothing here uses the Simulator.

type Data = {
  patch: string;
  since: string;
  weapon_of_destiny: {
    gold_per_takedown: number;
    items: Record<string, { share: number; per_takedown: Record<string, number>; champions: number }>;
    champions: Record<string, { items: number[] }>;
  };
  pentakill: Record<string, { start: "Q" | "W" | "E"; picks: number; agree: number }>;
};

const data = () => readRepoJson<Data>("data/estimates/predicted_tabs.json");
const byKey = () => new Map(Object.entries(championIds).map(([alias, key]) => [String(key), alias]));

type ItemRef = { id: number; slug: string | null; name: string; icon: string };

function itemRefs(): (id: number) => ItemRef | null {
  const pages = new Map(itemPages().map((p) => [p.id, p]));
  const client = clientItems();
  return (id) => {
    const p = pages.get(id);
    if (p) return { id, slug: p.slug, name: p.name, icon: p.icon ?? "" };
    const c = client.get(id);
    return c?.icon ? { id, slug: null, name: c.name, icon: c.icon } : null;
  };
}

export type PredictedDestinyItem = ItemRef & {
  /** Predicted share of Weapon of Destiny picks that make it the Weapon (0-1). */
  share: number;
  /** Stat key -> amount one takedown adds (fractions for percentages). */
  perTakedown: Record<string, number>;
  /** Champions whose likeliest Weapon it is. */
  champions: number;
  score: number;
  tier: string;
};

export function predictedDestiny(): { gold: number; rows: PredictedDestinyItem[] } | null {
  const d = data()?.weapon_of_destiny;
  if (!d) return null;
  const ref = itemRefs();
  const entries = Object.entries(d.items).flatMap(([id, v]) => {
    const r = ref(Number(id));
    return r ? [{ r, v }] : [];
  });
  if (!entries.length) return null;
  const grades = grade(entries.map(({ v }) => v.share));
  return {
    gold: d.gold_per_takedown,
    rows: entries.map(({ r, v }, k) => ({
      ...r,
      share: v.share,
      perTakedown: v.per_takedown,
      champions: v.champions,
      score: grades[k].deepScore,
      tier: grades[k].tier,
    })),
  };
}

export type PredictedDestinyChampion = {
  /** Champion id, as the tables and pages use it ("MonkeyKing"). */
  champion: string;
  /** Likeliest Weapon first, then up to two more. */
  items: ItemRef[];
};

export function predictedDestinyByChampion(): PredictedDestinyChampion[] {
  const d = data()?.weapon_of_destiny;
  if (!d) return [];
  const ref = itemRefs();
  const aliases = byKey();
  return Object.entries(d.champions).flatMap(([key, v]) => {
    const champion = aliases.get(key);
    const items = v.items.map(ref).filter((r): r is ItemRef => !!r);
    return champion && items.length ? [{ champion, items }] : [];
  });
}

type Ability = { slot: string; name: string; icon?: string };

export type PredictedPentakill = {
  champion: string;
  start: "Q" | "W" | "E";
  name: string;
  icon: string;
  /** How sure the prediction is, from how many picks back it and how often they agree. */
  confidence: "high" | "medium" | "low";
};

export function predictedPentakill(): PredictedPentakill[] {
  const d = data()?.pentakill;
  if (!d) return [];
  const aliases = byKey();
  const client = windowJson<{ champions: { alias: string; abilities?: Ability[] }[] }>("champions/data.js");
  const abilities = new Map((client?.champions ?? []).map((c) => [c.alias, new Map((c.abilities ?? []).map((a) => [a.slot, a]))]));
  return Object.entries(d).flatMap(([key, v]) => {
    const champion = aliases.get(key);
    if (!champion) return [];
    const a = abilities.get(champion)?.get(v.start);
    const confidence = v.picks >= 4 && v.agree >= 0.75 ? "high" : v.agree >= 0.6 ? "medium" : "low";
    return [{ champion, start: v.start, name: a?.name ?? "", icon: a?.icon ?? "", confidence }];
  });
}
