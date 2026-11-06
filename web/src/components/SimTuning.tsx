"use client";

import { useEffect, useMemo, useState } from "react";
import { useNames, useT } from "./I18n";
import { setParams } from "@/lib/url-state";
import { LEVER_LABELS, signed, type Metric, type SlimCurve, type SlimTuning } from "@/lib/sim-analysis";

// One champion's tuning-sensitivity curves: each lever nudged from -10% to +10%, the same fights replayed, and how
// far the chosen result moved. Loads /data/sim-tuning.json when the tab first opens.

const NS = "sim-analysis";
const W = 220;
const H = 96;
const PAD = { l: 8, r: 8, t: 10, b: 18 };

const METRIC_LABELS: Partial<Record<Metric, string>> = {
  per_fight: "Damage per fight",
  dps: "Damage per second",
  alive: "Time alive",
};

function Spark({ steps, c, scale }: { steps: number[]; c: SlimCurve; scale: number }) {
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / (steps.length - 1)) * iw;
  const y = (v: number) => PAD.t + (1 - (v + scale) / (2 * scale)) * ih;
  const pts = c[2].map((v, i) => (v === null ? null : [x(i), y(v)] as const)).filter((p): p is readonly [number, number] => p !== null);
  const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-hidden="true" className="tune-spark">
      <line className="wr-even" x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} />
      <line className="wr-grid" x1={x(2)} x2={x(2)} y1={PAD.t} y2={H - PAD.b} />
      <path className="wr-line" d={d} />
      {pts.map(([px, py], i) => (
        <circle key={i} className="wr-dot" cx={px} cy={py} r={3} />
      ))}
      {[0, 2, 4].map((i) => (
        <text key={i} className="wr-axis" x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>
          {steps[i] > 0 ? `+${steps[i]}%` : `${steps[i]}%`}
        </text>
      ))}
    </svg>
  );
}

export default function SimTuning({ champions }: { champions: { id: string; name: string }[] }) {
  const t = useT(NS);
  const names = useNames();
  const [data, setData] = useState<SlimTuning | null | "failed">(null);
  const [champ, setChamp] = useState(() => (champions.some((c) => c.id === "Ahri") ? "Ahri" : champions[0]?.id ?? ""));
  const [metric, setMetric] = useState<Metric>("per_fight");

  useEffect(() => {
    const want = new URLSearchParams(location.search).get("champ");
    if (want && champions.some((c) => c.id === want)) setChamp(want);
  }, [champions]);
  useEffect(() => {
    fetch("/data/sim-tuning.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: SlimTuning | null) => setData(d ?? "failed"))
      .catch(() => setData("failed"));
  }, []);

  const c = data && data !== "failed" ? data.champions[champ] : null;
  const scale = useMemo(() => {
    if (!c) return 10;
    const all = Object.values(c.l).flatMap((m) => m[metric]?.[2] ?? []).filter((v): v is number => v !== null);
    return Math.max(4, Math.ceil(Math.max(...all.map(Math.abs), 0) / 2) * 2);
  }, [c, metric]);

  const pick = (id: string) => {
    setChamp(id);
    setParams({ champ: id });
  };

  if (data === "failed") return <p className="tune-note">{t("The tuning curves aren't available right now.")}</p>;
  if (!data) return <p className="tune-note">{t("Loading…")}</p>;

  const levers = data.levers.filter((l) => c?.l[l]?.[metric]);
  const ex = c ? data.levers.filter((l) => l !== "damage_dealt" && c.x[l] && c.x[l]! > 0 && c.x[l]! <= 4) : [];
  return (
    <div className="tune">
      <div className="wr-tools tune-tools">
        <label>
          <span className="sr-only">{t("Champion")}</span>
          <select value={champ} onChange={(e) => pick(e.target.value)}>
            {champions.map((o) => (
              <option key={o.id} value={o.id}>
                {names("champions", o.id, o.name)}
              </option>
            ))}
          </select>
        </label>
        <div className="seg" role="group" aria-label={t("Result")}>
          {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
            <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {t(METRIC_LABELS[m]!)}
            </button>
          ))}
        </div>
      </div>
      {!c ? (
        <p className="tune-note">{t("No curves for this champion yet.")}</p>
      ) : (
        <>
          <div className="tune-grid">
            {levers.map((l) => {
              const v = c.l[l][metric]!;
              const strong = Math.abs(v[0]) >= 0.5;
              return (
                <figure key={l} className="tune-card">
                  <figcaption>
                    <b>{t(LEVER_LABELS[l] ?? l)}</b>
                    <span className={strong ? (v[0] > 0 ? "tune-up" : "tune-down") : "tune-flat"}>
                      {t("+1% → {e}%", { e: signed(v[0]) })}
                      {v[1] !== null ? <small> ±{(1.96 * v[1]).toFixed(2)}</small> : null}
                    </span>
                  </figcaption>
                  <Spark steps={data.steps} c={v} scale={scale} />
                  {!v[3] ? <small className="tune-note">{t("Not a straight line: small changes can go either way.")}</small> : null}
                </figure>
              );
            })}
          </div>
          {ex.length ? (
            <p className="tune-exchange">
              {t("Same damage per fight as +5% damage dealt:")}{" "}
              {ex.map((l, i) => (
                <span key={l}>
                  {i ? ", " : ""}
                  {t("{p}% {lever}", { p: signed(5 * c.x[l]!, 1), lever: t(LEVER_LABELS[l] ?? l) })}
                </span>
              ))}
              .
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
