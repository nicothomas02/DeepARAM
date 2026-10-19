import "server-only";
import championIds from "@/data/champion-ids.json";
import { readRepoJson } from "./repo-data";
import { synergy } from "./synergy";
import { grade, lowerBound } from "./deepscore";
import { championTagData, championTags } from "./champion-tags";

// The Duos tab: every pair of teammates the live stats list. Each champion lists its 50 most played-with
// teammates (data/cn/champions.json best_partners), so the pairs cover strong and weak champions alike,
// about 7,000 in all. The champion and pair win rates come from the same snapshot, so they compare fairly.
//
// delta: the pair's synergy, how much more it wins than the two champions' own win rates predict
// (lib/synergy.ts); the pair's raw win rate isn't shown, it mostly echoes the two champions' own. pick_rate: how often the first champion has the second as a teammate.
// The champion with the bigger share of its team's damage is listed first.
//
// deepScore: the champion DeepScore (lib/tiers.ts) applied to a pair. Where a champion is graded on its win
// rate, a pair is graded on the win rate it adds over its two champions (0.5 + delta), so two strong
// champions don't score well just for being strong. Same steps: a pair's games are its pick rate times the
// first champion's, scaled so a pair of median popularity counts 1,000 pseudo-games; the rate is pulled
// toward the games-weighted average of all pairs by a prior worth a quarter of that and the low end of its
// likely range kept, so a big delta from a rarely played pair can't outrank a slightly smaller one from a
// common pair; then scores are spread against the rest of the list.
//
// archetypeRows: the same pairs pooled by Riot subclass (Enchanter + Enchanter, Marksman + Enchanter),
// each pair weighted by its games; a champion with two subclasses splits its weight between them.
// Pairs are limited to each champion's 50 most played-with teammates, the only ones the live stats list.

type Partner = { champion_id: number; win_rate: number; pick_rate: number };
type Champs = { champions: { champion_id: number; win_rate: number; pick_rate: number; avg_damage_ratio?: number; best_partners?: Partner[] }[] };
type Duos = { duos: { champion_ids?: number[]; roles?: string[] }[] };

const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([a, id]) => [id, a]));

export const hasDuos = () => Boolean(readRepoJson<Champs>("data/cn/champions.json")?.champions.some((c) => c.best_partners?.length));

export type DuoRow = { a: string; b: string; pair: string; delta: number; deepScore: number; pick_rate: number; roles: string };
export type ArchetypeRow = { a: string; b: string; delta: number; deepScore: number; duos: number };

const MEDIAN_GAMES = 1000; // pseudo-games for a pair of median popularity, as on the Tier List
const PRIOR = 0.25;

// Each pair's DeepScore, from its delta and pseudo-games, against the list's games-weighted average delta.
function deepScores(deltas: number[], games: number[]) {
  const total = games.reduce((a, b) => a + b, 0) || 1;
  const mean = 0.5 + deltas.reduce((a, d, i) => a + d * games[i], 0) / total;
  return grade(deltas.map((d, i) => lowerBound(0.5 + d, games[i], mean, PRIOR * MEDIAN_GAMES))).map((g) => g.deepScore);
}

let cache: { rows: DuoRow[]; games: number[] } | null = null;
export const duoRows = (): DuoRow[] => build().rows;

/** Changes whenever the Duos data does, so browsers never pair a new page with an old cached copy. */
export function duoVersion() {
  let h = 0;
  for (const ch of JSON.stringify(duoRows())) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

function build() {
  if (cache) return cache;
  const champs = readRepoJson<Champs>("data/cn/champions.json")?.champions ?? [];
  const solo = new Map(champs.map((c) => [c.champion_id, c]));
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
  const out: Omit<DuoRow, "deepScore">[] = [];
  const weight: number[] = [];
  for (const c of champs) {
    for (const p of c.best_partners ?? []) {
      const other = solo.get(p.champion_id);
      const key = [c.champion_id, p.champion_id].sort((m, n) => m - n).join("-");
      if (!other || !ALIAS[c.champion_id] || !ALIAS[p.champion_id] || seen.has(key)) continue;
      seen.add(key);
      const [first, second] = damage(p.champion_id) > damage(c.champion_id) ? [p.champion_id, c.champion_id] : [c.champion_id, p.champion_id];
      const [x, y] = [ALIAS[first], ALIAS[second]];
      out.push({
        a: x,
        b: y,
        pair: `${x} ${y}`,
        delta: synergy(p.win_rate, c.win_rate, other.win_rate),
        pick_rate: withMate(first, second),
        roles: [roles.get(first), roles.get(second)].filter(Boolean).join(" + "),
      });
      weight.push((solo.get(first)?.pick_rate ?? 0) * withMate(first, second));
    }
  }
  const median = [...weight].sort((m, n) => m - n)[Math.floor(weight.length / 2)] || 1;
  const games = weight.map((w) => (w / median) * MEDIAN_GAMES);
  const scores = deepScores(
    out.map((r) => r.delta),
    games,
  );
  cache = { rows: out.map((r, i) => ({ ...r, deepScore: scores[i] })), games };
  return cache;
}

// A champion's subclasses (Enchanter, Burst), else its class for champions too new for one.
function archetypes(alias: string) {
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
  const { rows, games } = build();
  const sums = new Map<string, { a: string; b: string; w: number; d: number; duos: number }>();
  rows.forEach((r, i) => {
    const [as, bs] = [archetypes(r.a), archetypes(r.b)];
    const share = games[i] / (as.length * bs.length || 1);
    for (const x of as)
      for (const y of bs) {
        const [a, b] = [x, y].sort();
        const s = sums.get(`${a}+${b}`) ?? { a, b, w: 0, d: 0, duos: 0 };
        s.w += share;
        s.d += share * r.delta;
        s.duos += 1;
        sums.set(`${a}+${b}`, s);
      }
  });
  const pooled = [...sums.values()].filter((s) => s.duos >= MIN_DUOS);
  const deltas = pooled.map((s) => s.d / (s.w || 1));
  const scores = deepScores(
    deltas,
    pooled.map((s) => s.w),
  );
  archCache = pooled.map((s, i) => ({ a: s.a, b: s.b, delta: deltas[i], deepScore: scores[i], duos: s.duos }));
  return archCache;
}
