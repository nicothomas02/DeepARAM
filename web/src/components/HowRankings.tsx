"use client";

import { useEffect, useRef } from "react";
import { useT } from "./I18n";
import { TIER_CUTS, tierCut } from "@/lib/deepscore-scale";

// "How rankings work": a few plain lines on the numbers the Tier List and champion pages show (DeepScore and
// tiers, win rate boost, estimates, game counts, small-sample tags and ± ranges). Starts closed (Nico, 2026-10-27). A link to #how-rankings,
// like the one under each table's column hints, opens it.

export const RANKINGS_ID = "how-rankings";

/** Lowest DeepScore of a tier (lib/deepscore-scale.ts). */
const cut = tierCut;

/** Opens the panel; for links to it, since following the same #hash twice doesn't fire hashchange. */
export function openRankings() {
  const el = document.getElementById(RANKINGS_ID);
  if (el instanceof HTMLDetailsElement) el.open = true;
}

export default function HowRankings() {
  const t = useT("tables");
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onHash = () => {
      if (location.hash === `#${RANKINGS_ID}`) el.open = true;
    };
    onHash();
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return (
    <>
    {/* Always-visible DeepScore legend (Nico 2026-11-24: easy for newcomers): the five tier colours with their cuts,
        and what 50 means. The same colours as every badge, chip and app number (lib/deepscore-scale.ts). */}
    <p className="ds-legend">
      <a href={`#${RANKINGS_ID}`} onClick={openRankings}>
        <b>DeepScore</b>
      </a>{" "}
      <span>{t("0-100 · 50 is the average of its own list")}</span>
      {TIER_CUTS.map(([tier, min]) => (
        <span key={tier} className="ds-legend-tier">
          <span className={`chip tier-${tier.toLowerCase()}`}>{tier}</span>
          {Number.isFinite(min) ? `${min}+` : `<${cut("C")}`}
        </span>
      ))}
    </p>
    <details className="how-rankings" id={RANKINGS_ID} ref={ref}>
      <summary>{t("How rankings work")}</summary>
      <ul>
        <li>{t("DeepScore rates each champion, augment, item or build from 0 to 100 against the rest of its own list: 50 is that list's average, so compare numbers within a list. Hover any DeepScore to see how far it sits from its list's average in win-rate points.")}</li>
        <li>
          {t("Tiers come from DeepScore: S is {s} and up, A {a} and up, B {b} and up, C {c} and up, D below.", {
            s: cut("S"),
            a: cut("A"),
            b: cut("B"),
            c: cut("C"),
          })}
        </li>
        <li>{t("It starts from win rate and trusts picks with few games less, so a rare pick needs a bigger edge to rank high.")}</li>
        <li>
          {t(
            "Win rate boost is how much more a pick wins than the rate it's compared with, such as the champion's own, in percentage points (pts): +2 pts turns 50% into 52%.",
          )}
        </li>
        <li>
          {t(
            "Varies by champion and Augment reliance are typical swings in pts: how much an augment's boost changes between champions, and how much a champion's win rate changes between augments.",
          )}
        </li>
        <li>{t("Numbers marked estimated are worked out from the stats we have, not counted game by game.")}</li>
        <li>
          {t(
            "Few games marks a win rate that could be off by more than 5 pts either way, so small differences there are likely noise. Under 10 games it says Too few games.",
          )}
        </li>
        <li>{t("With Page detail set to Detailed, win rates show a ± range: the true rate is within it 95% of the time.")}</li>
        <li>{t("Game counts are approximate.")}</li>
      </ul>
    </details>
    </>
  );
}
