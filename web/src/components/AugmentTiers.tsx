"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import Link from "next/link";
import { useEffect, useState } from "react";
import { getParam, setParams } from "@/lib/url-state";
import { EmptyState } from "@/components/EmptyState";
import DeepScore from "@/components/DeepScore";
import { AUGMENT_DEEPSCORE_HELP } from "@/lib/deepscore";
import { useNames, useT } from "./I18n";

// Augment tier list (/tier-list?tab=augments&rarity=gold&style=ap): one row per tier, filtered by rarity and build style.
// Tiers and styles come from the server (lib/augment-tiers.ts). "Table" (?aview=table) swaps the tiers for the
// sortable table of every augment, passed in by the page, instead of stacking both.

export type TierRow = {
  id: number;
  name: string;
  href: string;
  rarity: string;
  tier: string;
  deepScore: number;
  winRate: number;
  pickRate: number;
  styles: string[];
};

const RARITIES: [string, string][] = [
  ["", "All rarities"],
  ["prismatic", "Prismatic"],
  ["gold", "Gold"],
  ["silver", "Silver"],
];
const TIER_ORDER = ["S", "A", "B", "C", "D"];
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function AugmentTiers({
  rows,
  styles,
  note,
  table,
}: {
  rows: TierRow[];
  styles: Record<string, string>;
  /** Shown under the tiers. */
  note?: React.ReactNode;
  table?: React.ReactNode;
}) {
  const t = useT("tier-list");
  const names = useNames();
  const [rarity, setRarity] = useState("");
  const [style, setStyle] = useState("");
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const r = getParam("rarity") ?? "";
    const s = getParam("style") ?? "";
    if (RARITIES.some(([k]) => k === r)) setRarity(r);
    if (s in styles) setStyle(s);
    setAsTable(getParam("aview") === "table");
  }, [styles]);

  const pick = (key: "rarity" | "style", v: string) => {
    if (key === "rarity") setRarity(v);
    else setStyle(v);
    setParams({ [key]: v || null });
  };

  const shown = rows.filter((a) => (!rarity || a.rarity === rarity) && (!style || a.styles.includes(style)));

  const views = table && (
    <div className="seg view-switch" role="group" aria-label={t("View")}>
      {([false, true] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={asTable === v}
          onClick={() => {
            setAsTable(v);
            setParams({ aview: v ? "table" : null, sort: null });
          }}
        >
          {v ? t("Table") : t("Tiers")}
        </button>
      ))}
    </div>
  );
  if (asTable && table)
    return (
      <div className="atiers">
        {views}
        {table}
      </div>
    );

  return (
    <div className="atiers">
      {views}
      <div className="atiers-filters">
        <div className="helper-threats" role="group" aria-label={t("Rarity")}>
          {RARITIES.map(([k, l]) => (
            <button key={k || "all"} type="button" className="chip-toggle" aria-pressed={rarity === k} onClick={() => pick("rarity", k)}>
              {t(l)}
            </button>
          ))}
        </div>
        <div className="helper-threats" role="group" aria-label={t("Build style")}>
          <button type="button" className="chip-toggle" aria-pressed={style === ""} onClick={() => pick("style", "")}>
            {t("Any style")}
          </button>
          {Object.entries(styles).map(([k, l]) => (
            <button key={k} type="button" className="chip-toggle" aria-pressed={style === k} onClick={() => pick("style", k)}>
              {t(l)}
            </button>
          ))}
        </div>
      </div>

      <p className="deepscore-legend">
        <DeepScore value={50} help={AUGMENT_DEEPSCORE_HELP} />
        <span>{t("Ranked by DeepScore. Hover or tap the badge to see how it works.")}</span>
      </p>
      {shown.length === 0 ? (
        <EmptyState
          title={t("No augments match")}
          action={
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRarity("");
                setStyle("");
                setParams({ rarity: null, style: null });
              }}
            >
              {t("Show every augment")}
            </button>
          }
        >
          {t("Try another rarity or style.")}
        </EmptyState>
      ) : (
        <div className="atiers-rows">
          {TIER_ORDER.map((tier) => {
            const list = shown.filter((a) => a.tier === tier).sort((x, y) => y.deepScore - x.deepScore);
            if (!list.length) return null;
            return (
              <section key={tier} className="atiers-row" aria-label={t("Tier {tier}", { tier })}>
                <span className={`chip tier-${tier.toLowerCase()} atiers-tier`}>{tier}</span>
                <div className="atiers-grid">
                  {list.map((a) => (
                    <Link
                      key={a.id}
                      href={a.href}
                      className="atiers-aug"
                      data-rarity={a.rarity}
                      title={t("{name}: DeepScore {score}, {wr} win, picked in {pr} of games", {
                        name: names("augments", a.id, a.name),
                        score: a.deepScore,
                        wr: pct(a.winRate),
                        pr: pct(a.pickRate),
                      })}
                    >
                      <img src={`/icons/augments/${a.id}.webp`} alt="" width={48} height={48} loading="lazy" />
                      <span className="atiers-name">{names("augments", a.id, a.name)}</span>
                      <DeepScore value={a.deepScore} static />
                      <span className={`atiers-wr ${a.winRate >= 0.52 ? "wr-high" : a.winRate <= 0.48 ? "wr-low" : ""}`}>{pct(a.winRate)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {note}
    </div>
  );
}
