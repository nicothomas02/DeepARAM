import type { HistoryGame } from "./match-history";

// What the iPhone widgets show (apps/ios/DeepARAMWidgets): the owner's week in three leading indicators, one tip
// for the next game, and how the live patch treats the champions they play most. Built from the owner's own saved
// games (lib/match-history.ts) plus public champion tiers; served only to the owner by /api/widget, never public.
// Pure, so it can be tested without a database. The shape is decoded by DeepARAMKit/WidgetSummary.swift.
//
// The games are judged by what they led to (deaths, damage, share of the team's kills against the player's own usual),
// never by copying what the player picked.

export type Indicator = {
  key: "deaths" | "damage" | "kp";
  label: string;
  unit: string;
  week: number;
  usual: number | null;
  /** True when the week is at or better than usual (lower is better for deaths). */
  better: boolean | null;
};

export type ChampionTier = { id: string; name: string; tier: string; deepScore: number };

export type PatchChampion = ChampionTier & {
  games: number;
  /** DeepScore change since the previous patch, null when the champion wasn't ranked then. */
  change: number | null;
  tierBefore: string | null;
  /** Riot's Mayhem balance lines for this champion on the live patch, if any. */
  notes: string[];
};

export type WidgetSummary = {
  updated: number;
  week: { from: number; games: number; wins: number; losses: number; indicators: Indicator[] };
  tip: { title: string; body: string; key: Indicator["key"] | null };
  patch: { live: string | null; champions: PatchChampion[] };
};

const DAY = 86_400_000;
const USUAL_DAYS = 60;
const MIN_USUAL = 8;
const MIN_WEEK = 3;
/** How far off usual an indicator must be (relative) before the tip calls it out. */
const NOTICE = 0.1;

type Me = { championName?: string; championId?: number; teamId?: number; stats?: Record<string, number | boolean> };
type Row = { played: number; win: boolean; minutes: number; deaths: number; damage: number; kp: number | null; champ: string };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function row(g: HistoryGame): Row | null {
  const ps = g.participants as (Me & { puuid?: string })[];
  const me = ps.find((p) => p.puuid === "me");
  if (!me?.stats || g.gameDuration < 300) return null; // remakes and early surrenders say nothing
  const minutes = g.gameDuration / 60;
  const s = me.stats;
  const teamKills = ps.filter((p) => p.teamId === me.teamId).reduce((t, p) => t + num(p.stats?.kills), 0);
  return {
    played: g.gameCreation,
    win: s.win === true,
    minutes,
    deaths: (num(s.deaths) / minutes) * 10,
    damage: num(s.totalDamageDealtToChampions) / minutes,
    kp: teamKills > 0 ? (num(s.kills) + num(s.assists)) / teamKills : null,
    champ: me.championName ?? String(me.championId ?? ""),
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function indicators(week: Row[], usual: Row[]): Indicator[] {
  const enough = usual.length >= MIN_USUAL;
  const make = (key: Indicator["key"], label: string, unit: string, pick: (r: Row) => number | null, lowerIsBetter: boolean, round: (v: number) => number): Indicator => {
    const w = mean(week.map(pick).filter((v): v is number => v !== null)) ?? 0;
    const u = enough ? mean(usual.map(pick).filter((v): v is number => v !== null)) : null;
    return { key, label, unit, week: round(w), usual: u === null ? null : round(u), better: u === null || !week.length ? null : lowerIsBetter ? w <= u : w >= u };
  };
  const one = (v: number) => Math.round(v * 10) / 10;
  return [
    make("deaths", "Deaths per 10 min", "", (r) => r.deaths, true, one),
    make("damage", "Damage per min", "", (r) => r.damage, false, Math.round),
    make("kp", "Kill share", "%", (r) => (r.kp === null ? null : r.kp * 100), false, Math.round),
  ];
}

const TIPS: Record<Indicator["key"], (w: string, u: string) => { title: string; body: string }> = {
  deaths: (w, u) => ({ title: "Stay alive longer", body: `${w} deaths per 10 min lately, ${u} usual. Every death is time out of fights.` }),
  damage: (w, u) => ({ title: "Hit champions more", body: `${w} damage per min lately, ${u} usual. Look for more time in range of their team.` }),
  kp: (w, u) => ({ title: "Join more fights", body: `In ${w}% of your team's kills lately, ${u}% usual. Group up before fights start.` }),
};

function tipFor(list: Indicator[], games: number): WidgetSummary["tip"] {
  if (games < MIN_WEEK) return { title: "Play a few games", body: "The tip needs at least 3 games from the last week to compare with your usual.", key: null };
  // The indicator furthest below usual, relative to usual, if any is off by enough to matter.
  const off = list
    .filter((i) => i.usual !== null && i.usual > 0 && i.better === false)
    .map((i) => ({ i, by: Math.abs(i.week - i.usual!) / i.usual! }))
    .filter((x) => x.by >= NOTICE)
    .sort((a, b) => b.by - a.by)[0];
  if (!off) {
    if (list.every((i) => i.usual === null)) return { title: "Building your usual", body: "Tips start once there are a few weeks of games to compare against.", key: null };
    return { title: "Keep it going", body: "Deaths, damage and fights joined are all at or better than your usual this week.", key: null };
  }
  const fmt = (v: number) => (off.i.key === "damage" ? Math.round(v).toLocaleString("en-US") : String(v));
  return { ...TIPS[off.i.key](fmt(off.i.week), fmt(off.i.usual!)), key: off.i.key };
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * games: the owner's saved games, any order. now: the time to count the week back from.
 * tiers / before: public DeepScore tiers on the live and previous patch. notes: Mayhem balance lines by champion name.
 */
export function widgetSummary(
  games: HistoryGame[],
  now: number,
  live: string | null,
  tiers: ChampionTier[],
  before: ChampionTier[],
  notes: Record<string, string[]> = {},
): WidgetSummary {
  const rows = games.map(row).filter((r): r is Row => r !== null && r.played <= now);
  const from = now - 7 * DAY;
  const week = rows.filter((r) => r.played > from);
  const usual = rows.filter((r) => r.played <= from && r.played > from - USUAL_DAYS * DAY);
  // With a quiet week, the tip still looks at the last 10 games.
  const recent = week.length >= MIN_WEEK ? week : [...rows].sort((a, b) => b.played - a.played).slice(0, 10);
  const recentUsual = week.length >= MIN_WEEK ? usual : rows.filter((r) => !recent.includes(r) && r.played > now - (USUAL_DAYS + 7) * DAY);
  const list = indicators(week, usual);
  const tip = tipFor(week.length >= MIN_WEEK ? list : indicators(recent, recentUsual), recent.length);

  // The champions played most in the last 30 days (or the last 50 games), up to three.
  const pool = rows.filter((r) => r.played > now - 30 * DAY);
  const counted = new Map<string, number>();
  for (const r of pool.length >= 5 ? pool : [...rows].sort((a, b) => b.played - a.played).slice(0, 50)) {
    if (r.champ) counted.set(fold(r.champ), (counted.get(fold(r.champ)) ?? 0) + 1);
  }
  const byId = new Map(tiers.map((t) => [fold(t.id), t]));
  const prev = new Map(before.map((t) => [fold(t.id), t]));
  const noteBy = new Map(Object.entries(notes).map(([k, v]) => [fold(k), v]));
  const champions: PatchChampion[] = [...counted]
    .sort((a, b) => b[1] - a[1])
    .filter(([id]) => byId.has(id))
    .slice(0, 3)
    .map(([id, n]) => {
      const t = byId.get(id)!;
      const p = prev.get(id);
      return {
        ...t,
        games: n,
        change: p ? Math.round(t.deepScore - p.deepScore) : null,
        tierBefore: p?.tier ?? null,
        notes: (noteBy.get(id) ?? noteBy.get(fold(t.name)) ?? []).slice(0, 4),
      };
    });

  return {
    updated: now,
    week: { from, games: week.length, wins: week.filter((r) => r.win).length, losses: week.filter((r) => !r.win).length, indicators: list },
    tip,
    patch: { live, champions },
  };
}
