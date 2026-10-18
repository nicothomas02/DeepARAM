"use client";
/* eslint-disable @next/next/no-img-element -- small local icons */

import Link from "next/link";
import { useState } from "react";
import { useNames, useT } from "./I18n";

// The home page's interactive pieces: the live tier snapshot,
// an augment offer to roll, and a Kitchen build to reroll.

type Champ = { id: string; name: string; tier: string; winRate: number; pickRate: number; splash?: string };
type Build = { champion: string; title: string; augments: string[]; why: string };

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const champIcon = (id: string) => `/icons/champions/${id}.webp`;

/** The live patch's S and A tier champions as icons; hover or focus one for its numbers. */
export function TierSnapshot({ champs }: { champs: Champ[] }) {
  const [tier, setTier] = useState("S");
  const t = useT();
  const names = useNames();
  const [hover, setHover] = useState<Champ | null>(null);
  const list = champs.filter((c) => c.tier === tier).sort((a, b) => b.winRate - a.winRate);
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
          <Link
            key={c.id}
            href={`/champions/${c.id}`}
            className={shown?.id === c.id ? "on" : undefined}
            onMouseEnter={() => setHover(c)}
            onFocus={() => setHover(c)}
            aria-label={t("{name}: {wr} win rate", { name: names("champions", c.id, c.name), wr: pct(c.winRate) })}
          >
            <img src={champIcon(c.id)} alt="" width={40} height={40} loading="lazy" />
          </Link>
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
            <span>{t("{wr} win · {pr} pick", { wr: pct(shown.winRate), pr: pct(shown.pickRate) })}</span>
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

const FUN: [string, string][] = [
  ["damage", "Damage"],
  ["tank", "Tanking"],
  ["healing", "Healing"],
  ["crowd_control", "Crowd control"],
  ["teamplay", "Teamplay"],
  ["multikills", "Multikills"],
  ["towers", "Towers"],
];

/** Estimated top 10 champions at one thing a game, picked from a short list. */
export function FunLists({ lists }: { lists: Record<string, { id: string; name: string }[]> }) {
  const kinds = FUN.filter(([k]) => lists[k]?.length);
  const [kind, setKind] = useState(kinds[0]?.[0] ?? "");
  const t = useT();
  const names = useNames();
  return (
    <>
      <div className="seg fun-kinds" role="group" aria-label={t("Top 10 at")}>
        {kinds.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t(l)}
          </button>
        ))}
      </div>
      <div className="rank fun-rank">
        {(lists[kind] ?? []).map((c, i) => (
          <Link key={c.id} href={`/champions/${c.id}`}>
            <span className="rank-i">{i + 1}</span>
            <img className="icon" src={champIcon(c.id)} alt="" width={24} height={24} loading="lazy" />
            <span className="rank-name">{names("champions", c.id, c.name)}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
