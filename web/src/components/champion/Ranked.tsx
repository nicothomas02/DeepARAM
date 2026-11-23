/* eslint-disable @next/next/no-img-element -- small local icons */
import { Name, T } from "@/components/I18n";
import type { Rated } from "@/lib/champion-page";
import WinRate from "@/components/WinRate";

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
  className,
}: {
  rank: number;
  cols?: number;
  children: React.ReactNode;
  cells: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `cp-row ${className}` : "cp-row"} data-cols={cols}>
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
      <Cell value={<WinRate p={r.winRate} n={r.games} />} label="Win rate" />
      <Cell value={pct(r.pickRate)} label="Pick rate" />
      <Cell value={signed(l)} label={lift} tone={tone(l)} />
    </>
  );
}

export function ItemIcon({
  id,
  info,
  named,
}: {
  id: number;
  info: Record<number, { name: string; icon?: string }>;
  /** Adds the item's name under the icon where the quick build is full width (phones and tablets). */
  named?: boolean;
}) {
  const it = info[id];
  if (!it?.icon) return null;
  const img = (
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
  if (!named) return img;
  return (
    <span className="cp-named">
      {img}
      <small aria-hidden="true">
        <Name kind="items" id={id}>
          {it.name}
        </Name>
      </small>
    </span>
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

type LaterRow = Rated & { items: number[]; deepScore?: number };
const SLOT_NAMES: Record<number, string> = { 4: "4th item", 5: "5th item", 6: "6th item" };

function LaterList({ rows, info }: { rows: LaterRow[]; info: Record<number, { name: string; icon?: string }> }) {
  return (
    <ol className="cp-later">
      {rows.map((r) => (
        <li key={r.items[0]}>
          <ItemIcon id={r.items[0]} info={info} named />
          <span className="cp-later-nums">
            {r.deepScore !== undefined && (
              <span>
                <b>{r.deepScore}</b> <small>DeepScore</small>
              </span>
            )}
            <span>
              <b>{pct(r.winRate)}</b>{" "}
              <small>
                <T ns={NS}>Win rate</T>
              </small>
            </span>
            <span>
              <b>{pct(r.pickRate)}</b>{" "}
              <small>
                <T ns={NS}>Pick rate</T>
              </small>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The items to buy after the core, each with the DeepScore that orders it, then win and pick rate (Nico,
 *  2026-11-23: core, then the rest of the items singly, above the situational ones), split into the 4th, 5th and 6th
 *  item slots when the buying order is known. */
export function LaterItems({
  rows,
  slots,
  info,
}: {
  rows: LaterRow[];
  slots?: { slot: number; items: LaterRow[] }[];
  info: Record<number, { name: string; icon?: string }>;
}) {
  const bySlot = (slots ?? []).filter((s) => s.items.length > 0 && SLOT_NAMES[s.slot]);
  return (
    <div className="cp-best cp-best-wide cp-best-later">
      <h4>
        <T ns={NS}>After the core</T>
      </h4>
      {bySlot.length > 0 ? (
        <div className="cp-later-slots">
          {bySlot.map((s) => (
            <div key={s.slot}>
              <h5>
                <T ns={NS}>{SLOT_NAMES[s.slot]}</T>
              </h5>
              <LaterList rows={s.items} info={info} />
            </div>
          ))}
        </div>
      ) : (
        <LaterList rows={rows} info={info} />
      )}
    </div>
  );
}
