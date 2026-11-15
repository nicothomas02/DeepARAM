import RowLink from "@/components/RowLink";
import { Name, T } from "@/components/I18n";
import type { forecastScorecard } from "@/lib/analysis";
import { patchName } from "@/lib/patch-name";

// "Did we call it?": once a patch is live, the forecast saved while it was on the test server is checked against
// the measured win-rate shift of each champion (data/analysis/forecast_scorecard.py). Before the first week of
// games it only says the forecast is saved and when the score comes.

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
const pct = (v: number) => Math.round(100 * v);
const P = ({ children, v }: { children: string; v?: Record<string, string | number> }) => (
  <T ns="pbe" v={v}>
    {children}
  </T>
);

export default function PbeScorecard({ card }: { card: ReturnType<typeof forecastScorecard> }) {
  const latest = card?.patches[0];
  const waiting = card?.waiting.at(-1);
  if (!latest && !waiting) return null;
  return (
    <section className="card pbe-scorecard" data-accent="pbe">
      <div className="card-head">
        <h2>
          <P>Did we call it?</P>
        </h2>
        {latest && (
          <span className={`chip ${latest.summary.beat_no_change ? "verdict-worked" : "verdict-opposite"}`}>
            {latest.summary.beat_no_change ? <P>Beat no change</P> : <P>Missed more than no change</P>}
          </span>
        )}
      </div>
      <p className="muted">
        <P>After each patch goes live, the forecast saved before it shipped is checked against how each champion really moved.</P>
      </p>
      {waiting && (
        <p>
          <P v={{ patch: patchName(waiting.patch), n: waiting.champions, day: waiting.day, of: waiting.of }}>
            {"Patch {patch}: the forecast for {n} champions is saved. The score comes after a week of games (day {day} of {of})."}
          </P>
        </p>
      )}
      {latest && (
        <>
          <p>
            <P v={{ patch: patchName(latest.patch), mae: latest.summary.mae_pts.toFixed(1), base: latest.summary.no_change_mae_pts.toFixed(1) }}>
              {"Patch {patch}: typical miss {mae} pts, against {base} pts for assuming no change."}
            </P>{" "}
            <P v={{ right: latest.summary.direction.right, of: latest.summary.direction.of }}>{"Right direction for {right} of {of} champions."}</P>{" "}
            <P v={{ in95: pct(latest.summary.in95), in50: pct(latest.summary.in50) }}>
              {"{in95}% landed inside the range (95% expected) and {in50}% inside its middle half (50% expected)."}
            </P>
            {!latest.final && (
              <>
                {" "}
                <P v={{ days: latest.days }}>{"Still counting: day {days} of the patch."}</P>
              </>
            )}
          </p>
          <div className="rank plain recap-movers">
            <div className="rank-head muted" aria-hidden="true">
              <span />
              <span />
              <span className="rank-v">
                <P>predicted</P>
              </span>
              <span className="rank-v">
                <P>measured</P>
              </span>
              <span />
            </div>
            {latest.champions.map((r) => (
              <RowLink key={r.alias} href={`/champions/${r.alias}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="icon" src={`/icons/champions/${r.alias}.webp`} alt="" width={24} height={24} loading="lazy" />
                <span className="rank-name">
                  <Name kind="champions" id={r.alias}>
                    {r.name}
                  </Name>
                </span>
                <span className="rank-v muted">{signed(r.predicted_pts)}</span>
                <span className={`rank-v ${r.measured_pts > 0.5 ? "delta-up" : r.measured_pts < -0.5 ? "delta-down" : ""}`}>{signed(r.measured_pts)}</span>
                <span className={`rank-v ${r.in95 ? "delta-up" : "delta-down"}`}>
                  {r.in95 ? <P>in range</P> : <P>outside</P>}
                </span>
              </RowLink>
            ))}
          </div>
        </>
      )}
      {card && card.patches.length > 1 && card.pooled && (
        <dl className="defs scorecard-history">
          {card.patches.map((p) => (
            <div key={p.patch}>
              <dt>
                <P v={{ patch: patchName(p.patch) }}>{"Patch {patch}"}</P>
              </dt>
              <dd>
                <P v={{ n: p.summary.n, mae: p.summary.mae_pts.toFixed(1), base: p.summary.no_change_mae_pts.toFixed(1), in95: pct(p.summary.in95) }}>
                  {"{n} champions, miss {mae} pts against {base}, {in95}% in range"}
                </P>
              </dd>
            </div>
          ))}
          <div>
            <dt>
              <P>All patches</P>
            </dt>
            <dd>
              <P v={{ n: card.pooled.n, mae: card.pooled.mae_pts.toFixed(1), base: card.pooled.no_change_mae_pts.toFixed(1), in95: pct(card.pooled.in95) }}>
                {"{n} champions, miss {mae} pts against {base}, {in95}% in range"}
              </P>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
