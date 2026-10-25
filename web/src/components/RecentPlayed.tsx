"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import Link from "next/link";
import RowLink from "@/components/RowLink";
import championNames from "@/data/champion-names.json";
import { usePlayed } from "@/lib/played";
import { useNames, useT } from "./I18n";

const NAMES = championNames as Record<string, string>;
const ago = (at: number, t: ReturnType<typeof useT>) => {
  const h = Math.round((Date.now() - at) / 3_600_000);
  return h < 1 ? t("just now") : h < 24 ? t("{n}h ago", { n: h }) : t("{n}d ago", { n: Math.round(h / 24) });
};

// "Recently played" on Home: the visitor's own last Mayhem games, only once they have synced games.
export default function RecentPlayed() {
  const list = usePlayed();
  const t = useT();
  const names = useNames();
  if (!list.length) return null;
  const wins = list.filter((g) => g.win).length;
  return (
    <section className="card span-all recent" data-accent="tier" aria-label={t("Recently played")}>
      <div className="card-head">
        <h2>
          {t("Recently played")}{" "}
          <span className="card-note">
            {t("{w}W {l}L", { w: wins, l: list.length - wins })}
          </span>
        </h2>
        <Link href="/account#my-stats">{t("My Stats →")}</Link>
      </div>
      <div className="recent-row">
        {list.map((g) => (
          <RowLink key={`${g.at}-${g.champion}`} href={`/champions/${g.champion}`} className="recent-item">
            <img src={`/icons/champions/${g.champion}.webp`} alt="" width={36} height={36} loading="lazy" />
            <span>
              <b>{names("champions", g.champion, NAMES[g.champion] ?? g.champion)}</b>
              <small className={g.win ? "wr-high" : "wr-low"}>
                {g.win ? t("Win") : t("Loss")} · {ago(g.at, t)}
              </small>
            </span>
          </RowLink>
        ))}
      </div>
    </section>
  );
}
