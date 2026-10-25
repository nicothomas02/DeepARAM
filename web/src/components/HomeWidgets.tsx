"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import Link from "next/link";
import RowLink from "@/components/RowLink";
import { useState } from "react";
import { useNames, useT } from "./I18n";

// The home page's interactive pieces: the live tier snapshot,
// an augment offer to roll, and a Kitchen build to reroll.

type Champ = { id: string; name: string; tier: string; winRate: number; pickRate: number; deepScore: number; splash?: string };
type Build = { champion: string; title: string; augments: string[]; why: string };

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const champIcon = (id: string) => `/icons/champions/${id}.webp`;

/** The live patch's S and A tier champions as icons; hover or focus one for its numbers; tapping one shows them, tapping it again opens its page. */
export function TierSnapshot({ champs }: { champs: Champ[] }) {
  const [tier, setTier] = useState("S");
  const t = useT();
  const names = useNames();
  const [hover, setHover] = useState<Champ | null>(null);
  const list = champs.filter((c) => c.tier === tier).sort((a, b) => b.deepScore - a.deepScore);
  const shown = hover && hover.tier === tier ? hover : list[0];
  return (
    <div className="snap">
      <div className="seg snap-tiers" role="group" aria-label={t("Tier")}>
        {["S", "A", "B", "C", "D"].map((x) => (
          <button key={x} type="button" aria-pressed={tier === x} onClick={() => (setTier(x), setHover(null))}>
            {x}
          </button>
        ))}
      </div>
      <div className="snap-grid" onMouseLeave={() => setHover(null)}>
        {list.map((c) => (
          <RowLink
            key={c.id}
            href={`/champions/${c.id}`}
            className={shown?.id === c.id ? "on" : undefined}
            onPointerEnter={(e) => e.pointerType === "mouse" && setHover(c)}
            onFocus={(e) => e.currentTarget.matches(":focus-visible") && setHover(c)}
            onClick={(e) => {
              // A champion that isn't in the card yet is only selected; the next click opens its page.
              if (shown?.id === c.id) return;
              e.preventDefault();
              setHover(c);
            }}
            aria-label={t("{name}: {wr} win rate", { name: names("champions", c.id, c.name), wr: pct(c.winRate) })}
          >
            <img src={champIcon(c.id)} alt="" width={40} height={40} loading="lazy" />
          </RowLink>
        ))}
      </div>
      {shown && (
        <Link
          href={`/champions/${shown.id}`}
          className="snap-card"
          aria-live="polite"
          data-tilt="soft"
          data-parallax
          style={shown.splash ? ({ "--splash": `url("${shown.splash}")` } as React.CSSProperties) : undefined}
        >
          <img src={champIcon(shown.id)} alt="" width={44} height={44} />
          <div>
            <b>{names("champions", shown.id, shown.name)}</b>
            <span>{t("{ds} DeepScore · {wr} win · {pr} pick", { ds: Math.round(shown.deepScore), wr: pct(shown.winRate), pr: pct(shown.pickRate) })}</span>
          </div>
          <span className={`chip tier-${shown.tier.toLowerCase()}`}>{shown.tier}</span>
        </Link>
      )}
    </div>
  );
}

// Each offer is one rarity, like the game's; prismatic offers are the rarest.

/** One Kitchen build at a time, with a button for another. */
export function KitchenPick({ builds }: { builds: Build[] }) {
  const [i, setI] = useState(0);
  const t = useT();
  const names = useNames();
  const b = builds[i];
  if (!b) return null;
  return (
    <div className="kitchen-pick" key={i}>
      <div className="kitchen-head">
        <img src={champIcon(b.champion)} alt="" width={40} height={40} />
        <div>
          <p className="eyebrow">{names("champions", b.champion, b.champion)}</p>
          <h3>{b.title}</h3>
        </div>
      </div>
      <p className="clamp">{b.why}</p>
      <div className="chips">
        {b.augments.slice(0, 4).map((a) => (
          <span key={a} className="chip">
            {a}
          </span>
        ))}
      </div>
      {builds.length > 1 && (
        <button type="button" className="btn ghost" onClick={() => setI((n) => (n + 1) % builds.length)}>
          {t("Another build ({i}/{n})", { i: i + 1, n: builds.length })}
        </button>
      )}
    </div>
  );
}

// Each list's tab and how its number reads ({v} is already formatted by the page).
const FUN: [string, string, string][] = [
  ["damage", "Damage", "{v} damage share"],
  ["tank", "Tanking", "{v} damage taken"],
  ["mitigated", "Damage mitigated", "{v} mitigated/min"],
  ["teamplay", "Kill participation", "{v} kill participation"],
  ["dead", "Time dead", "{v}"],
  ["cs", "CS", "{v} CS"],
  ["healing", "Healing", "{v} healing/min"],
  ["crowd_control", "Crowd control", "{v}s crowd control"],
  ["pentakills", "Pentakills", "Pentakill every {v} games"],
  ["towers", "Towers", "{v} tower damage"],
  ["early_game", "Early game", "{v}"],
  ["late_game", "Late game", "{v}"],
];
// Where each list's "See all champions" link goes: the Tier List sorted by that stat when it has the
// column, otherwise the full champion list.
const FULL: Record<string, string> = {
  damage: "/tier-list?sort=damage.desc",
  tank: "/tier-list?sort=tank.desc",
  teamplay: "/tier-list?sort=kp.desc",
  dead: "/tier-list?sort=dead.desc",
};
const CURVE_NOTE = "Simulated damage: share of champions beaten at level 8 → level 18.";

/** Estimated top 10 champions at one thing a game, picked from a short list, each with its number. */
export function FunLists({ lists }: { lists: Record<string, { id: string; name: string; value: string | null }[]> }) {
  const kinds = FUN.filter(([k]) => lists[k]?.length);
  const [kind, setKind] = useState(kinds[0]?.[0] ?? "");
  const t = useT();
  const names = useNames();
  const unit = FUN.find(([k]) => k === kind)?.[2] ?? "{v}";
  return (
    <>
      <div className="seg fun-kinds" role="group" aria-label={t("Top 10 at")}>
        {kinds.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t(l)}
          </button>
        ))}
      </div>
      {(kind === "early_game" || kind === "late_game") && <p className="fun-note">{t(CURVE_NOTE)}</p>}
      <div className="rank fun-rank">
        {(lists[kind] ?? []).map((c, i) => (
          <RowLink key={c.id} href={`/champions/${c.id}`}>
            <span className="rank-i">{i + 1}</span>
            <img className="icon" src={champIcon(c.id)} alt="" width={24} height={24} loading="lazy" />
            <span className="rank-name">{names("champions", c.id, c.name)}</span>
            {c.value !== null && <span className="rank-v">{unit === "{v}" ? c.value : t(unit, { v: c.value })}</span>}
          </RowLink>
        ))}
      </div>
      <Link className="see-all" href={FULL[kind] ?? "/champions"}>
        {t("See all champions →")}
      </Link>
    </>
  );
}
