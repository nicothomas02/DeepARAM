import "server-only";
import { readRepoJson } from "./repo-data";

// Fair augment win rates. The raw augment win rates in data/cn/augments.json run high in proportion to how
// often an augment is taken when offered (its pick_rate): within each rarity they average about 52%, and
// the most-taken augments read 5 to 15 points high. A whole sample of augment picks has to average 50%.
// So within each rarity we fit win rate against pick rate (least squares), take out that slope, and
// re-centre the rarity on 50%. What's left is how far each augment sits above or below what its
// popularity alone predicts.

export type RawAugment = { augment_id: number; win_rate: number; pick_rate: number; tier?: string; win_rank?: number; win_rank_change?: number };

/** Raw augment rows with `win_rate` replaced by the fair win rate, and `win_rank` re-ranked on it. The
 * source's `win_rank_change` compares raw ranks, so it is dropped. */
export function fairAugments<T extends RawAugment>(rows: T[]): T[] {
  const fair = new Map<number, number>();
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = String(r.tier ?? "").toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) {
    const n = group.length;
    const mp = group.reduce((s, r) => s + r.pick_rate, 0) / n;
    const mw = group.reduce((s, r) => s + r.win_rate, 0) / n;
    const sxx = group.reduce((s, r) => s + (r.pick_rate - mp) ** 2, 0);
    const slope = n > 2 && sxx > 0 ? group.reduce((s, r) => s + (r.pick_rate - mp) * (r.win_rate - mw), 0) / sxx : 0;
    for (const r of group) fair.set(r.augment_id, r.win_rate - slope * (r.pick_rate - mp) - (mw - 0.5));
  }
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
