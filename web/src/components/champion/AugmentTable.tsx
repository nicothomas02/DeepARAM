"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import Link from "next/link";
import { useState } from "react";
import { Name, useT } from "@/components/I18n";
import DeepScore from "@/components/DeepScore";
import { signed, tone } from "@/components/champion/Ranked";
import type { AugmentRow } from "@/lib/champion-page";
import { AUGMENT_DEEPSCORE_HELP } from "@/lib/deepscore";

// A champion's augments as one ranked table with a rarity filter, best DeepScore first.

const RARITIES = ["all", "prismatic", "gold", "silver"] as const;
const LABEL = {
  all: "All",
  prismatic: "Prismatic",
  gold: "Gold",
  silver: "Silver",
};
const LIMIT = 10;

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
  const [rarity, setRarity] = useState<(typeof RARITIES)[number]>("all");
  const [open, setOpen] = useState(false);
  const shown = rows.filter((r) => rarity === "all" || r.rarity === rarity);
  // Estimated win rates, when there are any: an extra column with each augment's lift below it.
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
        <span>{t("DeepScore")}</span>
        {est && <span>{t("Est. win rate")}</span>}
        <span>{t("Pick rate")}</span>
      </div>
      <div className="cp-rows">
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
                        {signed(a.lift ?? 0)} {t("lift")}
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
      {shown.length > LIMIT && (
        <button
          type="button"
          className="cp-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? t("Show fewer") : t("Show all {n}", { n: shown.length })}
        </button>
      )}
    </>
  );
}
