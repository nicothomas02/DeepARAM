"use client";

import { useT } from "@/components/I18n";

/** Why a high-scoring item isn't in the card's build: few players buy it (Nico 2026-11-23). Tap or hover for the
 *  reason, like the DeepScore badge. */
export const FEW_PLAYERS_WHY =
  "Scores well, but few players build it (under a quarter as often as the most built item), so the build keeps to items with a real following. Small samples swing, most of all early in a patch.";

/** Why a summoner spell pair without Flash can lead with few players (Nico 2026-11-24). */
export const FEW_PLAYERS_SPELL_WHY =
  "Scores best, but only {pct} of players take this pair and it has no Flash. A small group of players can skew a win rate, so it is riskier than a Flash pair.";

/** `augment`: the augment most of its buyers take (lib/build-plan.ts ITEM_CHANGERS), named in the reason.
 *  `spellPickRate`: a spell pair without Flash; the reason names its pick rate. */
export default function FewPlayers({ augment, spellPickRate }: { augment?: string; spellPickRate?: number }) {
  const t = useT("champions");
  const why =
    spellPickRate !== undefined
      ? t(FEW_PLAYERS_SPELL_WHY, { pct: `${(spellPickRate * 100).toFixed(spellPickRate < 0.01 ? 2 : 1)}%` })
      : augment
        ? `${t(FEW_PLAYERS_WHY)} ${t("Mostly built with {augment}.", { augment })}`
        : t(FEW_PLAYERS_WHY);
  return (
    <button type="button" className="aug-item-tag cp-few-tag" data-tip={why} aria-description={why}>
      {t("Few players")}
    </button>
  );
}
