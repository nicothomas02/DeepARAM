"use client";

import { useT } from "@/components/I18n";
import { useBracket, type BracketKey } from "@/lib/bracket-pref";
import { patchName } from "@/lib/patch-name";

const LABEL: Record<Exclude<BracketKey, "all">, string> = { casual: "Casual", mid: "Mid", high: "Top 5%" };

/** The champion's win rate in each skill bracket, under the hero numbers (Nico 2026-11-23: brackets on the site too).
 *  The visitor's bracket (remembered with the Tier List's; Top 5% by default for the site owner) is marked, and
 *  tapping one picks it. `borrowed`: the patch the numbers come from when the live one has none yet. */
export default function BracketRates({ rates, borrowed }: { rates: Partial<Record<Exclude<BracketKey, "all">, [number, number]>>; borrowed: string | null }) {
  const t = useT("tier-list");
  const [bracket, setBracket] = useBracket();
  const keys = (Object.keys(LABEL) as Exclude<BracketKey, "all">[]).filter((k) => rates[k]);
  if (!keys.length) return null;
  const help =
    t("Skill brackets come from a rating built from game results, not official ranks.") +
    (borrowed ? " " + t("This patch has no skill bracket numbers yet, so they come from patch {patch}.", { patch: patchName(borrowed) }) : "");
  return (
    <div className="cp-brackets" role="group" aria-label={t("Skill bracket")}>
      <span className="cp-brackets-h" title={help}>
        {t("Skill bracket")}
        {borrowed && <small> ({patchName(borrowed)})</small>}
      </span>
      {keys.map((k) => (
        <button key={k} type="button" aria-pressed={bracket === k} onClick={() => setBracket(bracket === k ? "all" : k)}>
          <small>{t(LABEL[k])}</small> <b>{(rates[k]![0] * 100).toFixed(1)}%</b>
        </button>
      ))}
    </div>
  );
}
