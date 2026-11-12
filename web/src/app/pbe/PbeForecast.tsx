import RowLink from "@/components/RowLink";
import { Name, T } from "@/components/I18n";
import type { pbeForecast } from "@/lib/analysis";

// Expected win-rate shift for each champion change on the test server, from the pre-patch model in
// data/analysis/patch_forecast.py (fitted on how past patch-note changes moved win rates). Shown only when the
// model beat the "no change" baseline out of sample, so a weak fit never reaches the page.

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;

export default function PbeForecast({ forecast }: { forecast: ReturnType<typeof pbeForecast> }) {
  const m = forecast?.model;
  const entries = forecast?.pbe?.entries ?? [];
  if (!m?.cv_mae_pts || !m.baseline_no_change_mae_pts || m.cv_mae_pts >= m.baseline_no_change_mae_pts || !entries.length) return null;
  return (
    <section className="card pbe-forecast" data-accent="pbe">
      <div className="card-head">
        <h2>
          <T ns="pbe">Expected win-rate shift</T>
        </h2>
        <span className="card-note">
          <T ns="pbe">predicted</T>
        </span>
      </div>
      <p className="muted">
        <T ns="pbe" v={{ n: m.n, mae: m.cv_mae_pts.toFixed(1), base: m.baseline_no_change_mae_pts.toFixed(1) }}>
          {"From how {n} past patch-note changes moved win rates. Typical miss {mae} pts, against {base} pts for assuming no change; the range is where the real shift usually lands."}
        </T>
      </p>
      <div className="rank plain recap-movers">
        {entries.map((e) => (
          <RowLink key={e.name} href={e.alias ? `/champions/${e.alias}` : "#tracker"}>
            {e.alias ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="icon" src={`/icons/champions/${e.alias}.webp`} alt="" width={24} height={24} loading="lazy" />
            ) : (
              <span className="icon" aria-hidden="true" />
            )}
            <span className="rank-name">
              {e.alias ? (
                <Name kind="champions" id={e.alias}>
                  {e.display}
                </Name>
              ) : (
                e.display
              )}
            </span>
            <span className={`rank-v ${e.predicted_pts > 0.5 ? "delta-up" : e.predicted_pts < -0.5 ? "delta-down" : ""}`}>
              {signed(e.predicted_pts)} <T ns="pbe">pts</T>
            </span>
            <span className="rank-v muted">
              {signed(e.range_pts[0])} … {signed(e.range_pts[1])}
            </span>
          </RowLink>
        ))}
      </div>
    </section>
  );
}
