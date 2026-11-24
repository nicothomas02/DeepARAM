"use client";

import { useT } from "@/components/I18n";
import { useBracket, type BracketKey } from "@/lib/bracket-pref";
import { patchName } from "@/lib/patch-name";

const LABEL: Record<Exclude<BracketKey, "all">, string> = { casual: "Casual", mid: "Mid", high: "Top 5%" };

/** The skill bracket switch, right above the Augments list because it only re-ranks augments (Nico 2026-11-24: "put
 *  options above augments to indicate it only affects that"). Each bracket shows the champion's win rate in it. The
 *  visitor's bracket is remembered with the Tier List's. `active`: the live patch has bracket augment numbers; without
 *  them (a new patch) the choices are off, with a note. `borrowed`: the patch the win rates come from when the live
 *  one has none yet. */
export default function BracketRates({
  rates,
  borrowed,
  active,
  patch,
}: {
  rates: Partial<Record<Exclude<BracketKey, "all">, [number, number]>>;
  borrowed: string | null;
  active: boolean;
  patch: string;
}) {
  const t = useT("tier-list");
  const tc = useT("champions");
  const [bracket, setBracket] = useBracket();
  const keys = (Object.keys(LABEL) as Exclude<BracketKey, "all">[]).filter((k) => rates[k]);
  if (!keys.length) return null;
  const help =
    t("Skill brackets come from a rating built from game results, not official ranks.") +
    (borrowed ? " " + t("This patch has no skill bracket numbers yet, so they come from patch {patch}.", { patch: patchName(borrowed) }) : "");
  const on = active ? bracket : "all";
  return (
    <div className="cp-brackets" role="group" aria-label={t("Skill bracket")}>
      <span className="cp-brackets-h" title={help}>
        {t("Skill bracket")}
        {borrowed && <small> ({patchName(borrowed)})</small>}
      </span>
      <button type="button" aria-pressed={on === "all"} disabled={!active} onClick={() => setBracket("all")}>
        <small>{t("All players")}</small>
      </button>
      {keys.map((k) => (
        <button key={k} type="button" aria-pressed={on === k} disabled={!active} onClick={() => setBracket(k)}>
          <small>{t(LABEL[k])}</small> <b>{(rates[k]![0] * 100).toFixed(1)}%</b>
        </button>
      ))}
      {!active && <small className="cp-brackets-note">{tc("No skill bracket numbers for augments on {patch} yet.", { patch })}</small>}
    </div>
  );
}
