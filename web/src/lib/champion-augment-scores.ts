import "server-only";
import { type AugmentRow } from "./champion-page";

/** Each grade's DeepScore band, so the score's tier letter matches the grade (lib/deepscore.ts: S 70+, A 59+, B 44+,
 *  C 32+). Augments without a grade sit below C. */
const BANDS: Record<string, [number, number]> = { S: [70, 84], A: [59, 69], B: [44, 58], C: [32, 43] };
const NO_GRADE: [number, number] = [20, 31];

/**
 * Each of a champion's augments' DeepScore on that champion, from the live stats alone (Nico, 2026-11-20: public
 * numbers come only from the stats feed): the feed's grade for the augment on this champion sets the band, and the
 * champion's pick rate orders augments inside it. Never the Tier List's overall rating, which put Icathia's Fall
 * (0.3% of Yasuo games) at the top of Yasuo's list. The champion page and the quick builds (overlay, watch) both
 * rank with it, so they always agree.
 */
export function championAugmentScores(_alias: string, augments: Pick<AugmentRow, "id" | "pickRate" | "grade">[]): Map<number, number> {
  const out = new Map<number, number>();
  const groups = new Map<string, typeof augments>();
  for (const a of augments) {
    const g = a.grade && BANDS[a.grade] ? a.grade : "";
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  for (const [g, list] of groups) {
    const [lo, hi] = BANDS[g] ?? NO_GRADE;
    const sorted = [...list].sort((x, y) => y.pickRate - x.pickRate);
    sorted.forEach((a, i) => out.set(a.id, Math.round(sorted.length > 1 ? hi - ((hi - lo) * i) / (sorted.length - 1) : (lo + hi) / 2)));
  }
  return out;
}
