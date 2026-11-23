"use client";

import { useT } from "@/components/I18n";

/** Why a high-scoring item isn't in the card's build: few players buy it (Nico 2026-11-23). Tap or hover for the
 *  reason, like the DeepScore badge. */
export const FEW_PLAYERS_WHY =
  "Scores well, but few players build it (under a quarter as often as the most built item), so the build keeps to items with a real following. Small samples swing, most of all early in a patch.";

export default function FewPlayers() {
  const t = useT("champions");
  return (
    <button type="button" className="aug-item-tag cp-few-tag" data-tip={t(FEW_PLAYERS_WHY)} aria-description={t(FEW_PLAYERS_WHY)}>
      {t("Few players")}
    </button>
  );
}
