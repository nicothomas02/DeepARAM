import "server-only";
import championIds from "@/data/champion-ids.json";
import { readdirSync } from "node:fs";
import { readRepoCsv, readRepoJson, repoPath } from "./repo-data";
import { synergy } from "./synergy";
import { pairLacksHardCC } from "./cc";
import { livePatch } from "./highlights";
import { patchMatches } from "./sample";
import { championTagData, championTags } from "./champion-tags";

// The Duos tab: every pair of teammates the live stats list. Each champion lists its 50 most played-with
// teammates (data/cn/champions.json best_partners), so the pairs cover strong and weak champions alike,
// about 7,000 in all. The champion and pair win rates come from the same snapshot, so they compare fairly.
//
// delta: the pair's synergy, how much more it wins than the two champions' own win rates predict
// (lib/synergy.ts); the pair's raw win rate isn't shown, it mostly echoes the two champions' own. pick_rate: how often the first champion has the second as a teammate.
// The champion with the bigger share of its team's damage is listed first.
//
// delta (shown as "Win rate boost"): the pair's synergy, adjusted for how often it's played, the same
// confidence step the champion DeepScore uses (lib/tiers.ts). A pair's games are its pick rate times the first
// champion's, scaled so a pair of median popularity counts 1,000 pseudo-games, and its measured synergy is
// pulled toward the games-weighted average of all pairs by a prior worth a quarter of that. A common pair
// keeps nearly all of its boost; a rarely played one's big boost shrinks, so it can't top the list on luck.
//
// archetypeRows: the same pairs pooled by Riot subclass (Enchanter + Enchanter, Marksman + Enchanter),
// each pair weighted by its games; a champion with two subclasses splits its weight between them.
// Pairs are limited to each champion's 50 most played-with teammates, the only ones the live stats list.

type Partner = { champion_id: number; win_rate: number; pick_rate: number };
type Champs = { champions: { champion_id: number; win_rate: number; pick_rate: number; avg_damage_ratio?: number; best_partners?: Partner[] }[] };
type Duos = { duos: { champion_ids?: number[]; roles?: string[] }[] };

const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([a, id]) => [id, a]));

export const hasDuos = () => Boolean(readRepoJson<Champs>("data/cn/champions.json")?.champions.some((c) => c.best_partners?.length));

/** games: the pair's estimated games together on the live patch (lib/sample.ts), for its range and low-sample tag. */
export type DuoRow = {
  a: string;
  b: string;
  pair: string;
  delta: number;
  pick_rate: number;
  roles: string;
  noCC: string;
  games: number | null;
  /** How the two kits work together, from the champion tags (estimated); "" when no rule fits (duoWhy). */
  why: string;
  /** Earlier patches whose saved snapshot measured the pair (holdsOn), for the "Held on" note. */
  held: number;
};
export type ArchetypeRow = { a: string; b: string; delta: number; duos: number };

const MEDIAN_GAMES = 1000; // pseudo-games for a pair of median popularity, as on the Tier List
const PRIOR = 0.25;

// Each measured synergy pulled toward the list's games-weighted average, more so the fewer games it has.
function adjust(deltas: number[], games: number[]) {
  const total = games.reduce((a, b) => a + b, 0) || 1;
  const mean = deltas.reduce((a, d, i) => a + d * games[i], 0) / total;
  const prior = PRIOR * MEDIAN_GAMES;
  return deltas.map((d, i) => (d * games[i] + mean * prior) / (games[i] + prior));
}

export type Mate = { id: string; synergy: number; pickRate: number; noCC: boolean; games: number | null };

let cache: { rows: DuoRow[]; games: number[]; measured: number[]; rates: Map<string, number> } | null = null;
export const duoRows = (): DuoRow[] => build().rows;

/** A champion's teammates from the Duos list, best Win rate boost first, with how often it has each as a teammate (champion pages). */
export function matesOf(alias: string): Mate[] {
  const { rows, rates } = build();
  return rows
    .flatMap((r) =>
      (r.a === alias ? [r.b] : r.b === alias ? [r.a] : []).map((id) => ({
        id,
        synergy: r.delta,
        pickRate: rates.get(`${alias} ${id}`) ?? 0,
        noCC: r.noCC !== "",
        games: r.games,
      })),
    )
    .sort((x, y) => y.synergy - x.synergy);
}

/** Changes whenever the Duos data does, so browsers never pair a new page with an old cached copy. */
export function duoVersion() {
  let h = 0;
  for (const ch of JSON.stringify(duoRows())) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

// Duo checks (Nico 2026-11-24: "Build duo checks"). A pair's boost must hold across patches: each ended patch's
// teammate synergy is saved (data/cn/partner_history.py), and a pair is kept only when its measured synergy has the
// same sign on most of the last HELD_PATCHES ended patches that measured it (a pair no earlier patch measured is kept).
// Patch-to-patch synergies correlate ~0.92, so few pairs drop; those that do were one-patch flukes.
const HELD_PATCHES = 3;
type PartnerFile = { patch: string; pairs: Record<string, number> };
function earlierSynergies(live: string | null): PartnerFile[] {
  let files: string[] = [];
  try {
    files = readdirSync(repoPath("data/cn/history/partners")).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const vkey = (p: string) => p.split(".").map((x) => x.padStart(4, "0")).join(".");
  return files
    .map((f) => f.replace(/\.json$/, ""))
    .filter((p) => p !== live)
    .sort((x, y) => vkey(y).localeCompare(vkey(x)))
    .slice(0, HELD_PATCHES)
    .flatMap((p) => readRepoJson<PartnerFile>(`data/cn/history/partners/${p}.json`) ?? []);
}
/** null: no earlier patch measured the pair; else whether most of them agree with today's sign, and how many there were. */
function holdsOn(earlier: PartnerFile[], a: number, b: number, now: number): { ok: boolean; n: number } | null {
  const key = [a, b].sort((m, n) => m - n).join("-");
  const seen = earlier.flatMap((f) => (f.pairs[key] === undefined ? [] : [f.pairs[key]]));
  if (!seen.length) return null;
  const agree = seen.filter((v) => Math.sign(v) === Math.sign(now)).length;
  return { ok: agree * 2 > seen.length, n: seen.length };
}

// 101's own champion win rates on the day of its teammate numbers (data/cn/history/daily): merge.py lays AramHex's
// rates over champions.json, and comparing a 101 pair rate with AramHex solo rates mixed two sources (~0.7 points
// apart per champion). Falls back to champions.json's rates when that day isn't saved.
function sameDayRates(statDate: string | undefined): Map<number, number> {
  if (!statDate || statDate.length !== 8) return new Map();
  const day = `${statDate.slice(0, 4)}-${statDate.slice(4, 6)}-${statDate.slice(6)}`;
  const rows = readRepoCsv(`data/cn/history/daily/${day.slice(0, 7)}.csv`) ?? [];
  return new Map(rows.filter((r) => r.date === day).map((r) => [Number(r.champion_id), Number(r.win_rate)]));
}

// "Why it works": one line from the two kits (champions/tags.json: subclasses, playstyles, crowd control), the
// first rule that fits. Our own reading of the tags, so it is labelled estimated on the page.
type TagChamp = { classes?: string[]; subclasses?: string[]; playstyles?: string[]; cc?: Record<string, string>; hardCC?: boolean };
let tagChamps: Record<string, TagChamp> | null = null;
export function duoWhy(x: string, y: string): string {
  tagChamps ??= readRepoJson<{ champions: Record<string, TagChamp> }>("champions/tags.json")?.champions ?? {};
  const t = (c: string) => {
    const d = tagChamps![c] ?? {};
    return new Set([...(d.classes ?? []), ...(d.subclasses ?? []), ...(d.playstyles ?? [])]);
  };
  const airborne = (c: string) => Object.values(tagChamps![c]?.cc ?? {}).some((k) => k === "knockup" || k === "knockback");
  const hard = (c: string) => !!tagChamps![c]?.hardCC;
  const [A, B] = [t(x), t(y)];
  const either = (f: (p: Set<string>, q: Set<string>, pc: string, qc: string) => boolean) => f(A, B, x, y) || f(B, A, y, x);
  const has = (s: Set<string>, ...k: string[]) => k.some((v) => s.has(v));
  if (either((_p, _q, pc, qc) => pc === "Yasuo" && airborne(qc))) return "Knock-ups set up Yasuo's ultimate.";
  if (either((p, q) => has(p, "Enchanter", "Ally Protection") && has(q, "Hypercarry", "Marksman"))) return "Heals and shields keep the carry fighting.";
  if (either((p, q) => has(p, "Catcher") && has(q, "Burst", "Assassin", "Artillery"))) return "Hooks and traps catch targets for burst.";
  if (either((p, q, pc) => has(p, "Initiator", "Vanguard") && hard(pc) && has(q, "Burst", "Assassin", "Artillery"))) return "Engage locks enemies down for burst damage.";
  if (either((p, q) => has(p, "Warden", "Tank") && has(q, "Marksman", "Hypercarry"))) return "A frontline peels for the carry.";
  if (A.has("AoE") && B.has("AoE") && (hard(x) || hard(y))) return "Crowd control groups enemies for area damage.";
  return "";
}

// The solo win rate a pair is compared with: 101's same-day rate, else champions.json's.
let soloCache: ((id: number) => number) | null = null;
export function duoSoloRate(id: number): number {
  if (!soloCache) {
    const file = readRepoJson<Champs & { meta?: { champion_stat_date?: string } }>("data/cn/champions.json");
    const solo = new Map((file?.champions ?? []).map((c) => [c.champion_id, c.win_rate]));
    const own = sameDayRates(file?.meta?.champion_stat_date);
    soloCache = (i) => own.get(i) ?? solo.get(i) ?? 0.5;
  }
  return soloCache(id);
}

function build() {
  if (cache) return cache;
  const file = readRepoJson<Champs>("data/cn/champions.json");
  const champs = file?.champions ?? [];
  const solo = new Map(champs.map((c) => [c.champion_id, c]));
  const soloRate = duoSoloRate;
  const earlier = earlierSynergies(livePatch());
  // Roles per champion, as the duo list writes them ("mage,support" becomes "mage/support").
  const roles = new Map<number, string>();
  for (const d of readRepoJson<Duos>("data/cn/duos.json")?.duos ?? [])
    (d.champion_ids ?? []).forEach((id, i) => d.roles?.[i] && roles.set(id, d.roles[i].replace(/,/g, "/")));
  // How often a champion has another as a teammate: its own listing, else the other's turned around by
  // the two champions' pick rates (a pair's games over the first champion's games).
  const listed = new Map(champs.flatMap((c) => (c.best_partners ?? []).map((p) => [`${c.champion_id}-${p.champion_id}`, p.pick_rate] as const)));
  const withMate = (a: number, b: number) =>
    listed.get(`${a}-${b}`) ?? (listed.get(`${b}-${a}`) ?? 0) * ((solo.get(b)?.pick_rate ?? 0) / (solo.get(a)?.pick_rate || 1));
  const damage = (id: number) => solo.get(id)?.avg_damage_ratio ?? 0;
  const seen = new Set<string>();
  const out: DuoRow[] = [];
  const weight: number[] = [];
  const rates = new Map<string, number>();
  const matches = patchMatches(livePatch());
  for (const c of champs) {
    for (const p of c.best_partners ?? []) {
      const other = solo.get(p.champion_id);
      const key = [c.champion_id, p.champion_id].sort((m, n) => m - n).join("-");
      if (!other || !ALIAS[c.champion_id] || !ALIAS[p.champion_id] || seen.has(key)) continue;
      seen.add(key);
      const [first, second] = damage(p.champion_id) > damage(c.champion_id) ? [p.champion_id, c.champion_id] : [c.champion_id, p.champion_id];
      const [x, y] = [ALIAS[first], ALIAS[second]];
      const measured = synergy(p.win_rate, soloRate(c.champion_id), soloRate(p.champion_id));
      const held = holdsOn(earlier, c.champion_id, p.champion_id, measured);
      if (held && !held.ok) continue;
      out.push({
        a: x,
        b: y,
        pair: `${x} ${y}`,
        delta: measured,
        pick_rate: withMate(first, second),
        roles: [roles.get(first), roles.get(second)].filter(Boolean).join(" + "),
        // Marked when neither champion can lock an enemy down (lib/cc.ts).
        noCC: pairLacksHardCC(x, y) ? "No hard CC" : "",
        games: matches ? Math.round((solo.get(first)?.pick_rate ?? 0) * withMate(first, second) * matches) : null,
        why: duoWhy(x, y),
        held: held?.n ?? 0,
      });
      weight.push((solo.get(first)?.pick_rate ?? 0) * withMate(first, second));
      rates.set(`${x} ${y}`, withMate(first, second)).set(`${y} ${x}`, withMate(second, first));
    }
  }
  const median = [...weight].sort((m, n) => m - n)[Math.floor(weight.length / 2)] || 1;
  const games = weight.map((w) => (w / median) * MEDIAN_GAMES);
  const measured = out.map((r) => r.delta);
  const boost = adjust(measured, games);
  cache = { rows: out.map((r, i) => ({ ...r, delta: boost[i] })), games, measured, rates };
  return cache;
}

// A champion's subclasses (Enchanter, Burst), else its class for champions too new for one.
export function archetypes(alias: string) {
  const { info } = championTagData();
  const tags = championTags(alias);
  const sub = tags.filter((t) => info[t]?.kind === "sub");
  return sub.length ? sub : tags.filter((t) => info[t]?.kind === "class");
}

// Fewer pairs than this (mostly champions too new for a subclass) is too few to speak for an archetype.
const MIN_DUOS = 5;

let archCache: ArchetypeRow[] | null = null;
export function archetypeRows(): ArchetypeRow[] {
  if (archCache) return archCache;
  // Pools the measured synergies, then adjusts each archetype pair by its pooled games.
  const { rows, games, measured } = build();
  const sums = new Map<string, { a: string; b: string; w: number; d: number; duos: number }>();
  rows.forEach((r, i) => {
    const [as, bs] = [archetypes(r.a), archetypes(r.b)];
    const share = games[i] / (as.length * bs.length || 1);
    for (const x of as)
      for (const y of bs) {
        const [a, b] = [x, y].sort();
        const s = sums.get(`${a}+${b}`) ?? { a, b, w: 0, d: 0, duos: 0 };
        s.w += share;
        s.d += share * measured[i];
        s.duos += 1;
        sums.set(`${a}+${b}`, s);
      }
  });
  const pooled = [...sums.values()].filter((s) => s.duos >= MIN_DUOS);
  const deltas = pooled.map((s) => s.d / (s.w || 1));
  const boost = adjust(
    deltas,
    pooled.map((s) => s.w),
  );
  archCache = pooled.map((s, i) => ({ a: s.a, b: s.b, delta: boost[i], duos: s.duos }));
  return archCache;
}
