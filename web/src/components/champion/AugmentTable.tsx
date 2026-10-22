"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import Link from "next/link";
import { useRef } from "react";
import { KEPT, useKept } from "@/lib/kept";
import { Name, useT } from "@/components/I18n";
import DeepScore from "@/components/DeepScore";
import { signedPts, tone } from "@/components/champion/Ranked";
import type { AugmentRow } from "@/lib/champion-page";
import { AUGMENT_DEEPSCORE_HELP } from "@/lib/deepscore";

// A champion's augments as one ranked table with rarity and augment pick filters, best DeepScore first, each with the game's
// build tags, ten to a page. The number columns' headers re-sort it (highest first; a second click flips it).

const RARITIES = ["all", "prismatic", "gold", "silver"] as const;
const LABEL = {
  all: "All",
  prismatic: "Prismatic",
  gold: "Gold",
  silver: "Silver",
};
const PAGE = 10;
// Augment picks: "any", or the 1st to 4th pick of the game. An augment counts for a pick when at least a fair share
// (a quarter) of its picks, across all champions, happen there (estimated).
const PICKS = ["any", 0, 1, 2, 3] as const;
const PICK_LABEL = ["1st augment", "2nd augment", "3rd augment", "4th augment"];
const FAIR_SHARE = 0.25;
type SortKey = "deepScore" | "winRate" | "pickRate";

export default function AugmentTable({
  rows,
}: {
  rows: (AugmentRow & {
    href?: string;
    deepScore?: number;
    winRate?: number;
    lift?: number;
    /** Share of the augment's picks at each of the four augment picks. */
    stages?: number[];
  })[];
}) {
  const t = useT("champions");
  const tt = useT("tables");
  const ts = useT("tier-list");
  const box = useRef<HTMLDivElement>(null);
  const [rarity, setRarity] = useKept<(typeof RARITIES)[number]>(
    "all",
    box,
    "rarity",
  );
  const [pick, setPick] = useKept<(typeof PICKS)[number]>("any", box, "pick");
  const [page, setPage] = useKept(0, box, "page");
  const top = useRef<HTMLDivElement>(null);
  // Turning the page from the buttons under the table brings the new page's first row back into view.
  const turn = (p: number) => {
    setPage(p);
    const y = top.current?.getBoundingClientRect().top ?? 0;
    if (y < 0) top.current?.scrollIntoView({ block: "start" });
  };
  const [sort, setSort] = useKept<{ key: SortKey; desc: boolean }>(
    {
      key: "deepScore",
      desc: true,
    },
    box,
    "sort",
  );
  const shown = rows
    .filter((r) => rarity === "all" || r.rarity === rarity)
    .filter((r) => pick === "any" || (r.stages?.[pick] ?? 0) >= FAIR_SHARE)
    .sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      // Rows without the number stay last either way.
      if (x === undefined) return y === undefined ? 0 : 1;
      if (y === undefined) return -1;
      return (x - y) * (sort.desc ? -1 : 1);
    });
  const head = (key: SortKey, label: string) => (
    <span>
      <button
        type="button"
        className="cp-sort"
        aria-pressed={sort.key === key}
        onClick={() => {
          setSort(
            sort.key === key ? { key, desc: !sort.desc } : { key, desc: true },
          );
          setPage(0);
        }}
      >
        {t(label)}
        <span className="sort-mark" aria-hidden="true">
          {sort.key === key ? (sort.desc ? "↓" : "↑") : ""}
        </span>
      </button>
    </span>
  );
  // Estimated win rates, when there are any: an extra column with each augment's win rate boost below it.
  const est = rows.some((r) => r.winRate !== undefined);
  const cols = est ? 3 : 2;
  const pages = Math.ceil(shown.length / PAGE);
  const at = Math.min(page, Math.max(0, pages - 1));
  const hasPicks = rows.some((r) => r.stages);
  return (
    <>
      <div className="cp-filters" ref={box} {...KEPT}>
        <div className="cp-seg" role="group" aria-label={t("Rarity")}>
          {RARITIES.filter(
            (r) => r === "all" || rows.some((x) => x.rarity === r),
          ).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={rarity === r}
              onClick={() => {
                setRarity(r);
                setPage(0);
              }}
            >
              {t(LABEL[r])}
            </button>
          ))}
        </div>
        {hasPicks && (
          <div className="cp-seg" role="group" aria-label={t("Augment pick")}>
            {PICKS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={pick === p}
                onClick={() => {
                  setPick(p);
                  setPage(0);
                }}
              >
                {p === "any" ? t("All picks") : t(PICK_LABEL[p])}
              </button>
            ))}
          </div>
        )}
        {pick !== "any" && (
          <p className="cp-filter-note">
            {t(
              "Estimated: augments often taken at this pick on this champion.",
            )}
          </p>
        )}
      </div>
      <div className="cp-th" data-cols={cols} ref={top}>
        <span>{t("Rank")}</span>
        <span>{t("Augment")}</span>
        {head("deepScore", "DeepScore")}
        {est && head("winRate", "Est. win rate")}
        {head("pickRate", "Pick rate")}
      </div>
      <div className="cp-rows">
        {shown.slice(at * PAGE, (at + 1) * PAGE).map((a, j) => {
          const i = at * PAGE + j;
          const body = (
            <>
              <img
                className="cp-icon round"
                src={`/icons/augments/${a.id}.webp`}
                alt=""
                width={36}
                height={36}
                loading="lazy"
              />
              <span className="cp-name">
                <Name kind="augments" id={a.id}>
                  {a.name}
                </Name>
              </span>
              <span className={`cp-pill ${a.rarity}`}>
                {t(LABEL[a.rarity])}
              </span>
              {/* The game's own build tags for the augment (lib/build-tags.ts). */}
              {(a.tags ?? []).map((tag) => (
                <span key={tag} className="cp-pill cp-tag">
                  {ts(tag)}
                </span>
              ))}
            </>
          );
          return (
            <div key={a.id} className="cp-row" data-cols={cols}>
              <span className="cp-rk">#{i + 1}</span>
              {a.href ? (
                <Link className="cp-what" href={a.href}>
                  {body}
                </Link>
              ) : (
                <div className="cp-what">{body}</div>
              )}
              <div className="cp-cell">
                {a.deepScore !== undefined ? (
                  <DeepScore
                    value={a.deepScore}
                    help={AUGMENT_DEEPSCORE_HELP}
                  />
                ) : (
                  <b>–</b>
                )}
              </div>
              {est && (
                <div className="cp-cell">
                  {a.winRate !== undefined ? (
                    <>
                      <b className={tone(a.lift ?? 0)}>
                        {(a.winRate * 100).toFixed(1)}%
                      </b>
                      <small>
                        {t("{n} boost", {
                          n: tt("{n} pts", { n: signedPts(a.lift ?? 0) }),
                        })}
                      </small>
                    </>
                  ) : (
                    <b>–</b>
                  )}
                </div>
              )}
              <div className="cp-cell">
                <b>{(a.pickRate * 100).toFixed(1)}%</b>
                <small>{t("Pick rate")}</small>
              </div>
            </div>
          );
        })}
      </div>
      {pages > 1 && (
        <nav className="cp-pages" aria-label={t("Augment pages")}>
          <button
            type="button"
            disabled={at === 0}
            onClick={() => turn(at - 1)}
            aria-label={t("Previous page")}
          >
            ‹
          </button>
          {pageList(at, pages).map((p, k) =>
            p === null ? (
              <span key={`gap${k}`} aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                aria-current={p === at ? "page" : undefined}
                onClick={() => turn(p)}
              >
                {p + 1}
              </button>
            ),
          )}
          <button
            type="button"
            disabled={at === pages - 1}
            onClick={() => turn(at + 1)}
            aria-label={t("Next page")}
          >
            ›
          </button>
        </nav>
      )}
      {shown.length === 0 && (
        <p className="cp-empty-line cp-filter-note">
          {t("No augments match these filters.")}
        </p>
      )}
    </>
  );
}

/** Page numbers to show: the first, the last and the current one with its neighbours, with gaps (null) between. */
function pageList(at: number, pages: number): (number | null)[] {
  const keep = [...new Set([0, at - 1, at, at + 1, pages - 1])]
    .filter((p) => p >= 0 && p < pages)
    .sort((a, b) => a - b);
  return keep.flatMap((p, k) =>
    k > 0 && p - keep[k - 1] > 1 ? [null, p] : [p],
  );
}
