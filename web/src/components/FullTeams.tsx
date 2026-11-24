/* eslint-disable @next/next/no-img-element -- small local icons */
"use client";

import Link from "next/link";
import { useState } from "react";
import type { TeamRow } from "@/lib/teams";
import { useNames, useT } from "./I18n";

// The Tier List's Full teams view (lib/teams.ts): the strongest five-champion teams, all projected. Each row shows the
// five champions and how much of the team's strength comes from the champions themselves versus how they work
// together. No projected win rate: summed pair synergies likely overstate whole teams.

export default function FullTeams({ data, frontline }: { data: TeamRow[]; frontline: TeamRow[] }) {
  const t = useT("tier-list");
  const tc = useT("champions");
  const names = useNames();
  // Lean by default (Nico, 2026-11-24): the top 10, the rest behind a button.
  const [all, setAll] = useState(false);
  // Two lists (Nico, 2026-11-24): strongest by data alone, or the best that hold a frontline.
  const [front, setFront] = useState(false);
  const rows = front && frontline.length ? frontline : data;
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <div className="full-teams">
      <p className="patch-note subtab-note">
        {t(
          "Projected: no game records whole teams, so these come from how each champion does plus how each pair of them does together. Read them as ideas to try, not records.",
        )}
      </p>
      {frontline.length > 0 && (
        <>
          <div className="seg ft-lists" role="group" aria-label={t("Full teams")}>
            <button type="button" aria-pressed={!front} onClick={() => setFront(false)}>
              {t("Strongest by data")}
            </button>
            <button type="button" aria-pressed={front} onClick={() => setFront(true)}>
              {t("With a frontline")}
            </button>
          </div>
          <p className="ft-list-note">
            {front
              ? t("Each team has a Warden, Vanguard or Juggernaut. That's a design rule, not something the data measured.")
              : t("Ranked only by how the champions and their pairs do.")}
          </p>
        </>
      )}
      <ol className="ft-list">
        {shown.map((r, i) => {
          const own = Math.round(r.fromChampions * 100);
          const name = (a: string) => names("champions", a, r.english[a] ?? a);
          return (
            <li key={r.champions.join()} className="ft-row">
              <span className="ft-rank">#{i + 1}</span>
              <span className="ft-champs">
                {r.champions.map((a) => (
                  <Link key={a} href={`/champions/${a}`} className="ft-champ" title={name(a)}>
                    <img src={`/icons/champions/${a}.webp`} alt="" width={40} height={40} loading="lazy" />
                    <small>{name(a)}</small>
                  </Link>
                ))}
              </span>
              <span className="ft-split">
                <span className="ft-bar" aria-hidden="true">
                  <span className="ft-own" style={{ width: `${own}%` }} />
                </span>
                <small>
                  {t("{own}% champions · {syn}% synergy", { own: String(own), syn: String(100 - own) })}
                </small>
                {r.bestPair && (
                  <small className="ft-pair">
                    {t("Best pair: {a} + {b}", { a: name(r.bestPair[0]), b: name(r.bestPair[1]) })}
                  </small>
                )}
              </span>
              <small className="ft-tag">{t("Projected")}</small>
            </li>
          );
        })}
      </ol>
      {rows.length > 10 && (
        <button type="button" className="ft-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? tc("Show fewer") : tc("Show all {n}", { n: rows.length })}
        </button>
      )}
    </div>
  );
}
