import "server-only";
import championIds from "@/data/champion-ids.json";
import { scoreRows, type AugmentRow } from "./champion-page";
import { championEstimates } from "./estimates";

/**
 * Each of a champion's augments' DeepScore on that champion: its estimated win rate there (data/estimates), trusted
 * less when the champion rarely takes it, scored against the champion's other augments. Never the Tier List's overall
 * rating, which put Icathia's Fall (0.3% of Yasuo games) at the top of Yasuo's list (Nico, 2026-11-20). The champion
 * page and the quick builds (overlay, watch) both rank with it, so they always agree.
 */
export function championAugmentScores(alias: string, augments: Pick<AugmentRow, "id" | "pickRate">[]): Map<number, number> {
  const id = (championIds as Record<string, number>)[alias];
  const est = id === undefined ? null : championEstimates(id);
  return new Map(
    scoreRows(
      augments.flatMap((a) => {
        const e = est?.augments.get(a.id);
        return e ? [{ id: a.id, winRate: e.winRate, pickRate: a.pickRate }] : [];
      }),
    ).map((r) => [r.id, r.deepScore!]),
  );
}
