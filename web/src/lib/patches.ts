import "server-only";
import augmentNames from "@/data/augment-names.json";
import { augmentHref } from "./augments";
import { champName } from "./highlights";
import { patchList, patchRows } from "./champions";
import { readRepoCsv, repoHas, repoPath } from "./repo-data";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { champStats } from "./tiers";

// A short recap per live patch (/patches/<patch>): what changed for Mayhem augments (added, removed,
// changed numbers, from guide/history.js) and which champions rose and fell most that patch.

const AUGS = augmentNames as Record<string, string>;

type History = {
  augments: Record<string, { name: string; tier?: string }>;
  patches: { patch: string; added: string[]; removed: string[]; changed: { id: string; changes: { name: string; old: unknown; new: unknown }[] }[] }[];
};

let history: History | null | undefined;
function guideHistory(): History | null {
  if (history !== undefined) return history;
  if (!repoHas("guide/history.js")) return (history = null);
  const s = readFileSync(repoPath("guide/history.js"), "utf8");
  return (history = JSON.parse(s.slice(s.indexOf("=") + 1).trim().replace(/;\s*$/, "")) as History);
}

export type AugRef = { id: string; name: string; tier?: string; href: string | null; icon: boolean };
export type Recap = {
  patch: string;
  prev: string | null;
  days: number;
  released: string | null;
  added: AugRef[];
  removed: AugRef[];
  changed: (AugRef & { changes: { name: string; old: string; new: string }[] })[];
  up: { id: string; name: string; winRate: number; change: number }[];
  down: { id: string; name: string; winRate: number; change: number }[];
  hasAugmentHistory: boolean;
};

// "DotDamageCooldown" -> "Dot damage cooldown"; "SpawnFrequency_Seconds" -> "Spawn frequency seconds"
const label = (k: string) => {
  const s = k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const value = (v: unknown) => (v === null || v === undefined ? "none" : typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v));

export function recapPatches() {
  return [...patchList()].reverse();
}

export function recap(patch: string): Recap | null {
  const patches = patchList();
  const i = patches.indexOf(patch);
  if (i < 0) return null;
  const prev = i > 0 ? patches[i - 1] : null;
  const rows = patchRows();
  const now = champStats(rows, new Set([patch]));
  const before = prev ? new Map(champStats(rows, new Set([prev])).map((c) => [c.name, c.win_rate])) : new Map<string, number>();
  const moved = now
    .filter((c) => before.has(c.name))
    .map((c) => ({ id: c.name, name: champName(c.name), winRate: c.win_rate, change: c.win_rate - before.get(c.name)! }))
    .sort((a, b) => b.change - a.change);
  const h = guideHistory();
  const entry = h?.patches.find((p) => p.patch === patch);
  // Removed augments may have no page or icon left.
  const icon = (id: string) => existsSync(join(process.cwd(), "public", "icons", "augments", `${id}.webp`));
  const ref = (id: string): AugRef => ({ id, name: h?.augments[id]?.name ?? AUGS[id] ?? `Augment ${id}`, tier: h?.augments[id]?.tier, href: augmentHref(id), icon: icon(id) });
  return {
    patch,
    prev,
    days: Number(rows.find((r) => r.patch === patch)?.days ?? 0),
    released: (readRepoCsv("data/cn/history/patches.csv") ?? []).find((r) => r.patch === patch)?.released ?? null,
    added: (entry?.added ?? []).map(ref),
    removed: (entry?.removed ?? []).map(ref),
    changed: (entry?.changed ?? []).map((c) => ({ ...ref(c.id), changes: c.changes.map((x) => ({ name: label(x.name), old: value(x.old), new: value(x.new) })) })),
    up: moved.slice(0, 5),
    down: moved.slice(-5).reverse(),
    hasAugmentHistory: Boolean(h?.patches.some((p) => p.patch === patch)),
  };
}
