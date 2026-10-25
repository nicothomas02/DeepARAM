/* eslint-disable @next/next/no-img-element -- small local icons */
import { Name, T } from "@/components/I18n";
import type { Rated } from "@/lib/champion-page";

// Champion page building blocks: a panel with a title and row count, a header row, and ranked rows whose
// numbers sit in fixed columns (value on top, its label below). Rows past the first few hide behind a
// "Show all" button (ShowMore.tsx).

const NS = "champions";
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function Panel({
  id,
  title,
  count,
  note,
  detailed,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  note?: React.ReactNode;
  detailed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="cp-panel" id={id} data-detailed={detailed || undefined}>
      <header>
        <h3>
          <T ns={NS}>{title}</T>
        </h3>
        {count !== undefined && <span className="cp-count">{count}</span>}
        {note && <span className="cp-note">{note}</span>}
      </header>
      {children}
    </section>
  );
}

export function Head({
  what,
  cols = ["Win rate", "Pick rate", "Win rate boost"],
}: {
  what: string;
  cols?: string[];
}) {
  return (
    <div className="cp-th" data-cols={cols.length}>
      <span>
        <T ns={NS}>Rank</T>
      </span>
      <span>
        <T ns={NS}>{what}</T>
      </span>
      {cols.map((c) => (
        <span key={c}>
          <T ns={NS}>{c}</T>
        </span>
      ))}
    </div>
  );
}

export function Row({
  rank,
  cols = 3,
  children,
  cells,
}: {
  rank: number;
  cols?: number;
  children: React.ReactNode;
  cells: React.ReactNode;
}) {
  return (
    <div className="cp-row" data-cols={cols}>
      <span className="cp-rk">#{rank}</span>
      <div className="cp-what">{children}</div>
      {cells}
    </div>
  );
}

export function Cell({
  value,
  label,
  tone,
}: {
  value: React.ReactNode;
  label: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="cp-cell">
      <b className={tone}>{value}</b>
      <small>
        <T ns={NS}>{label}</T>
      </small>
    </div>
  );
}

export const tone = (v: number) =>
  v > 0.0005 ? "up" : v < -0.0005 ? "down" : undefined;
/** A win-rate difference as signed percentage points, "+4.2". */
export const signedPts = (v: number) =>
  `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}`;
/** A win-rate difference, "+4.2 pts": written one way across the site (HowRankings.tsx explains it). */
export const signed = (v: number) => (
  <T ns="tables" v={{ n: signedPts(v) }}>
    {"{n} pts"}
  </T>
);

/** Win rate, pick rate and win rate boost for one row. */
export function RatedCells({
  r,
  lift = "Win rate boost",
  value,
}: {
  r: Rated;
  lift?: string;
  value?: number;
}) {
  const l = value ?? r.lift;
  return (
    <>
      <Cell value={pct(r.winRate)} label="Win rate" />
      <Cell value={pct(r.pickRate)} label="Pick rate" />
      <Cell value={signed(l)} label={lift} tone={tone(l)} />
    </>
  );
}

export function ItemIcon({
  id,
  info,
}: {
  id: number;
  info: Record<number, { name: string; icon?: string }>;
}) {
  const it = info[id];
  if (!it?.icon) return null;
  return (
    <img
      className="cp-icon"
      src={it.icon}
      alt={it.name}
      title={it.name}
      width={36}
      height={36}
      loading="lazy"
    />
  );
}

export function ItemName({
  id,
  info,
}: {
  id: number;
  info: Record<number, { name: string }>;
}) {
  return (
    <span className="cp-name">
      <Name kind="items" id={id}>
        {info[id]?.name ?? ""}
      </Name>
    </span>
  );
}

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="cp-keys">
      {keys.map((k, i) => (
        <span key={i}>
          {i > 0 && (
            <span className="cp-sep" aria-hidden="true">
              ›
            </span>
          )}
          <b className="cp-key" data-k={k}>
            {k}
          </b>
        </span>
      ))}
    </span>
  );
}
