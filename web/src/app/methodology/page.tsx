import type { Metadata } from "next";
import Intro from "@/components/Intro";
import { T } from "@/components/I18n";
import { pageMeta } from "@/lib/meta";

export const metadata: Metadata = pageMeta(
  "/methodology",
  "Methodology",
  "How DeepARAM's win rates, DeepScore tiers, estimates and Simulator work, in plain words.",
);

// How the numbers are made, in plain words (Nico's data-science plan, 2026-11-06). Methods only: never where
// the data comes from or what runs the site (site rule); the full pipeline write-up is docs/methodology.md in
// the repo. Add a section here when a new method ships (synergy finder, win model, confidence intervals).
const NS = "methodology";

export default function Methodology() {
  return (
    <>
      <Intro eyebrow={<T ns={NS}>Methodology</T>} title={<T ns={NS}>How DeepARAM turns games into rankings.</T>}>
        <T ns={NS}>The ideas behind the numbers on every page, in plain words. When a number is a guess rather than a count, the page says so.</T>
      </Intro>
      <article className="card prose">
        <h2>
          <T ns={NS}>Win rate and sample size</T>
        </h2>
        <p>
          <T ns={NS}>
            A win rate from a handful of games is mostly luck. DeepARAM never ranks a pick on its raw win rate: each win rate is pulled toward the average of its list, and the fewer games behind it, the harder it is pulled.
          </T>
        </p>
        <h2>
          <T ns={NS}>DeepScore</T>
        </h2>
        <p>
          <T ns={NS}>DeepScore turns that adjusted win rate into one rating from 0 to 100, where 50 is average.</T>
        </p>
        <ul>
          <li>
            <T ns={NS}>Confidence: the score uses the low end of the win rate&apos;s likely range, so a high win rate from few games can&apos;t outrank a slightly lower one from many.</T>
          </li>
          <li>
            <T ns={NS}>Recency: when several patches are combined, newer patches count for more.</T>
          </li>
          <li>
            <T ns={NS}>Spread: scores are measured against the rest of the list, 15 points per standard deviation, so a tier keeps its meaning as averages drift.</T>
          </li>
          <li>
            <T ns={NS}>Tiers: S, A, B, C and D are cut at fixed distances from average, which keeps them balanced from patch to patch.</T>
          </li>
        </ul>
        <h2>
          <T ns={NS}>Augments and pick bias</T>
        </h2>
        <p>
          <T ns={NS}>
            Strong champions take some augments more often, which can make those augments look better than they are. To correct for that, an augment&apos;s win rate is compared with what the champions who take it win anyway, so it only scores well if it beats what its usual players would win without it. Augments are ranked against others of the same rarity, since a selection only ever offers one rarity.
          </T>
        </p>
        <h2>
          <T ns={NS}>Win rate boost</T>
        </h2>
        <p>
          <T ns={NS}>Win rate boost is how much more a pick wins than the rate it is compared with, in percentage points (pts): +2 pts turns 50% into 52%.</T>
        </p>
        <h2>
          <T ns={NS}>Estimated numbers</T>
        </h2>
        <p>
          <T ns={NS}>Some numbers can&apos;t be counted game by game. They are worked out from the stats that can, and every page marks them as estimated. Treat them as a good guide, not a measurement.</T>
        </p>
        <h2>
          <T ns={NS}>The Simulator</T>
        </h2>
        <p>
          <T ns={NS}>
            The Simulator plays out fights with the game&apos;s own champion, item and ability numbers. It is a model, not a replay: good for comparing builds and spotting big gaps, and it can be off where the game has special cases. Anything built from it, such as simulated builds and upgrade picks, is labelled as simulated.
          </T>
        </p>
        <h2>
          <T ns={NS}>What the numbers can&apos;t tell you</T>
        </h2>
        <p>
          <T ns={NS}>A win rate says how often a pick wins, not why. Small samples, playstyle and who tends to pick what all move it. Use the rankings to find ideas, then test them in your own games.</T>
        </p>
        <h2>
          <T ns={NS}>More to come</T>
        </h2>
        <p>
          <T ns={NS}>New methods are added here as they ship.</T>
        </p>
      </article>
    </>
  );
}
