import DataTable, { type Row } from "./DataTable";
import { T } from "./I18n";
import SimTuning from "./SimTuning";
import { patchName } from "@/lib/patch-name";
import { LEVER_LABELS, signed, type Tuning, type Validation } from "@/lib/sim-analysis";

// The Simulator's Tuning and Accuracy tabs: what a small balance change does to a simulated fight, and how far the
// Simulator can be trusted. Methods only on the page, never where numbers come from (site rule).
const NS = "sim-analysis";

const ROLE_LABELS: Record<string, string> = {
  assassin: "Assassin",
  fighter: "Fighter",
  mage: "Mage",
  marksman: "Marksman",
  support: "Support",
  tank: "Tank",
};

export function TuningTab({
  tuning,
  champions,
  itemInfo,
}: {
  tuning: Tuning;
  champions: { id: string; name: string }[];
  itemInfo: Record<number, { icon: string; slug: string }>;
}) {
  const levers = Object.keys(tuning.levers);
  const roleRows: Row[] = Object.entries(tuning.roles).map(([role, r]) => ({
    role: ROLE_LABELS[role] ?? role,
    n: r.n,
    ...Object.fromEntries(levers.map((l) => [l, r.levers[l]?.per_fight?.median ?? null])),
  }));
  const itemRows: Row[] = tuning.items
    .filter((i) => i.champions.length >= 3)
    .map((i) => ({
      name: i.name,
      icon: itemInfo[i.id]?.icon ?? "",
      href: itemInfo[i.id] ? `/items/${itemInfo[i.id].slug}` : null,
      n: i.champions.length,
      dps: i.median.dps ?? null,
      per_fight: i.median.per_fight ?? null,
      alive: i.median.alive ?? null,
    }));
  return (
    <div className="sim-analysis">
      <article className="card prose">
        <h2>
          <T ns={NS}>What a small balance change does to a fight</T>
        </h2>
        <p>
          <T ns={NS}>
            Each number below is nudged from 10% lower to 10% higher and the same fights are played again, with the same luck in every run, so the difference is the change itself. The figure on each card is how much the result moves for every 1% change: +1.00 means one for one, +0.30 means most of the change is lost on the way (overkill, enemies dying sooner, walking time).
          </T>
        </p>
        <p className="tune-note">
          <T ns={NS} v={{ patch: patchName(tuning.patch), n: tuning.seeds * tuning.trials }}>
            {"Patch {patch}, each champion's most-played build, {n} fights per point. ± is the 95% range across repeat runs."}
          </T>
        </p>
      </article>
      <section className="card">
        <SimTuning champions={champions} />
      </section>
      <section className="card">
        <div className="card-head">
          <h2>
            <T ns={NS}>By role: damage per fight for every 1% change</T>
          </h2>
        </div>
        <p className="tune-note">
          <T ns={NS}>The middle champion of each role. A modifier that moves a whole role by more than 1.0 is a strong lever: small changes there go a long way.</T>
        </p>
        <DataTable
          columns={[
            { key: "role", label: "Role", format: "text" },
            { key: "n", label: "Champions", format: "int", phone: "hide" },
            ...levers.map((l) => ({ key: l, label: LEVER_LABELS[l] ?? l, format: "num2" as const })),
          ]}
          rows={roleRows}
          initialSort={{ key: "damage_dealt", desc: true }}
        />
      </section>
      <section className="card">
        <div className="card-head">
          <h2>
            <T ns={NS}>Items: what 1% more of an item&apos;s stats is worth</T>
          </h2>
        </div>
        <p className="tune-note">
          <T ns={NS}>Each item&apos;s stat line scaled up and down on the champions who build it most; the middle result is shown. Passives aren&apos;t scaled.</T>
        </p>
        <DataTable
          columns={[
            { key: "name", label: "Item", format: "item", iconKey: "icon", hrefKey: "href" },
            { key: "n", label: "Champions", format: "int", phone: "hide" },
            { key: "per_fight", label: "Damage per fight", format: "num2" },
            { key: "dps", label: "Damage per second", format: "num2", phone: "hide" },
            { key: "alive", label: "Time alive", format: "num2", phone: "hide" },
          ]}
          rows={itemRows}
          initialSort={{ key: "per_fight", desc: true }}
          searchKey="name"
          searchLabel="Find an item"
        />
      </section>
    </div>
  );
}

// A calibration chart: predicted vs real damage share in five bins, with the real share's 95% range.
function Calibration({ bins }: { bins: Validation["role_adjusted"]["bins"] }) {
  const S = 260;
  const pad = 36;
  const vals = bins.flatMap((b) => [b.predicted, b.real_ci95[0], b.real_ci95[1]]);
  const lo = Math.floor(Math.min(...vals) - 1);
  const hi = Math.ceil(Math.max(...vals) + 1);
  const p = (v: number) => pad + ((v - lo) / (hi - lo)) * (S - pad - 10);
  const q = (v: number) => S - pad - ((v - lo) / (hi - lo)) * (S - pad - 10);
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="acc-cal" role="img" aria-label="Predicted against real damage share">
      <line className="wr-even" x1={p(lo)} y1={q(lo)} x2={p(hi)} y2={q(hi)} />
      {ticks.map((t) => (
        <g key={t}>
          <text className="wr-axis" x={p(t)} y={S - pad + 16} textAnchor="middle">
            {t}%
          </text>
          <text className="wr-axis" x={pad - 6} y={q(t) + 4} textAnchor="end">
            {t}%
          </text>
        </g>
      ))}
      {bins.map((b, i) => (
        <g key={i}>
          <line className="wr-line" x1={p(b.predicted)} x2={p(b.predicted)} y1={q(b.real_ci95[0])} y2={q(b.real_ci95[1])} />
          <circle className="wr-dot" cx={p(b.predicted)} cy={q(b.real)} r={4} />
        </g>
      ))}
    </svg>
  );
}

// Accuracy over Simulator versions: the rank correlation with its 95% range, one point per version.
function History({ points }: { points: Validation["history"] }) {
  const W = 640;
  const H = 200;
  const pad = { l: 40, r: 12, t: 12, b: 28 };
  const ys = points.flatMap((p) => [p.spearman, p.role_adjusted, ...(p.ci95 ?? [])]);
  const lo = Math.max(-1, Math.floor(Math.min(...ys) * 10) / 10);
  const hi = Math.min(1, Math.ceil(Math.max(...ys) * 10) / 10);
  const x = (i: number) => pad.l + (points.length < 2 ? 0 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const path = (k: "spearman" | "role_adjusted") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const band =
    points.every((p) => p.ci95) &&
    `M${points.map((p, i) => `${x(i).toFixed(1)},${y(p.ci95![1]).toFixed(1)}`).join("L")}L${points
      .map((p, i) => `${x(i).toFixed(1)},${y(p.ci95![0]).toFixed(1)}`)
      .reverse()
      .join("L")}Z`;
  const ticks = [lo, (lo + hi) / 2, hi];
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="acc-hist" role="img" aria-label="Accuracy by Simulator version">
      {band ? <path className="wr-drag" d={band} /> : null}
      {ticks.map((t) => (
        <g key={t}>
          <line className="wr-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          <text className="wr-axis" x={pad.l - 6} y={y(t) + 4} textAnchor="end">
            {t.toFixed(1)}
          </text>
        </g>
      ))}
      <path className="wr-line" d={path("spearman")} />
      <path className="wr-line other" d={path("role_adjusted")} />
      {points.map((p, i) =>
        i % every === 0 || i === points.length - 1 ? (
          <text key={p.commit} className="wr-axis" x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
            {p.date.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

const range = (c?: [number, number]) => (c ? ` (${c[0].toFixed(2)} to ${c[1].toFixed(2)})` : "");

export function AccuracyTab({ v }: { v: Validation }) {
  const ra = v.role_adjusted;
  const roleRows: Row[] = v.roles.map((r) => ({
    role: ROLE_LABELS[r.role] ?? r.role,
    n: r.n,
    within: r.within?.rho ?? null,
    low: r.within?.ci95?.[0] ?? null,
    high: r.within?.ci95?.[1] ?? null,
    bias: Math.round((Math.exp(r.raw_bias) - 1) * 1000) / 10,
  }));
  const off = (list: Validation["underrated"]) =>
    list.slice(0, 6).map((c) => ({ name: c.champion, role: ROLE_LABELS[c.role] ?? c.role, factor: c.factor, real: c.real_share / 100 }));
  const hist = [...v.history, { commit: "now", date: v.date, pr: null, title: "", ...v.history_current }];
  return (
    <div className="sim-analysis">
      <article className="card prose">
        <h2>
          <T ns={NS}>How far to trust the Simulator</T>
        </h2>
        <p>
          <T ns={NS}>
            Every champion fights with their most-played build, and the Simulator&apos;s ranking is compared with how much damage each champion really deals and takes in games. A rank correlation of 1 would mean the same order exactly, 0 no relation. Ranges are 95% intervals from resampling the champions.
          </T>
        </p>
      </article>
      <div className="tiles acc-tiles">
        <div>
          <b>
            {v.dps_vs_damage_share.rho.toFixed(2)}
            <small>{range(v.dps_vs_damage_share.ci95)}</small>
          </b>
          <span>
            <T ns={NS}>Damage order (rank correlation)</T>
          </span>
        </div>
        {v.taken_vs_tank_share ? (
          <div>
            <b>
              {v.taken_vs_tank_share.rho.toFixed(2)}
              <small>{range(v.taken_vs_tank_share.ci95)}</small>
            </b>
            <span>
              <T ns={NS}>Damage taken order (rank correlation)</T>
            </span>
          </div>
        ) : null}
        <div>
          <b>
            {ra.spearman.rho.toFixed(2)}
            <small>{range(ra.spearman.ci95)}</small>
          </b>
          <span>
            <T ns={NS} v={{ base: v.role_only.spearman.rho.toFixed(2) }}>
              {"Simulator plus role (role alone: {base})"}
            </T>
          </span>
        </div>
        <div>
          <b>±{ra.mae_points.toFixed(1)}</b>
          <span>
            <T ns={NS}>Typical miss, in points of damage share</T>
          </span>
        </div>
      </div>
      <section className="card acc-split">
        <div>
          <h2>
            <T ns={NS}>Calibration</T>
          </h2>
          <p className="tune-note">
            <T ns={NS} v={{ slope: ra.calibration_slope.toFixed(2), r2: ra.r2_log.toFixed(2), base: v.role_only.r2_log.toFixed(2) }}>
              {
                "Champions split into five groups by predicted damage share (Simulator plus role, each champion predicted without itself). Points on the dashed line are spot on. Slope {slope} (1 is ideal); explains {r2} of the spread, against {base} from role alone."
              }
            </T>
          </p>
        </div>
        <Calibration bins={ra.bins} />
      </section>
      <section className="card">
        <div className="card-head">
          <h2>
            <T ns={NS}>By role</T>
          </h2>
        </div>
        <p className="tune-note">
          <T ns={NS}>Within a role, does the Simulator order champions like real games? Bias is how much higher (+) or lower (−) the Simulator rates the whole role than real games do.</T>
        </p>
        <DataTable
          columns={[
            { key: "role", label: "Role", format: "text" },
            { key: "n", label: "Champions", format: "int", phone: "hide" },
            { key: "within", label: "Order within role", format: "num2" },
            { key: "low", label: "Low", format: "num2", phone: "hide" },
            { key: "high", label: "High", format: "num2", phone: "hide" },
            { key: "bias", label: "Bias %", format: "num" },
          ]}
          rows={roleRows}
          initialSort={{ key: "within", desc: true }}
        />
      </section>
      {v.history.length ? (
        <section className="card">
          <div className="card-head">
            <h2>
              <T ns={NS}>Accuracy over time</T>
            </h2>
          </div>
          <p className="tune-note">
            <T ns={NS}>Earlier versions of the Simulator scored with today&apos;s builds and today&apos;s games, so every point uses the same yardstick. Solid: damage order (shaded: 95% range); dashed: Simulator plus role.</T>
          </p>
          <History points={hist} />
        </section>
      ) : null}
      <section className="card acc-split">
        <div>
          <h2>
            <T ns={NS}>Most underrated</T>
          </h2>
          <p className="tune-note">
            <T ns={NS}>Real damage share above what the Simulator plus role predicts. Likely kit gaps.</T>
          </p>
          <DataTable
            columns={[
              { key: "name", label: "Champion", format: "champion" },
              { key: "factor", label: "Real ÷ predicted", format: "num2" },
              { key: "real", label: "Damage share", format: "pct", phone: "hide" },
            ]}
            rows={off(v.underrated)}
            initialSort={{ key: "factor", desc: true }}
          />
        </div>
        <div>
          <h2>
            <T ns={NS}>Most overrated</T>
          </h2>
          <p className="tune-note">
            <T ns={NS}>Real damage share below the prediction.</T>
          </p>
          <DataTable
            columns={[
              { key: "name", label: "Champion", format: "champion" },
              { key: "factor", label: "Real ÷ predicted", format: "num2" },
              { key: "real", label: "Damage share", format: "pct", phone: "hide" },
            ]}
            rows={off(v.overrated)}
            initialSort={{ key: "factor", desc: false }}
          />
        </div>
      </section>
      <p className="tune-note">
        <T ns={NS} v={{ patch: patchName(v.patch), date: v.date, b: v.bootstrap, d: signed(ra.dps_coefficient) }}>
          {"Patch {patch}, checked {date}. {b} resamples per range. Each 1% more simulated damage per second goes with {d}% more real damage share once role is known."}
        </T>
      </p>
    </div>
  );
}
