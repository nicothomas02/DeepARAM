import "server-only";
import { readRepoJson } from "./repo-data";
import championIds from "@/data/champion-ids.json";
import championNames from "@/data/champion-names.json";
import augmentNames from "@/data/augment-names.json";

// Set 3 Headliners (data/estimates/headliners.json, from data/estimates/headliners.py): the Pentakill
// Empower picks per champion (simulated), the champions each other Headliner suits (estimated) and the
// band missions with the champions most likely to finish them. Pages label all of it as an estimate.

type Slot = "Q" | "W" | "E" | "R";
type Ranked = { id: number; value: number; augment?: number };
type Raw = {
  patch: string;
  pentakill: Record<
    string,
    {
      start: Slot;
      level18: Slot;
      by: "damage" | "healing";
      gain: number;
      start_options: Record<string, { early: number; late: number; heal: number; score: number }>;
      level18_options: Record<string, { late: number; heal: number }>;
    }
  >;
  headliners: { id: string; basis: string; champions: Ranked[] }[];
  missions: {
    band: string;
    fame: number;
    missions: { title: string; description: string; steps: string[]; metric?: string; tip?: string; champions?: Ranked[] }[];
  }[];
};

export type HeadlinerChamp = { id: string; name: string; value: number; augment?: { id: number; name: string } };
export type PentakillRow = {
  id: string;
  name: string;
  start: Slot;
  level18: Slot;
  by: "damage" | "healing";
  gain: number;
  q: number | null;
  w: number | null;
  e: number | null;
};
export type HeadlinersData = {
  pentakill: PentakillRow[];
  headliners: { id: string; basis: string; champions: HeadlinerChamp[] }[];
  missions: {
    band: string;
    fame: number;
    missions: { title: string; description: string; steps: string[]; metric?: string; tip?: string; champions: HeadlinerChamp[] }[];
  }[];
};

const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([alias, id]) => [id, alias]));
const NAMES = championNames as Record<string, string>;
const AUGS = augmentNames as Record<string, string>;

function champ(r: Ranked): HeadlinerChamp | null {
  const alias = ALIAS[r.id];
  if (!alias) return null;
  const out: HeadlinerChamp = { id: alias, name: NAMES[alias] ?? alias, value: r.value };
  if (r.augment && AUGS[String(r.augment)]) out.augment = { id: r.augment, name: AUGS[String(r.augment)] };
  return out;
}

const champs = (rows: Ranked[] = []) => rows.map(champ).filter((c): c is HeadlinerChamp => c !== null);

export function headlinersData(): HeadlinersData | null {
  const raw = readRepoJson<Raw>("data/estimates/headliners.json");
  if (!raw) return null;
  const pentakill = Object.entries(raw.pentakill).flatMap(([id, p]) => {
    const alias = ALIAS[Number(id)];
    if (!alias) return [];
    const opt = (s: string) => p.start_options[s]?.score ?? null;
    return [
      {
        id: alias,
        name: NAMES[alias] ?? alias,
        start: p.start,
        level18: p.level18,
        by: p.by,
        gain: p.gain / 100,
        q: opt("Q") === null ? null : opt("Q")! / 100,
        w: opt("W") === null ? null : opt("W")! / 100,
        e: opt("E") === null ? null : opt("E")! / 100,
      },
    ];
  });
  return {
    pentakill,
    headliners: raw.headliners.map((h) => ({ id: h.id, basis: h.basis, champions: champs(h.champions) })),
    missions: raw.missions.map((b) => ({ ...b, missions: b.missions.map((m) => ({ ...m, champions: champs(m.champions) })) })),
  };
}
