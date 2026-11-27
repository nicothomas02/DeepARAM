import { T } from "@/components/I18n";
import { forecastScorecard } from "@/lib/analysis";
import { patchName } from "@/lib/patch-name";
import {
  patchImpactSummary,
  simulatorValidation,
  NOTEBOOK_REPO,
} from "@/lib/research";
import { scorecard } from "@/lib/scorecard";

// The Methodology page's Research tab (/research opens it). Nico 2026-11-27: a portfolio-grade write-up of the
// studies behind the site, plus a public track record of how our picks and pre-patch forecasts held up.
// Each study: question, method, result with its uncertainty, what changed on the site, limits. Site rules: no data
// sources or backend, no augment win rates (aggregates only), no mention of which AI model helped. The fixed
// figures of the seven newer studies come from the executed notebooks (portfolio repo, 2026-11-27); the track record
// and the three older studies read the daily analysis files. New English text has no translations yet, so other
// languages show it in English (the i18n test only checks keys that en.json lists).
const NS = "research";

type StudyProps = {
  id?: string;
  title: React.ReactNode;
  q: React.ReactNode;
  m: React.ReactNode;
  r: React.ReactNode;
  figure?: React.ReactNode;
  changed?: React.ReactNode;
  l: React.ReactNode;
};

function Study({ id, title, q, m, r, figure, changed, l }: StudyProps) {
  return (
    <article className="card prose research-study" id={id}>
      <h3 className="research-q">{title}</h3>
      <h4>
        <T ns={NS}>Question</T>
      </h4>
      <p>{q}</p>
      <h4>
        <T ns={NS}>Method</T>
      </h4>
      <p>{m}</p>
      <h4>
        <T ns={NS}>Result</T>
      </h4>
      <p>{r}</p>
      {figure}
      {changed && (
        <>
          <h4>
            <T ns={NS}>What changed</T>
          </h4>
          <p>{changed}</p>
        </>
      )}
      <h4>
        <T ns={NS}>Limits</T>
      </h4>
      <p>{l}</p>
    </article>
  );
}

/** Two to four bars on one scale, the first one the method, the rest baselines. Values in points. */
function Bars({
  label,
  rows,
  unit = "pts",
}: {
  label: string;
  rows: { name: string; value: number }[];
  unit?: string;
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <figure className="research-bars" aria-label={label}>
      <figcaption>
        <T ns={NS}>{label}</T>
      </figcaption>
      {rows.map((r, i) => (
        <div key={r.name} className="research-bar">
          <span>
            <T ns={NS}>{r.name}</T>
          </span>
          <span className="research-track">
            <span
              className={i === 0 ? "research-fill lead" : "research-fill"}
              style={{
                width: `${Math.max(2, (100 * Math.abs(r.value)) / max)}%`,
              }}
            />
          </span>
          <b>
            {r.value > 0 ? "+" : ""}
            {r.value.toFixed(r.value % 1 === 0 ? 0 : 1)}
            {unit === "%" ? "%" : ""}
          </b>
        </div>
      ))}
    </figure>
  );
}

const share = (x: number) => `${Math.round(100 * x)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}`;

function TrackRecord() {
  const picks = scorecard();
  const fc = forecastScorecard();
  if (!picks.length && !fc) return null;
  return (
    <article className="card prose research-study" id="track-record">
      <h3 className="research-q">
        <T ns={NS}>Track record</T>
      </h3>
      <p>
        <T ns={NS}>
          Every patch we check our own calls against games they never saw.
          Picks: each champion&apos;s top 5 augments and top 3 items by
          DeepScore, scored on the next patch, with the most picked ones as the
          baseline. Forecasts: the expected shift of every champion changed on
          the test server, saved before the patch goes live and graded after a
          week of live games. Updated automatically; bad results stay up.
        </T>
      </p>
      {picks.length > 0 && (
        <>
          <h4>
            <T ns={NS}>Did our picks hold up?</T>
          </h4>
          <div className="research-table-wrap">
            <table className="research-table">
              <thead>
                <tr>
                  <th>
                    <T ns={NS}>Patch</T>
                  </th>
                  <th>
                    <T ns={NS}>Top augments still ahead</T>
                  </th>
                  <th>
                    <T ns={NS}>Most picked</T>
                  </th>
                  <th>
                    <T ns={NS}>Top items still ahead</T>
                  </th>
                  <th>
                    <T ns={NS}>Most bought</T>
                  </th>
                </tr>
              </thead>
              <tbody>
                {picks.map((p) => (
                  <tr key={p.from}>
                    <td>
                      {patchName(p.from)} → {patchName(p.to)}
                      {p.to_partial && (
                        <>
                          {" "}
                          <span className="chip">
                            <T ns={NS}>So far</T>
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      {p.augments
                        ? `${share(p.augments.deepscore.hit)} (${pts(p.augments.deepscore.lead)})`
                        : ""}
                    </td>
                    <td className="muted">
                      {p.augments
                        ? `${share(p.augments.popular.hit)} (${pts(p.augments.popular.lead)})`
                        : ""}
                    </td>
                    <td>
                      {p.items
                        ? `${share(p.items.deepscore.hit)} (${pts(p.items.deepscore.lead)})`
                        : ""}
                    </td>
                    <td className="muted">
                      {p.items
                        ? `${share(p.items.popular.hit)} (${pts(p.items.popular.lead)})`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="research-note">
            <T ns={NS}>
              Share of picks that still beat the champion&apos;s average next
              patch, and by how many win-rate points on average. Holding up is
              not proof a pick causes the wins.
            </T>
          </p>
        </>
      )}
      {fc && (fc.patches.length > 0 || fc.waiting.length > 0) && (
        <>
          <h4>
            <T ns={NS}>Did we call it?</T>
          </h4>
          {fc.patches.map((p) => (
            <p key={p.patch}>
              <T
                ns={NS}
                v={{
                  patch: patchName(p.patch),
                  n: p.summary.n,
                  mae: p.summary.mae_pts.toFixed(2),
                  base: p.summary.no_change_mae_pts.toFixed(2),
                  right: p.summary.direction.right,
                  of: p.summary.direction.of,
                  in50: share(p.summary.in50),
                  in95: share(p.summary.in95),
                }}
              >
                {
                  "{patch}: {n} champions forecast. Typical miss {mae} points against {base} for guessing no change; direction right for {right} of {of}; {in50} landed in the 50% range and {in95} in the 95% range."
                }
              </T>{" "}
              <b>
                {p.summary.beat_no_change ? (
                  <T ns={NS}>Beat the no-change guess.</T>
                ) : (
                  <T ns={NS}>
                    No better than guessing no change on this patch.
                  </T>
                )}
              </b>
            </p>
          ))}
          {fc.waiting.map((w) => (
            <p key={w.patch} className="research-note">
              <T
                ns={NS}
                v={{
                  patch: patchName(w.patch),
                  n: w.champions,
                  day: w.day,
                  of: w.of,
                }}
              >
                {
                  "{patch}: forecast saved for {n} champion(s) before release; graded after {of} live days (day {day} of {of})."
                }
              </T>
            </p>
          ))}
        </>
      )}
    </article>
  );
}

export default function ResearchStudies() {
  const impact = patchImpactSummary();
  const sim = simulatorValidation();
  const f2 = (x: number) => x.toFixed(2);
  return (
    <section id="research" className="research">
      <h2 className="research-head">
        <T ns={NS}>Research: the questions behind the numbers.</T>
      </h2>
      <p className="muted">
        <T ns={NS}>
          Each study asks a question the site depends on and answers it on games
          the method never saw: rank on one patch, check on the next. Every
          result comes with its uncertainty, what we changed because of it, and
          its limits, including the ones that came back &quot;no effect&quot;.
        </T>
      </p>
      <TrackRecord />

      <Study
        id="ranking"
        title={<T ns={NS}>Ranking options that rest on 300 games or 300,000</T>}
        q={
          <T ns={NS}>
            A champion can take around 150 augments, some with hundreds of
            thousands of games on that champion and some with a few hundred. How
            do you rank them so the top of the list is still on top next patch?
          </T>
        }
        m={
          <T ns={NS}>
            Each option is measured against its own champion&apos;s average,
            which removes champion strength. Its lead is then shrunk toward that
            average in proportion to its noise (empirical Bayes: the true spread
            of leads is estimated from the list itself), and one typical
            next-patch miss is subtracted, so a thin row can&apos;t top a list
            on luck. Every rule was replayed on four patch changes: rank on one
            patch, score on the next. To imitate a patch&apos;s first day, the
            ranking patch was also resampled at 10% of its games.
          </T>
        }
        r={
          <T ns={NS}>
            Each champion&apos;s top 5 augments led its average by 4.2 to 5.4
            win-rate points on the next patch, against 0.9 to 1.6 for the five
            most picked, and 99.8% to 100% of them still beat the average,
            against 64% to 76%. With first-day amounts of data, the top pick
            still held up 99.6% of the time after shrinkage, against 92% for the
            raw win rate.
          </T>
        }
        figure={
          <Bars
            label="Next-patch lead of each champion's top 5 augments (26.22 to 26.23, win-rate points)"
            rows={[
              { name: "DeepScore", value: 5.4 },
              { name: "Most picked", value: 1.6 },
            ]}
          />
        }
        changed={
          <T ns={NS}>
            DeepScore ranks every list on the site and in the apps this way, and
            the replay now runs every patch (Track record, above).
          </T>
        }
        l={
          <T ns={NS}>
            A lead shows that players who chose an option won more, not that the
            option caused it. Rows also move between patches by more than
            sampling noise alone, which is why the ranking discounts
            patch-to-patch drift as well as small samples.
          </T>
        }
      />

      <Study
        id="enough-data"
        title={<T ns={NS}>How much data is enough?</T>}
        q={
          <T ns={NS}>
            How many games should a choice need before it can be a
            champion&apos;s default? Should thin rows borrow from earlier
            patches? And for high-skill players, are high-skill games alone the
            best guide?
          </T>
        }
        m={
          <T ns={NS}>
            Three next-patch backtests. Minimums from 0 to 30,000 games were
            scored as a paired difference against the most common choice.
            Pooling combined each row with up to two earlier patches, weighted
            by precision and halved per patch back, behind a gate that drops an
            earlier patch whose lead differs by more than 4 standard errors; the
            gate was tested by planting 8-point changes in 5% of rows.
            Skill-bracket rankings were compared with all players and a 50/50
            blend.
          </T>
        }
        r={
          <T ns={NS}>
            A 100-game minimum picked defaults that beat the most common choice
            by 2.3 and 3.2 points next patch, against 1.0 and 1.5 for a
            1,000-game minimum: the score already marks thin rows down, so a
            high bar throws away real edges. Pooling roughly halved the error on
            small rows when the live patch was thin. Without the gate, the error
            on changed rows was 25 to 60 times larger. The 50/50 bracket blend
            was at least as good as either source on both patch changes.
          </T>
        }
        figure={
          <Bars
            label="Default spell pair's next-patch gain over the most common pair (26.22 to 26.23, points)"
            rows={[
              { name: "100-game minimum", value: 3.2 },
              { name: "1,000-game minimum", value: 1.5 },
              { name: "10,000-game minimum", value: 0.4 },
            ]}
          />
        }
        changed={
          <T ns={NS}>
            Spell pairs lead from 100 games; augments and spell pairs pool up to
            two earlier patches behind the 4-standard-error gate; the Tier
            List&apos;s skill brackets use the 50/50 blend.
          </T>
        }
        l={
          <T ns={NS}>
            Two to four patch changes per test. A planted change shows the gate
            works for the failure it exists for, not that every real change is
            caught.
          </T>
        }
      />

      <Study
        id="ahead-bias"
        title={
          <T ns={NS}>
            Do strong picks just come from players who are already winning?
          </T>
        }
        q={
          <T ns={NS}>
            Augments after the first are picked mid-game. If the team that is
            already ahead tends to take certain augments, those augments look
            stronger than they are.
          </T>
        }
        m={
          <T ns={NS}>
            About 1,250 complete games with minute-by-minute timelines (33,696
            picks, names removed, aggregate results only). A logistic model
            predicts each pick&apos;s win from the game state at that moment:
            kill, gold and level difference. Each augment&apos;s adjusted lift
            is its pickers&apos; wins minus what their state predicted. On
            simulated data with a known answer, the same method removed a
            planted bias.
          </T>
        }
        r={
          <T ns={NS}>
            The game state predicts wins well (AUC 0.68), yet it barely changes
            which augments look strong. The median shift is 0 points, 90% of
            augments move less than 1.7 points, every shift is within about one
            standard error, and the ranking before and after correction agrees
            closely (rank correlation 0.93). The one steady pattern: defensive
            items are bought when behind and look 2 to 3 points worse than they
            are.
          </T>
        }
        changed={
          <T ns={NS}>
            No game-state correction to DeepScore. Counter items are judged by
            what they do, never by their win rate (next study).
          </T>
        }
        l={
          <T ns={NS}>
            It removes only what the game state measures. Anything else that
            drives both the pick and the win, such as player skill, stays.
          </T>
        }
      />

      <Study
        id="counter-items"
        title={<T ns={NS}>Do counter items work?</T>}
        q={
          <T ns={NS}>
            Magic resist against mages, armor against marksmen, anti-heal
            against healers: do these counters change anything in Mayhem?
          </T>
        }
        m={
          <T ns={NS}>
            The same games, 61,751 item decisions. First, do players switch when
            the trigger is there? Hundreds of trigger and item pairs were
            scanned, so the bar came from shuffling each game&apos;s enemy team
            onto another game, not from a fixed cut-off. Then each buyer was
            matched to players who bought something else in the same slot and
            class, at the same minute and win chance, in other games. The same
            comparison without the trigger is a placebo, and the counter&apos;s
            effect is the difference between the two. Outcomes: win chance 3
            minutes later, and what the item is meant to change, the share of
            damage taken of the countered type.
          </T>
        }
        r={
          <T ns={NS}>
            No counter moves win chance by a detectable amount (effects under
            about 2 points can&apos;t be seen at this size). On what the item is
            meant to do, several clearly work: against magic-heavy teams, Kaenic
            Rookern cut the share of magic damage taken by 11 points (placebo
            6), Spirit Visage by 6 (placebo 1), Mercury&apos;s Treads by 5
            (placebo +2), and armor items cut physical damage taken against two
            or more marksmen. Plated Steelcaps, anti-crit items and anti-heal
            didn&apos;t show it.
          </T>
        }
        figure={
          <Bars
            label="Change in share of magic damage taken vs magic-heavy teams, beyond placebo (points)"
            rows={[
              { name: "Kaenic Rookern", value: -5 },
              { name: "Spirit Visage", value: -5 },
              { name: "Mercury's Treads", value: -7 },
              { name: "Magic resist items", value: -4 },
            ]}
          />
        }
        changed={
          <T ns={NS}>
            Items that pass become situational swaps for their trigger; the rest
            stay as pointers. Armor&apos;s trigger changed from &quot;mostly
            physical damage&quot; to auto-attackers.
          </T>
        }
        l={
          <T ns={NS}>
            Matching covers only what was measured, and with many tests a single
            range that just excludes zero is not convincing. Shield and
            crowd-control counters can&apos;t be tested: the data has no stat
            for them.
          </T>
        }
      />

      <Study
        id="engine"
        title={<T ns={NS}>Does the in-game advice win games?</T>}
        q={
          <T ns={NS}>
            The desktop app highlights the best augment cards during a game. Do
            players who take what it rates highly win more, once the game state
            is accounted for?
          </T>
        }
        m={
          <T ns={NS}>
            9,399 real picks from 251 recent games were replayed through
            today&apos;s engine, which never saw their results. A logistic model
            of winning on the game state at the pick plus each layer&apos;s
            score shows whether each layer adds anything. Before that, the
            method recovered a planted effect on simulated picks.
          </T>
        }
        r={
          <T ns={NS}>
            The base score works: each DeepScore point adds 0.043 to the
            log-odds of winning (z = 5.0). Picks in the top quarter of the
            engine&apos;s ranking won 2.2 points more than their game state
            predicted, the bottom quarter 2.4 points less. Augment pairs were
            too rare to measure, and the combo layer too small to matter. Two
            proposed layers, augments given your items and augments against the
            enemy team, failed to replicate between random halves of the data
            and were not shipped.
          </T>
        }
        figure={
          <Bars
            label="Wins beyond the game state's prediction, by the engine's ranking of the pick (points)"
            rows={[
              { name: "Top quarter", value: 2.2 },
              { name: "Bottom quarter", value: -2.4 },
            ]}
          />
        }
        changed={
          <T ns={NS}>
            When the top cards&apos; ranges overlap, the app now says either is
            fine instead of implying a clear first.
          </T>
        }
        l={
          <T ns={NS}>
            Observational: players who take what the engine likes may also play
            better. The app now reads the cards on offer, so the next version
            compares picks within the same offer.
          </T>
        }
      />

      <Study
        id="forecast"
        title={<T ns={NS}>Can test-server changes predict the live patch?</T>}
        q={
          <T ns={NS}>
            Before a patch ships, can we say how much each changed
            champion&apos;s win rate will move?
          </T>
        }
        m={
          <T ns={NS}>
            A regression on the measured effects of past patch changes, checked
            by leaving out each past patch in turn. The forecast is saved before
            release and never edited, then graded after a week of live games:
            each champion&apos;s change minus the average change of the
            champions nobody touched.
          </T>
        }
        r={
          <T ns={NS}>
            In the back-test it beat guessing no change by 12% (typical miss
            1.70 against 1.94 points). On its first live patch it didn&apos;t: a
            typical miss of 0.68 points against 0.66, direction right for 9 of
            13 champions. The forecasts were about twice too large and the
            ranges too wide, because that patch&apos;s changes were smaller than
            past ones.
          </T>
        }
        changed={
          <T ns={NS}>
            The grade is public under Track record and on the test-server tab,
            good or bad. Shrinking forecasts and narrowing ranges waits until
            three patches are graded, so the fix is fitted on more than one
            patch.
          </T>
        }
        l={
          <T ns={NS}>
            Thirteen champions is a small sample. Win rates also move for
            reasons the notes don&apos;t list.
          </T>
        }
      />

      <Study
        id="head-to-head"
        title={<T ns={NS}>Do our picks beat other ways of ranking?</T>}
        q={
          <T ns={NS}>
            Other ARAM Mayhem tools rank the same kind of numbers differently.
            On the same data, does DeepScore pick better augments and defaults
            than their rules?
          </T>
        }
        m={
          <T ns={NS}>
            Every rule ranks one patch and is scored on the next. The rules: a
            win rate smoothed toward the champion with 300 prior games, the
            highest raw win rate among options with at least 3% of players and
            1,000 games, the highest raw win rate among options with a tenth of
            the top option&apos;s games, and the most played option. Augments
            are replayed as random three-card offers over four patch changes;
            spell pairs, boots and items as one default per champion. The same
            replays run on the full patch and on 10% and 2% of its games, like
            the first hours of a patch. Differences are paired by champion, with
            95% ranges.
          </T>
        }
        r={
          <T ns={NS}>
            On augment offers DeepScore and the smoothed win rate take almost
            the same card on full data. On thin data DeepScore gains 0.06 points
            per pick at 10% of games and 0.16 at 2%, and both beat taking the
            most played card by about 1.2 points. Defaults are where rules
            differ: next patch, our spell pairs led by 2.0 to 2.9 points more
            than the raw win rate behind a popularity filter, boots by 0.9 and
            items by 1.8. We also lost somewhere: ranking only 2% of a
            patch&apos;s games, our spell pairs and boots did 0.1 to 0.2 points
            worse, because few options reach our game minimums that early. With
            the previous patch pooled in, as the site does, spell pairs instead
            led by 2.7 points; boots can&apos;t be checked that way yet.
          </T>
        }
        figure={
          <Bars
            label="A default's lead next patch, full patch (points over the champion's average)"
            rows={[
              { name: "Spell pairs: DeepScore", value: 3.0 },
              {
                name: "Spell pairs: raw win rate, 3% + 1,000 games",
                value: 0.5,
              },
              { name: "Spell pairs: most played", value: 0.3 },
              { name: "Items: DeepScore", value: 4.6 },
              { name: "Items: raw win rate, tenth of the top", value: 2.8 },
              { name: "Items: most played", value: 0.4 },
            ]}
          />
        }
        changed={
          <T ns={NS}>
            Augments now also lean on how each augment does on other
            champions. In the same replay, with pooling, that kept offers at
            least as good and put the champion&apos;s top five augments ahead of
            the smoothed rule early in a patch (0.04 to 0.05 points, ranges
            above zero) and level with it on full data. Boots in a patch&apos;s
            first hours get the same pooling check once there is a second patch
            of boots data.
          </T>
        }
        l={
          <T ns={NS}>
            This compares ranking rules on one dataset, not whole sites, which
            also differ in data and dates. A lead next patch is a correlation:
            an option can keep leading because of who picks it. Cores
            aren&apos;t scored because the next patch&apos;s core counts
            aren&apos;t out yet.
          </T>
        }
      />

      <Study
        title={<T ns={NS}>How much does the draft decide?</T>}
        q={
          <T ns={NS}>
            Once both teams are locked in, how well do the ten champions predict
            who wins?
          </T>
        }
        m={
          <T ns={NS}>
            We compared four models with a baseline that always picks the blue
            side: one number per team (the sum of each champion&apos;s patch win
            rate), team make-up, a rating per champion, and boosted trees. Games
            come from players who chose to share them, with names removed. Every
            score is measured on games the model hadn&apos;t seen (5-fold
            cross-validation, repeated 10 times), with 95% ranges.
          </T>
        }
        r={
          <T ns={NS}>
            The draft matters, a little. The best model gets 60% of games right
            against 54% for always picking blue, and its AUC is 0.61 (95% range
            0.58 to 0.65, where 0.50 is a coin flip). Shuffling the results and
            retraining beats it about 1 time in 300. The simplest model won: one
            number per team did as well as the detailed ones. Where the draft
            edge is clearest (a third of games) the favourite wins about 64%; in
            the closest third, 55%.
          </T>
        }
        l={
          <T ns={NS}>
            1,081 games is a small sample for a five-versus-five game, so the
            ranges are wide, and they come from a small group of players. The
            model ignores augments, items and skill on purpose. We rerun it as
            more games arrive.
          </T>
        }
      />
      {impact && (
        <Study
          title={<T ns={NS}>Did the buff work?</T>}
          q={
            <T ns={NS}>
              When the patch notes change a champion, does its win rate move by
              more than chance?
            </T>
          }
          m={
            <T ns={NS}>
              Each change is compared with what the untouched champions did over
              the same patch change (a difference in differences), and judged
              against how far an untouched champion typically moves. Changes are
              also sized as Mayhem modifiers, to estimate what each kind of
              change is worth.
            </T>
          }
          r={
            <T
              ns={NS}
              v={{
                n: impact.changes,
                p: impact.patches,
                w: impact.worked,
                o: impact.opposite,
                r: impact.rest,
                pts: impact.pts.toFixed(1),
                lo: impact.ci[0].toFixed(1),
                hi: impact.ci[1].toFixed(1),
              }}
            >
              {
                "Across {n} changes in {p} patches, {w} moved the champion the intended way beyond noise, {o} moved it the opposite way, and {r} stayed within noise or had no clear intent. A 5% damage-dealt modifier is worth about {pts} win-rate points (likely range {lo} to {hi})."
              }
            </T>
          }
          l={
            <T ns={NS}>
              A win rate also moves for reasons the notes don&apos;t list, such
              as item and augment changes, new tricks and hotfixes. Many changes
              bundle several lines, so the value of each kind is rough, and
              small changes can&apos;t be told from noise.
            </T>
          }
        />
      )}
      {sim && (
        <Study
          title={<T ns={NS}>Does the Simulator match real games?</T>}
          q={
            <T ns={NS}>
              Does the Simulator rank champions&apos; damage the way real games
              do?
            </T>
          }
          m={
            <T ns={NS}>
              For every champion, the Simulator&apos;s damage per second on its
              most-played build is compared with its share of damage in real
              games. Agreement is the rank correlation (Spearman) with a 95%
              range from 2,000 resamples, and a role-adjusted model is scored
              leave-one-out. Every past Simulator version is replayed with
              today&apos;s yardstick, so progress is measured, not claimed.
            </T>
          }
          r={
            <T
              ns={NS}
              v={{
                n: sim.n,
                rho: f2(sim.rho),
                lo: sim.ci ? f2(sim.ci[0]) : "",
                hi: sim.ci ? f2(sim.ci[1]) : "",
                radj: f2(sim.adjusted),
                slope: f2(sim.slope),
                v: sim.versions,
                first: f2(sim.first),
                last: f2(sim.last),
              }}
            >
              {
                "Across {n} champions the rank correlation is {rho} (95% range {lo} to {hi}). Adjusting for role lifts it to {radj}, and predicted damage shares line up with real ones with a calibration slope of {slope} (1.00 is perfect). Over {v} Simulator versions it has climbed from {first} to {last}."
              }
            </T>
          }
          l={
            <T ns={NS}>
              Real damage share depends on how people play, not only on the
              champion, so a perfect score is out of reach. Within a single role
              the groups are small and the ranges wide. It checks damage, not
              whether a build is good.
            </T>
          }
        />
      )}
      {NOTEBOOK_REPO && (
        <p className="muted">
          <a className="inline-link" href={NOTEBOOK_REPO}>
            <T ns={NS}>Code, notebooks and tests for these studies</T>
          </a>
        </p>
      )}
    </section>
  );
}
