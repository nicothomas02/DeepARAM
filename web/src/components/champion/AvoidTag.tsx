"use client";

import { useT } from "@/components/I18n";

/** A red "Avoid" tag on D-tier spell pairs (Nico 2026-11-25, site only). Backtest, analysis/scoring/TIER_CUTS.md: on
 *  the next patch D-tier pairs won about 24 pts less than the champion's other pairs (16.19-16.23, held out); they
 *  are 0.06% of games, so the tag only shows in the full list. Tap or hover for the reason. */
export const AVOID_SPELL_WHY =
  "D tier: on past patches, spell pairs this low won far less than this champion's other pairs on the next patch too.";

export default function AvoidTag() {
  const t = useT("champions");
  const why = t(AVOID_SPELL_WHY);
  return (
    <button type="button" className="aug-item-tag cp-avoid-tag" data-tip={why} aria-description={why}>
      {t("Avoid")}
    </button>
  );
}
