import "server-only";
import championIds from "@/data/champion-ids.json";
import { aramhexPatch } from "./aramhex-real";
import { BRACKETS, type Bracket } from "./brackets";
import { FIT, fittedBound, grade, trueSpread, type Fit } from "./deepscore";
import { readRepoJson } from "./repo-data";

// A champion's augments scored for one skill bracket (Nico 2026-11-24 chose "Half-and-half, live patch only").
// Backtest (AramHex 16.20->16.21->16.22, analysis in thread "Keep site data matched to AramHex"): picking for top-5%
// players by top-5% games alone did slightly worse next patch than by all players' games (+2.16 vs +2.21 pts per
// 3-card offer, rank correlation 0.820 vs 0.837): the bracket's real differences (about 0.9 pts spread) are smaller
// than its sampling noise. Half bracket, half all players did best (+2.23, 0.847; top 5 +4.33 vs +4.23), mid bracket
// the same way. So each augment's score is the mean of its two bound scores (lib/deepscore.ts fittedBound), each
// within its own list; nothing is pulled toward popular picks. Only when the live patch itself has bracket tables:
// an older patch's brackets predicted worse than the live patch's all-player data. Spells: the one patch pair with
// bracket spells didn't support the mix, so they aren't blended (data kept by fetch.py for a re-test).

type Table = Record<string, Record<string, [number, number]>>;
const IDS = championIds as Record<string, number>;
export const BRACKET_WEIGHT = 0.5;

/** Each row's bound score within its list (the same as scoreRows' real-games branch). */
export function boundScores(rows: Record<string, [number, number]>, fit: Fit | null): Map<string, number> {
  const ok = Object.entries(rows).filter(([, [g]]) => g > 0);
  const out = new Map<string, number>();
  if (!ok.length || !fit) return out;
  const games = ok.reduce((s, [, [g]]) => s + g, 0);
  const mean = ok.reduce((s, [, [, w]]) => s + w, 0) / games;
  const wr = ok.map(([, [g, w]]) => w / g);
  const vs = ok.map(([, [g]], i) => (wr[i] * (1 - wr[i])) / g);
  const tau2 = trueSpread(wr, vs);
  ok.forEach(([k], i) => out.set(k, fittedBound(wr[i], 1, mean, fit, { v: vs[i], tau2 })));
  return out;
}

/** DeepScore per key from two lists' bound scores mixed `w` (bracket) to 1 - w (all players); a key in one list only
 *  keeps that list's score. */
export function blendScores(all: Map<string, number>, bracket: Map<string, number>, w = BRACKET_WEIGHT): Map<string, number> {
  const keys = [...new Set([...all.keys(), ...bracket.keys()])];
  const mixed = keys.map((k) => {
    const a = all.get(k), b = bracket.get(k);
    return a !== undefined && b !== undefined ? w * b + (1 - w) * a : (b ?? a)!;
  });
  const g = grade(mixed);
  return new Map(keys.map((k, i) => [k, g[i].deepScore]));
}

/** Augment id -> bracket DeepScore, per bracket the live patch publishes; null when it publishes none. */
export function bracketAugmentScores(alias: string): Partial<Record<Bracket, Map<number, number>>> | null {
  const patch = aramhexPatch();
  const id = String(IDS[alias] ?? "");
  const all = patch ? readRepoJson<Table>(`data/aramhex/patches/${patch}/augments.json`)?.[id] : null;
  if (!patch || !all) return null;
  const allScores = boundScores(all, FIT.augments);
  const out: Partial<Record<Bracket, Map<number, number>>> = {};
  for (const b of BRACKETS) {
    const rows = readRepoJson<Table>(`data/aramhex/patches/${patch}/bands/${b}/augments.json`)?.[id];
    if (!rows) continue;
    const m = blendScores(allScores, boundScores(rows, FIT.augments));
    out[b] = new Map([...m].map(([k, v]) => [Number(k), v]));
  }
  return Object.keys(out).length ? out : null;
}
