"use client";

import { useNames, useT } from "@/components/I18n";

/** Why a high-scoring item isn't in the card's build: few players buy it (Nico 2026-11-23). Tap or hover for the
 *  reason, like the DeepScore badge. */
export const FEW_PLAYERS_WHY =
  "Scores well, but few players build it (under a quarter as often as the most built item), so the build keeps to items with a real following. Small samples swing, most of all early in a patch.";

/** Why a summoner spell pair without Flash can lead with few players (Nico 2026-11-24). */
export const FEW_PLAYERS_SPELL_WHY =
  "Scores best, but only {pct} of players take this pair and it has no Flash. A small group of players can skew a win rate, so it is riskier than a Flash pair.";

/** Champion-specific reasons for a rare leading spell pair (data/estimates/rare_spell_reasons.py, Nico 2026-11-25):
 *  the kit's likely why, shown only where three patches of real games back the pair's edge. ARAM's 70 summoner spell
 *  haste puts Barrier (180 s) at about 106 s and Flash (300 s) at about 176 s. */
export const SPELL_KIT: Record<string, string> = {
  escape:
    "{name}'s {key} already does much of Flash's job, so Barrier takes the slot: in ARAM it is back about every 106 s, Flash every 176 s. Ghost covers kiting.",
  nodash:
    "{name} has no escape dash, so Ghost is how {name} keeps distance while still hitting, and Barrier is back about every 106 s in ARAM vs Flash's 176 s.",
  reach: "{name} has no dash, so Ghost is how {name} reaches targets, and Barrier is back about every 106 s in ARAM vs Flash's 176 s.",
  stick: "{name} has no long dash, so Ghost keeps {name} on targets while Mark starts fights.",
  warpath: "{name}'s passive turns bonus move speed into attack damage, so Ghost adds damage as well as speed, and Mark starts fights.",
  engage: "{name}'s {key} already moves {name} onto targets, so Flash adds less; Mark adds a second way in and Ignite adds kill pressure.",
  barrels: "{name} has no dash, so Ghost and Heal's speed move {name} between barrels and out of fights.",
};
export const SPELL_HOLDS =
  "It won {pts} pts more than {name}'s average over the last {n} patches, but only {pct} of players take it, so part of that may be who picks it.";
export const SPELL_TIE =
  "About even with the usual Flash pair on recent patches (within 1 pt), so either is fine. Only {pct} of players take this pair.";
export const SPELL_MIXED =
  "Only {pct} of players take this pair and its lead swings from patch to patch, so treat it as close to the usual Flash pair.";

export type SpellWhy = { verdict: "holds" | "tie" | "mixed"; template: string | null; key: string; ability: string; edge: number | null; patches: number };

/** `augment`: the augment most of its buyers take (lib/build-plan.ts ITEM_CHANGERS), named in the reason.
 *  `spellPickRate`: a spell pair without Flash; the reason names its pick rate. `spellWhy` + `champion` (alias, English
 *  name): the champion's own reason for that pair. */
export default function FewPlayers({
  augment,
  spellPickRate,
  spellWhy,
  champion,
}: {
  augment?: string;
  spellPickRate?: number;
  spellWhy?: SpellWhy | null;
  champion?: { alias: string; name: string };
}) {
  const t = useT("champions");
  const names = useNames();
  let why: string;
  if (spellPickRate !== undefined) {
    const pct = `${(spellPickRate * 100).toFixed(spellPickRate < 0.01 ? 2 : 1)}%`;
    const name = champion ? names("champions", champion.alias, champion.name) : "";
    const kit = spellWhy?.template ? SPELL_KIT[spellWhy.template] : undefined;
    const key =
      spellWhy?.key && champion ? `${spellWhy.key} (${names("abilities", `${champion.alias}.${spellWhy.key}`, spellWhy.ability)})` : "";
    if (spellWhy?.verdict === "holds" && kit && spellWhy.edge !== null)
      why = `${t(kit, { name, key })} ${t(SPELL_HOLDS, { pts: spellWhy.edge.toFixed(1), name, n: spellWhy.patches, pct })}`;
    else if (spellWhy?.verdict === "tie") why = t(SPELL_TIE, { pct });
    else if (spellWhy?.verdict === "mixed") why = t(SPELL_MIXED, { pct });
    else why = t(FEW_PLAYERS_SPELL_WHY, { pct });
  } else why = augment ? `${t(FEW_PLAYERS_WHY)} ${t("Mostly built with {augment}.", { augment })}` : t(FEW_PLAYERS_WHY);
  return (
    <button type="button" className="aug-item-tag cp-few-tag" data-tip={why} aria-description={why}>
      {t("Few players")}
    </button>
  );
}
