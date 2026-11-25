"use client";

import { useT } from "./I18n";
import type { Effect } from "@/lib/mechanisms";
import { whatItDoesText } from "@/lib/mechanism-text";
import { tierOfScore } from "@/lib/deepscore-scale";

// A DeepScore badge: the 0-100 rating in a ring that fills with the score, coloured by its tier, with the tier letter
// beside the number (Nico 2026-11-24: "0-100 + tier letter" on every surface, one palette: lib/deepscore-scale.ts,
// globals.css --tier-*). Hovering, focusing or tapping it shows the shared explanation, what this list compares, and
// how far the pick sits above its list's average in win-rate points. `static` drops the button, for use inside a link.

export default function DeepScore({
  value,
  help,
  static: still,
  effects,
  edge,
}: {
  value: number;
  help?: string;
  /** Lead over the list's average in win-rate points (lib/deepscore.ts grade), added to the hover. */
  edge?: number;
  static?: boolean;
  /** What the pick directly changes (lib/mechanisms.ts), added under the help text. Explains, never re-ranks. */
  effects?: Effect[];
}) {
  const t = useT("tables");
  const tier = tierOfScore(value);
  const style = { "--ds": value } as React.CSSProperties;
  const label = t("DeepScore {n}, tier {t}", { n: value, t: tier });
  const what = effects?.length ? whatItDoesText(t, effects) : "";
  const pts = typeof edge === "number" ? t("About {pts} win-rate pts from this list's average.", { pts: `${edge > 0 ? "+" : edge < 0 ? "−" : "±"}${Math.abs(edge).toFixed(1)}` }) : "";
  const tip = help ? [t(help), pts, what].filter(Boolean).join("\n\n") : "";
  const body = (
    <>
      {value}
      <small className="ds-tier" aria-hidden="true">{tier}</small>
    </>
  );
  if (still || !help) {
    return (
      <span className="deepscore" data-tier={tier} style={style} aria-label={label}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" className="deepscore" data-tier={tier} style={style} data-tip={tip} aria-label={label} aria-description={tip}>
      {body}
    </button>
  );
}

/** A DeepScore inside a line of text ("69 S DeepScore"): the number in its tier's colour with the tier letter, for
 *  compact lists where a ring would crowd the row. Same scale and colours as the badge. */
export function DeepScoreInline({ value }: { value: number }) {
  const tier = tierOfScore(value);
  return (
    <b className="ds-inline" data-tier={tier}>
      {value}
      <small className="ds-tier">{tier}</small>
    </b>
  );
}
