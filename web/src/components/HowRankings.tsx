"use client";

import { useEffect, useRef } from "react";
import { useT } from "./I18n";
import { TIER_Z } from "@/lib/deepscore";
import { loadSettings } from "@/lib/settings";

// "How rankings work": a few plain lines on the numbers the Tier List and champion pages show (DeepScore and
// tiers, win rate boost, estimates, game counts). Closed in Simple view, open in Detailed (Settings > Page
// detail). A link to #how-rankings, like the one under each table's column hints, opens it.

export const RANKINGS_ID = "how-rankings";

/** Lowest DeepScore of a tier (lib/deepscore.ts grade: 50 + 15 per standard deviation). */
const cut = (tier: string) => Math.round(50 + 15 * TIER_Z.find(([t]) => t === tier)![1]);

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
    try {
      if (loadSettings().view === "detailed") el.open = true;
    } catch {}
    const onHash = () => {
      if (location.hash === `#${RANKINGS_ID}`) el.open = true;
    };
    onHash();
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return (
    <details className="how-rankings" id={RANKINGS_ID} ref={ref}>
      <summary>{t("How rankings work")}</summary>
      <ul>
        <li>{t("DeepScore rates each champion, augment, item or build from 0 to 100. 50 is average.")}</li>
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
        <li>{t("Game counts are approximate.")}</li>
      </ul>
    </details>
  );
}
