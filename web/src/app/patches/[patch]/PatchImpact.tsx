import RowLink from "@/components/RowLink";
import { Name, T } from "@/components/I18n";
import type { ImpactPatch, SettlingPatch, Shift } from "@/lib/analysis";

// Three cards from data/analysis on a patch's recap: whether each champion change in the patch notes moved that
// champion's win rate (difference in differences against the champions the notes left alone), how close the
// patch's first days came to its final ranking, and champions whose win rate shifted mid-patch.

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}`;

const VERDICT: Record<ImpactPatch["champions"][number]["verdict"], string> = {
  worked: "Worked",
  opposite: "Backfired",
  noise: "Within noise",
  moved: "Moved",
};

type Typical = { spearman: number[]; mad_pts: number[]; settledDay: number | null } | null;

export default function PatchImpact({ impact, settling, typical, shifts }: { impact: ImpactPatch | null; settling: SettlingPatch | null; typical: Typical; shifts: Shift[] }) {
  const rows = impact?.champions ?? [];
  const day1 = settling && settling.days > 1 ? settling.spearman[0] : null;
  return (
    <>
      {rows.length > 0 && impact && (
        <section className="card span-all" data-accent="tier">
          <div className="card-head">
            <h2>
              <T ns="patches">Did the champion changes work?</T>
            </h2>
            <span className="card-note">
              <T ns="patches" v={{ n: impact.control.n, sd: (impact.control.sd * 100).toFixed(1) }}>
                {"vs the {n} champions the notes left alone (they drift ±{sd} pts)"}
              </T>
            </span>
          </div>
          <p className="muted">
            <T ns="patches">
              Each change is judged against every champion the patch did not touch, so a shift the whole list made does not count. Within noise means the champion moved no more than an unchanged one typically does.
            </T>
          </p>
          <ul className="impact-list">
            {rows.map((c) => (
              <li key={c.alias} data-verdict={c.verdict}>
                <div className="rank plain recap-list">
                  <RowLink href={`/champions/${c.alias}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="icon" src={`/icons/champions/${c.alias}.webp`} alt="" width={24} height={24} loading="lazy" />
                    <span className="rank-name">
                      <Name kind="champions" id={c.alias}>
                        {c.name}
                      </Name>
                      <span className={`chip verdict-${c.verdict}`}>
                        <T ns="patches">{VERDICT[c.verdict]}</T>
                      </span>
                    </span>
                    <span className="rank-v impact-nums">
                      <span>
                        {pct(c.before)} → {pct(c.after)}
                      </span>
                      <b className={c.effect > 0 ? "delta-up" : c.effect < 0 ? "delta-down" : ""}>
                        {signed(c.effect)} <T ns="patches">pts</T>
                      </b>
                      <small>
                        ±{(c.se * 196).toFixed(1)}
                      </small>
                    </span>
                  </RowLink>
                </div>
                <ul className="impact-lines">
                  {c.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      {day1 !== null && settling && (
        <section className="card span-6" data-accent="sim">
          <div className="card-head">
            <h2>
              <T ns="patches">How fast the rankings settled</T>
            </h2>
          </div>
          <div className="stat-row">
            <div>
              <b>{Math.round(day1 * 100)}%</b>
              <span>
                <T ns="patches">of the final order on day one</T>
              </span>
            </div>
            <div>
              <b>{settling.mad_pts[0].toFixed(2)}</b>
              <span>
                <T ns="patches">pts average gap to the final win rates</T>
              </span>
            </div>
            {settling.settled_day && (
              <div>
                <b>{settling.settled_day}</b>
                <span>
                  <T ns="patches">days to 95% settled</T>
                </span>
              </div>
            )}
          </div>
          {typical && typical.spearman.length > 0 && (
            <p className="muted">
              <T ns="patches" v={{ pct: Math.round(typical.spearman[0] * 100), pts: typical.mad_pts[0].toFixed(2) }}>
                {"A typical patch is {pct}% of its final order after one day, {pts} pts off on average. So many games are played that rankings barely move after the first day; only mid-patch changes do."}
              </T>
            </p>
          )}
        </section>
      )}
      {shifts.length > 0 && (
        <section className="card span-6" data-accent="pbe">
          <div className="card-head">
            <h2>
              <T ns="patches">Shifted mid-patch</T>
            </h2>
            <span className="card-note">
              <T ns="patches">candidates for a hotfix or a new trick</T>
            </span>
          </div>
          <div className="rank plain recap-movers">
            {shifts.slice(0, 8).map((s) => (
              <RowLink key={s.alias} href={`/champions/${s.alias}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="icon" src={`/icons/champions/${s.alias}.webp`} alt="" width={24} height={24} loading="lazy" />
                <span className="rank-name">
                  <Name kind="champions" id={s.alias}>
                    {s.name}
                  </Name>
                  <small className="muted"> {s.date.slice(5)}</small>
                </span>
                <span className="rank-v">{pct(s.after)}</span>
                <span className={`rank-v ${s.shift > 0 ? "delta-up" : "delta-down"}`}>{signed(s.shift)}</span>
              </RowLink>
            ))}
          </div>
          <p className="muted">
            <T ns="patches">
              From that day on, the champion&apos;s games went this much better or worse than before it, far beyond what the rest of the list did the same day.
            </T>
          </p>
        </section>
      )}
    </>
  );
}
