import { T } from "@/components/I18n";
import { patchImpactSummary, simulatorValidation } from "@/lib/research";

// Three case studies (Nico 2026-11-12), on the Methodology page since 2026-11-24 (one page instead of two): question, method, result with its uncertainty, limits. Site rules: no
// data sources or backend, no augment win rates, no mention of which AI model helped. The win-prediction figures
// are one fixed run (analysis/win-prediction, 2026-11-06, 1,081 games); the other two read the daily analysis files.
const NS = "research";

function Study({ title, q, m, r, l }: { title: React.ReactNode; q: React.ReactNode; m: React.ReactNode; r: React.ReactNode; l: React.ReactNode }) {
  return (
    <article className="card prose">
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
      <h4>
        <T ns={NS}>Limits</T>
      </h4>
      <p>{l}</p>
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
        <T ns={NS}>Three questions we tested.</T>
      </h2>
      <p className="muted">
        <T ns={NS}>How we test our own numbers: the question, the method, the result with its uncertainty, and the limits.</T>
      </p>
      <Study
        title={<T ns={NS}>How much does the draft decide?</T>}
        q={<T ns={NS}>Once both teams are locked in, how well do the ten champions predict who wins?</T>}
        m={
          <T ns={NS}>
            We compared four models with a baseline that always picks the blue side: one number per team (the sum of each champion&apos;s patch win rate), team make-up, a rating per champion, and boosted trees. Games come from players who chose to share them, with names removed. Every score is measured on games the model hadn&apos;t seen (5-fold cross-validation, repeated 10 times), with 95% ranges.
          </T>
        }
        r={
          <T ns={NS}>
            The draft matters, a little. The best model gets 60% of games right against 54% for always picking blue, and its AUC is 0.61 (95% range 0.58 to 0.65, where 0.50 is a coin flip). Shuffling the results and retraining beats it about 1 time in 300. The simplest model won: one number per team did as well as the detailed ones. Where the draft edge is clearest (a third of games) the favourite wins about 64%; in the closest third, 55%.
          </T>
        }
        l={
          <T ns={NS}>
            1,081 games is a small sample for a five-versus-five game, so the ranges are wide, and they come from a small group of players. The model ignores augments, items and skill on purpose. We rerun it as more games arrive.
          </T>
        }
      />
      {impact && (
        <Study
          title={<T ns={NS}>Did the buff work?</T>}
          q={<T ns={NS}>When the patch notes change a champion, does its win rate move by more than chance?</T>}
          m={
            <T ns={NS}>
              Each change is compared with what the untouched champions did over the same patch change (a difference in differences), and judged against how far an untouched champion typically moves. Changes are also sized as Mayhem modifiers, to estimate what each kind of change is worth.
            </T>
          }
          r={
            <T
              ns={NS}
              v={{ n: impact.changes, p: impact.patches, w: impact.worked, o: impact.opposite, r: impact.rest, pts: impact.pts.toFixed(1), lo: impact.ci[0].toFixed(1), hi: impact.ci[1].toFixed(1) }}
            >
              {"Across {n} changes in {p} patches, {w} moved the champion the intended way beyond noise, {o} moved it the opposite way, and {r} stayed within noise or had no clear intent. A 5% damage-dealt modifier is worth about {pts} win-rate points (likely range {lo} to {hi})."}
            </T>
          }
          l={
            <T ns={NS}>
              A win rate also moves for reasons the notes don&apos;t list, such as item and augment changes, new tricks and hotfixes. Many changes bundle several lines, so the value of each kind is rough, and small changes can&apos;t be told from noise.
            </T>
          }
        />
      )}
      {sim && (
        <Study
          title={<T ns={NS}>Does the Simulator match real games?</T>}
          q={<T ns={NS}>Does the Simulator rank champions&apos; damage the way real games do?</T>}
          m={
            <T ns={NS}>
              For every champion, the Simulator&apos;s damage per second on its most-played build is compared with its share of damage in real games. Agreement is the rank correlation (Spearman) with a 95% range from 2,000 resamples, and a role-adjusted model is scored leave-one-out. Every past Simulator version is replayed with today&apos;s yardstick, so progress is measured, not claimed.
            </T>
          }
          r={
            <T
              ns={NS}
              v={{ n: sim.n, rho: f2(sim.rho), lo: sim.ci ? f2(sim.ci[0]) : "", hi: sim.ci ? f2(sim.ci[1]) : "", radj: f2(sim.adjusted), slope: f2(sim.slope), v: sim.versions, first: f2(sim.first), last: f2(sim.last) }}
            >
              {"Across {n} champions the rank correlation is {rho} (95% range {lo} to {hi}). Adjusting for role lifts it to {radj}, and predicted damage shares line up with real ones with a calibration slope of {slope} (1.00 is perfect). Over {v} Simulator versions it has climbed from {first} to {last}."}
            </T>
          }
          l={
            <T ns={NS}>
              Real damage share depends on how people play, not only on the champion, so a perfect score is out of reach. Within a single role the groups are small and the ranges wide. It checks damage, not whether a build is good.
            </T>
          }
        />
      )}
    </section>
  );
}
