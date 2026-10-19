"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useNames, useT } from "./I18n";
import { patchName } from "@/lib/patch-name";

// A champion's win rate (or pick rate) patch by patch. Hover or touch to scrub patches, drag across
// the chart to zoom into a range, and pick a second champion to overlay. The other champions' history
// loads from /data/tier-history.json the first time one is picked.

export type Point = { patch: string; winRate: number; pickRate: number };
type Row = { patch: string; name: string; win_rate: number; pick_rate: number };

const H = 240;
const PAD = { l: 44, r: 16, t: 14, b: 28 };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function WinRateChart({
  id,
  name: en,
  history,
  patches,
  champions,
}: {
  id: string;
  name: string;
  history: Point[];
  patches: string[];
  champions: { id: string; name: string }[];
}) {
  const t = useT("champion-page");
  const names = useNames();
  const name = names("champions", id, en);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [metric, setMetric] = useState<"winRate" | "pickRate">("winRate");
  const [range, setRange] = useState<[number, number]>([0, patches.length - 1]);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [other, setOther] = useState("");
  const [all, setAll] = useState<Row[] | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!other || all) return;
    fetch("/data/tier-history.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setAll)
      .catch(() => setOther(""));
  }, [other, all]);

  const byPatch = (pts: Point[]) => new Map(pts.map((p) => [p.patch, p]));
  const mine = useMemo(() => byPatch(history), [history]);
  const theirs = useMemo(
    () =>
      other && all
        ? byPatch(
            all
              .filter((r) => r.name === other)
              .map((r) => ({
                patch: r.patch,
                winRate: r.win_rate,
                pickRate: r.pick_rate,
              })),
          )
        : null,
    [other, all],
  );

  const [lo, hi] = range;
  const shown = patches.slice(lo, hi + 1);
  const vals = [...shown.flatMap((p) => [mine.get(p)?.[metric], theirs?.get(p)?.[metric]])].filter((v): v is number => v !== undefined);
  let min = Math.min(...vals, metric === "winRate" ? 0.48 : Infinity);
  let max = Math.max(...vals, metric === "winRate" ? 0.52 : -Infinity);
  if (!vals.length) [min, max] = [0, 1];
  const span = max - min || 0.01;
  min -= span * 0.1;
  max += span * 0.1;

  const iw = w - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (shown.length < 2 ? iw / 2 : (i / (shown.length - 1)) * iw);
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * ih;
  const line = (m: Map<string, Point>) =>
    shown
      .map((p, i) => {
        const v = m.get(p)?.[metric];
        return v === undefined ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .reduce<string>((d, pt, i, arr) => (pt === null ? d : d + `${i === 0 || arr[i - 1] === null ? "M" : "L"}${pt}`), "");

  const ticks = Array.from({ length: 4 }, (_, i) => min + ((max - min) * (i + 0.5)) / 4);
  const every = Math.ceil(shown.length / Math.max(2, Math.floor(iw / 56)));
  const indexAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const f = (clientX - r.left - PAD.l) / iw;
    return Math.max(0, Math.min(shown.length - 1, Math.round(f * (shown.length - 1))));
  };

  const h = hover !== null ? shown[hover] : null;
  const zoomed = lo > 0 || hi < patches.length - 1;
  const otherEn = champions.find((c) => c.id === other)?.name;
  const otherName = otherEn && names("champions", other, otherEn);

  return (
    <section className="card span-all wr-chart" data-accent="tier">
      <div className="card-head">
        <h2>{metric === "winRate" ? t("Win rate by patch") : t("Pick rate by patch")}</h2>
        <div className="wr-tools">
          <div className="seg" role="group" aria-label={t("Measure")}>
            <button type="button" aria-pressed={metric === "winRate"} onClick={() => setMetric("winRate")}>
              {t("Win")}
            </button>
            <button type="button" aria-pressed={metric === "pickRate"} onClick={() => setMetric("pickRate")}>
              {t("Pick")}
            </button>
          </div>
          <select value={other} onChange={(e) => setOther(e.target.value)} aria-label={t("Compare with")}>
            <option value="">{t("Compare with…")}</option>
            {champions.map((c) => (
              <option key={c.id} value={c.id}>
                {names("champions", c.id, c.name)}
              </option>
            ))}
          </select>
          {zoomed && (
            <button type="button" className="wr-reset" onClick={() => setRange([0, patches.length - 1])}>
              {t("Show all patches")}
            </button>
          )}
        </div>
      </div>
      <div
        ref={box}
        className="wr-plot"
        onPointerMove={(e) => {
          const i = indexAt(e.clientX);
          setHover(i);
          if (drag) setDrag([drag[0], i]);
        }}
        onPointerLeave={() => !drag && setHover(null)}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            const i = indexAt(e.clientX);
            setDrag([i, i]);
          } else setHover(indexAt(e.clientX));
        }}
        onPointerUp={() => {
          if (drag && Math.abs(drag[1] - drag[0]) >= 1) {
            const [a, b] = [Math.min(...drag), Math.max(...drag)];
            setRange([lo + a, lo + b]);
            setHover(null);
          }
          setDrag(null);
        }}
      >
        <svg width={w} height={H} role="img" aria-label={`${name}: ${metric === "winRate" ? t("Win rate by patch") : t("Pick rate by patch")}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="wr-grid" x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="wr-axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">
                {(t * 100).toFixed(metric === "winRate" ? 0 : 1)}%
              </text>
            </g>
          ))}
          {metric === "winRate" && min < 0.5 && max > 0.5 && <line className="wr-even" x1={PAD.l} x2={w - PAD.r} y1={y(0.5)} y2={y(0.5)} />}
          {shown.map((p, i) =>
            i % every === 0 || i === shown.length - 1 ? (
              <text
                key={p}
                className="wr-axis"
                x={x(i)}
                y={H - 8}
                textAnchor={i === shown.length - 1 && shown.length > 1 ? "end" : i === 0 && shown.length > 1 ? "start" : "middle"}
              >
                {patchName(p)}
              </text>
            ) : null,
          )}
          {drag && <rect className="wr-drag" x={Math.min(x(drag[0]), x(drag[1]))} y={PAD.t} width={Math.abs(x(drag[1]) - x(drag[0]))} height={ih} />}
          {theirs && <path className="wr-line other" d={line(theirs)} />}
          <path className="wr-line" d={line(mine)} />
          {h && (
            <>
              <line className="wr-cursor" x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={PAD.t + ih} />
              {mine.get(h) && <circle className="wr-dot" cx={x(hover!)} cy={y(mine.get(h)![metric])} r={4.5} />}
              {theirs?.get(h) && <circle className="wr-dot other" cx={x(hover!)} cy={y(theirs.get(h)![metric])} r={4.5} />}
            </>
          )}
        </svg>
        {h && (
          <div className="wr-tip" style={{ left: Math.min(Math.max(x(hover!), 70), w - 70) }}>
            <b>{t("Patch {patch}", { patch: patchName(h) })}</b>
            <span>
              {name}: {mine.get(h) ? pct(mine.get(h)![metric]) : "–"}
            </span>
            {theirs && (
              <span className="other">
                {otherName}: {theirs.get(h) ? pct(theirs.get(h)![metric]) : "–"}
              </span>
            )}
          </div>
        )}
      </div>
      <p className="table-note">{t("Hover or tap to see each patch. With a mouse, drag across the chart to zoom in.")}</p>
    </section>
  );
}
