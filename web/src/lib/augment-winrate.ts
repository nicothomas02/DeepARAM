import "server-only";
import { readRepoJson } from "./repo-data";

// Fair augment win rates. Tencent's per-augment `pick_rate` and `win_rate` in data/cn/augments.json
// (and per champion in data/cn/builds/*.json) are measured per GAME, not per pick: an augment counts
// as picked when anyone in the game took it, and its win rate divides the teams that held it and won
// by the games in which anyone held it. When both teams hold it, exactly one of them wins, so the
// game is a "win" however it ends. That drags a popular augment's win rate up from 50%: the feed's
// pick-weighted mean is 54.4% where a sample of picks has to average 50%. The evidence (three
// independent checks, no fitted parameters) is in analysis/augment-uplift/README.md.
//
// The correction follows from the model alone. With q the chance that a given team holds the augment
// and the two teams drawing independently, the published pick rate is 1 - (1 - q)^2, so
// q = 1 - sqrt(1 - pick_rate). Per game there are 2q holdings, of which 2qw win (w the team win rate),
// over 2q - q^2 games with a holder: win_rate = 2qw / (2q - q^2) = w / (1 - q/2). So the team win rate
// is w = win_rate x (1 - q/2). After it the feed's pick-weighted mean is 50.2% and the result is
// directly comparable with champion win rates.
//
// Before this, the site regressed win rate on pick rate within each rarity and re-centred each rarity
// on 50%, which removed real selection along with the artifact; the README compares the two.

export type RawAugment = { augment_id: number; win_rate: number; pick_rate: number; tier?: string; win_rank?: number; win_rank_change?: number };

/** The chance that a given team holds the augment, from the share of games (either team) that do:
 * `1 - sqrt(1 - pickRate)`, since with two independent teams `pickRate = 1 - (1 - q)^2`. */
export function perTeamPickRate(pickRate: number): number {
  const p = Math.min(1, Math.max(0, pickRate));
  return 1 - Math.sqrt(1 - p);
}

/** The team win rate behind a per-game win rate: `winRate x (1 - q/2)` with `q = perTeamPickRate(pickRate)`.
 * A pick rate of 0 leaves the win rate unchanged; the more popular the augment, the larger the share
 * of its games it was on both sides of and so counted as won, and the more is taken off. */
export function correctPerGameWinRate(pickRate: number, winRate: number): number {
  return winRate * (1 - perTeamPickRate(pickRate) / 2);
}

const rarityOf = (r: RawAugment) => String(r.tier ?? "").toLowerCase();

/** Each augment's uplift: its corrected (team) win rate minus the pick-weighted mean corrected win rate
 * of its rarity, the baseline the tier list (lib/augment-tiers.ts) scores against. A selection only
 * ever offers one rarity, so this is how much better than the alternatives on offer the augment does. */
export function augmentUplift<T extends RawAugment>(rows: T[]): Map<number, number> {
  const sums = new Map<string, [number, number]>();
  for (const r of rows) {
    const [s, n] = sums.get(rarityOf(r)) ?? [0, 0];
    sums.set(rarityOf(r), [s + correctPerGameWinRate(r.pick_rate, r.win_rate) * r.pick_rate, n + r.pick_rate]);
  }
  return new Map(
    rows.map((r) => {
      const [s, n] = sums.get(rarityOf(r)) ?? [0, 0];
      return [r.augment_id, correctPerGameWinRate(r.pick_rate, r.win_rate) - (n > 0 ? s / n : 0.5)];
    }),
  );
}

/** Raw augment rows with `win_rate` replaced by the fair (team) win rate, and `win_rank` re-ranked on it.
 * The source's `win_rank_change` compares raw ranks, so it is dropped. */
export function fairAugments<T extends RawAugment>(rows: T[]): T[] {
  const fair = new Map(rows.map((r) => [r.augment_id, correctPerGameWinRate(r.pick_rate, r.win_rate)]));
  const order = [...rows].sort((a, b) => (fair.get(b.augment_id) ?? 0) - (fair.get(a.augment_id) ?? 0)).map((r) => r.augment_id);
  return rows.map((r) => {
    const { win_rank_change, ...rest } = r;
    void win_rank_change;
    return { ...rest, win_rate: Math.round((fair.get(r.augment_id) ?? r.win_rate) * 10000) / 10000, win_rank: order.indexOf(r.augment_id) + 1 } as T;
  });
}

let cache: RawAugment[] | null = null;
/** data/cn/augments.json's augments with fair win rates. */
export function augmentRows<T extends RawAugment = RawAugment>(): T[] {
  cache ??= fairAugments(readRepoJson<{ augments: RawAugment[] }>("data/cn/augments.json")?.augments ?? []);
  return cache as T[];
}
