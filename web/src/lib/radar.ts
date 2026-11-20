import type { ChampStats } from "./tiers";

// A champion's profile among all champions over a patch range: each stat's percentile, rank and value. Shared by
// the server (lib/champions.ts) and the champion page's timeframe picker in the browser.

export type RadarAxis = { key: string; label: string; hint: string; pct: number; rank: number; of: number; value: string };

const AXES: { key: "win_rate" | "pick_rate" | "damage" | "tank" | "kp" | "dead"; label: string; hint: string; low?: boolean; fmt: (v: number) => string }[] = [
  { key: "win_rate", label: "Win rate", hint: "Win rate", fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "pick_rate", label: "Pick rate", hint: "How often this champion is picked", fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "damage", label: "Damage dealt", hint: "Share of the team's damage to champions", fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "tank", label: "Damage taken", hint: "Share of the team's damage taken that this champion soaked", fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "kp", label: "Kill participation", hint: "Share of the team's kills this champion took part in", fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: "dead", label: "Time dead", hint: "Average time spent dead per game (less is better)", low: true, fmt: (v) => `${Math.floor(v / 60)}m ${String(Math.round(v % 60)).padStart(2, "0")}s dead` },
];

export function radarFor(alias: string, live: ChampStats[]): RadarAxis[] {
  const me = live.find((c) => c.name === alias);
  if (!me) return [];
  return AXES.flatMap((a) => {
    const mine = me[a.key];
    const all = live.map((c) => c[a.key]).filter((v): v is number => typeof v === "number");
    if (typeof mine !== "number" || all.length < 2) return [];
    // Rank 1 is the best: highest, or lowest where less is better.
    const better = all.filter((v) => (a.low ? v < mine : v > mine)).length;
    return [{ key: a.key, label: a.label, hint: a.hint, pct: 1 - better / (all.length - 1), rank: better + 1, of: all.length, value: a.fmt(mine) }];
  });
}

