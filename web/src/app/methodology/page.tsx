import type { Metadata } from "next";
import Intro from "@/components/Intro";
import { T } from "@/components/I18n";
import { pageMeta } from "@/lib/meta";
import { damageDealtWorth, doseResponse, gameLength, itemLiftSummary, pbeForecast, playstyleClusters, typicalSettling } from "@/lib/analysis";

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
  const worth = damageDealtWorth();
  const dose = doseResponse();
  const settling = typicalSettling();
  const clusters = playstyleClusters();
  const model = pbeForecast()?.model;
  const lift = itemLiftSummary();
  const length = gameLength();
  const five = lift?.archive?.rows.find((r) => r.completed === 5);
  const three = lift?.archive?.rows.find((r) => r.completed === 3);
  const pct = (x: number | null | undefined) => (x === null || x === undefined ? "" : Math.round(100 * x));
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
          <T ns={NS}>Did a patch change work?</T>
        </h2>
        <p>
          <T ns={NS}>
            Each champion change in the patch notes is judged with a difference in differences: the champion&apos;s win-rate change from the previous patch, minus the change every untouched champion made at the same time. That removes shifts the whole list made, such as a new augment pool. The spread of the untouched champions&apos; changes is the noise floor: a change only counts as having worked when the champion moved further than an unchanged one typically does.
          </T>
        </p>
        {worth && dose?.buffs && dose.nerfs && (
          <p>
            <T
              ns={NS}
              v={{ n: worth.n, pts: worth.pts.toFixed(1), lo: worth.ci[0].toFixed(1), hi: worth.ci[1].toFixed(1), buffs: Math.round(100 * (dose.buffs.share_positive ?? 0)), nerfs: Math.round(100 * (dose.nerfs.share_negative ?? 0)) }}
            >
              {"Across {n} changes so far, a 5% damage-dealt modifier is worth about {pts} win-rate points (likely range {lo} to {hi}); {buffs}% of buffs and {nerfs}% of nerfs moved the champion the intended way beyond noise."}
            </T>
          </p>
        )}
        <h2>
          <T ns={NS}>How fast a patch settles</T>
        </h2>
        <p>
          <T ns={NS}>
            The daily stats add up every game since the patch began, so each day&apos;s ranking is compared with the patch&apos;s final one. A champion whose later games go far better or worse than its earlier ones, well beyond what the rest of the list did the same day, is flagged as a mid-patch shift: a hotfix, or a trick players found. The day split assumes games are spread evenly over the patch, so treat a single flag as a lead, not proof.
          </T>
        </p>
        {settling && settling.spearman.length > 0 && (
          <p>
            <T ns={NS} v={{ pct: Math.round(100 * settling.spearman[0]), pts: settling.mad_pts[0].toFixed(2) }}>
              {"A typical patch's day-one ranking already matches {pct}% of its final order, {pts} points off on average."}
            </T>
          </p>
        )}
        <h2>
          <T ns={NS}>Playstyles</T>
        </h2>
        <p>
          <T ns={NS}>
            Champions are grouped by how their Mayhem games go rather than by class: share of the team&apos;s damage, damage soaked, kill participation, time dead and which augments they take, averaged over recent patches. The groups come from k-means clustering (the number of groups picked by silhouette score) and a two-axis map from principal components. A champion whose class is rare in its group is marked as playing unlike its class.
          </T>
        </p>
        {clusters && (
          <p>
            <T ns={NS} v={{ k: clusters.k, s: clusters.silhouette.toFixed(2) }}>{"Currently {k} groups (silhouette {s}: the groups are broad, not sharp)."}</T>
          </p>
        )}
        <h2>
          <T ns={NS}>Expected effect of a test-server change</T>
        </h2>
        <p>
          <T ns={NS}>
            A regression fitted on the measured effects of past patch-note changes (size of each Mayhem modifier change, summed ability changes) predicts what a listed change should do before it ships. It is checked by leaving each past patch out in turn and predicting it, and reported against the simplest guesses: no change at all, and the average buff or nerf. The test-server page shows it only while it beats them.
          </T>
        </p>
        {model?.cv_mae_pts && model.baseline_no_change_mae_pts && (
          <p>
            <T ns={NS} v={{ n: model.n, mae: model.cv_mae_pts.toFixed(1), base: model.baseline_no_change_mae_pts.toFixed(1) }}>
              {"Fitted on {n} changes; typical miss {mae} points, against {base} for assuming no change."}
            </T>
          </p>
        )}
        <h2>
          <T ns={NS}>Item boosts without the long-game effect</T>
        </h2>
        <p>
          <T ns={NS}>
            Item win rates come from builds players finished, so each one carries the same effect of the game having run long enough to finish a build. The usual boost compares the item with the champion&apos;s overall win rate, which mixes that in. The item pages also show a boost measured against the same champion&apos;s other finished builds, so the item is judged against builds that were completed under the same conditions. Legendary items are ranked both ways and the ones that move far are the ones the finished-build effect flattered or hid.
          </T>
        </p>
        {lift && lift.premium.share_positive !== null && (
          <p>
            <T ns={NS} v={{ n: lift.premium.champions, mean: lift.premium.mean.toFixed(1), sd: lift.premium.sd.toFixed(1), pos: pct(lift.premium.share_positive), moved: lift.moved, ranked: lift.ranked }}>
              {"Across {n} champions a finished build wins {mean} points more than the champion overall on average, but that varies by {sd} points from champion to champion ({pos}% of them finish builds in better games), which is why the comparison matters per item: {moved} of {ranked} legendary items move ten places or more between the two rankings."}
            </T>
          </p>
        )}
        {lift?.archive && five && three && (
          <p>
            <T ns={NS} v={{ games: lift.archive.games, five: pct(five.win_rate), lo: pct(five.ci[0]), hi: pct(five.ci[1]), three: pct(three.win_rate) }}>
              {"A check against one player's own archive of {games} games points the same way: games that ended with five completed legendary items were won {five}% of the time (likely range {lo} to {hi}), against {three}% with three, so finishing a build is not in itself a sign the game is going well."}
            </T>
          </p>
        )}
        <h2>
          <T ns={NS}>How long games last</T>
        </h2>
        <p>
          <T ns={NS}>
            Game length is treated as a survival curve: the share of games still running at each minute, and from it the chance that a game still going at a given minute ends during it. Every game ends, so nothing is censored, and wins against losses and blue against red side are compared with a log-rank test. The numbers come from one player&apos;s own archive of games, not from every game played, so they describe a typical experience rather than the whole mode.
          </T>
        </p>
        {length && length.curves.all.median !== null && (
          <p>
            <T
              ns={NS}
              v={{
                games: length.games,
                median: length.curves.all.median.toFixed(1),
                q1: (length.curves.all.quartiles[0] ?? 0).toFixed(1),
                q3: (length.curves.all.quartiles[1] ?? 0).toFixed(1),
                h15: pct(length.curves.all.hazard[15]),
                h20: pct(length.curves.all.hazard[20]),
                h25: pct(length.curves.all.hazard[25]),
                p: length.compare.win_vs_loss.p.toFixed(2),
              }}
            >
              {"Over {games} games, half were over by minute {median} (the middle half ended between minutes {q1} and {q3}). A game still running at minute 15 has a {h15}% chance of ending in that minute, rising to {h20}% at minute 20 and {h25}% at 25: the longer a game runs, the sooner it tends to close. Wins and losses last the same (log-rank p = {p})."}
            </T>
          </p>
        )}
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
