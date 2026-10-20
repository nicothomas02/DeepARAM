"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import Link from "next/link";
import { useState } from "react";
import { Name, useT } from "@/components/I18n";
import DeepScore from "@/components/DeepScore";
import { signedPts, tone } from "@/components/champion/Ranked";
import { SIMPLE_LIMIT } from "@/components/champion/ShowMore";
import type { AugmentRow } from "@/lib/champion-page";
import { AUGMENT_DEEPSCORE_HELP } from "@/lib/deepscore";

// A champion's augments as one ranked table with a rarity filter, best DeepScore first, each with the game's build tags. The number
// columns' headers re-sort it (highest first; a second click flips it).

const RARITIES = ["all", "prismatic", "gold", "silver"] as const;
const LABEL = {
  all: "All",
  prismatic: "Prismatic",
  gold: "Gold",
  silver: "Silver",
};
const LIMIT = 10;
type SortKey = "deepScore" | "winRate" | "pickRate";

export default function AugmentTable({
  rows,
}: {
  rows: (AugmentRow & {
    href?: string;
    deepScore?: number;
    winRate?: number;
    lift?: number;
  })[];
}) {
  const t = useT("champions");
  const tt = useT("tables");
  const ts = useT("tier-list");
  const [rarity, setRarity] = useState<(typeof RARITIES)[number]>("all");
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "deepScore", desc: true });
  const shown = rows
    .filter((r) => rarity === "all" || r.rarity === rarity)
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
        onClick={() => setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: true })}
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
  return (
    <>
      <div className="cp-filters">
        <div className="cp-seg" role="group" aria-label={t("Rarity")}>
          {RARITIES.filter(
            (r) => r === "all" || rows.some((x) => x.rarity === r),
          ).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={rarity === r}
              onClick={() => setRarity(r)}
            >
              {t(LABEL[r])}
            </button>
          ))}
        </div>
      </div>
      <div className="cp-th" data-cols={cols}>
        <span>{t("Rank")}</span>
        <span>{t("Augment")}</span>
        {head("deepScore", "DeepScore")}
        {est && head("winRate", "Est. win rate")}
        {head("pickRate", "Pick rate")}
      </div>
      <div
        className={
          !open && shown.length > SIMPLE_LIMIT
            ? "cp-rows cp-cut-simple"
            : "cp-rows"
        }
      >
        {(open ? shown : shown.slice(0, LIMIT)).map((a, i) => {
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
                        {t("{n} boost", { n: tt("{n} pts", { n: signedPts(a.lift ?? 0) }) })}
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
      {shown.length > SIMPLE_LIMIT && (
        <button
          type="button"
          // Simple view cuts the table at 5 rows, Detailed view at 10.
          className={
            shown.length > LIMIT ? "cp-more" : "cp-more cp-more-simple"
          }
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? t("Show fewer") : t("Show all {n}", { n: shown.length })}
        </button>
      )}
    </>
  );
}
